const { AttachmentBuilder, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const config = require('../../utils/configuration');
const axios = require('axios');

async function readAttachment(attachment) {
  const url = new URL(attachment.url);
  if (url.protocol !== 'https:' || !['cdn.discordapp.com','media.discordapp.net'].includes(url.hostname) ||
      attachment.size > config.MAX_BYTES) throw new Error('Upload a JSON file smaller than 1 MB directly to Discord.');
  const response = await axios.get(url.href,{ responseType:'arraybuffer',maxRedirects:0,
    maxContentLength:config.MAX_BYTES,maxBodyLength:config.MAX_BYTES,timeout:10_000 });
  return JSON.parse(Buffer.from(response.data).toString('utf8'));
}

module.exports = {
  ephemeral:true, dmPermission:false,
  data:new SlashCommandBuilder().setName('configuration').setDescription('Preview, export and restore server settings')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(s=>s.setName('export').setDescription('Export settings without member data or runtime state'))
    .addSubcommand(s=>s.setName('import').setDescription('Preview a merge of settings from a JSON export')
      .addAttachmentOption(o=>o.setName('file').setDescription('Configuration JSON').setRequired(true))
      .addAttachmentOption(o=>o.setName('mapping').setDescription('Optional JSON object mapping old role/channel IDs to new IDs')))
    .addSubcommand(s=>s.setName('history').setDescription('List recorded settings revisions'))
    .addSubcommand(s=>s.setName('rollback').setDescription('Preview restoring one settings revision')
      .addStringOption(o=>o.setName('revision').setDescription('Revision from history').setRequired(true)))
    .addSubcommand(s=>s.setName('apply').setDescription('Apply a preview after checking its changes')
      .addStringOption(o=>o.setName('preview').setDescription('Preview ID').setRequired(true)))
    .addSubcommand(s=>s.setName('inspect').setDescription('Download the before/after changes in a revision')
      .addStringOption(o=>o.setName('revision').setDescription('Revision from history').setRequired(true))),
  async execute(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return interaction.editReply('Administrator permission is required.');
    try {
      const sub = interaction.options.getSubcommand();
      const file = (value,name) => ({ files:[new AttachmentBuilder(Buffer.from(JSON.stringify(value,null,2)),{name})],allowedMentions:{parse:[]} });
      if (sub === 'export') return interaction.editReply(file(config.exportConfiguration(interaction.guild.id),'server-configuration.json'));
      if (sub === 'history') {
        const rows = config.history(interaction.guild.id);
        return interaction.editReply({content: rows.map(row=>`\`${row.revisionId}\` | ${row.changes} changes | ${row.actorId ? `<@${row.actorId}>` : 'System'} | <t:${Math.floor(row.changedAt/1000)}:f>`).join('\n') || 'No configuration history yet.',allowedMentions:{parse:[]} });
      }
      if (sub === 'inspect') {
        const rows = require('../../database').all('SELECT * FROM configuration_changes WHERE guildId=? AND revisionId=? ORDER BY id',
          [interaction.guild.id,interaction.options.getString('revision',true)]);
        if (!rows.length) throw new Error('Revision not found.');
        return interaction.editReply(file(rows,'configuration-revision.json'));
      }
      if (sub === 'apply') {
        await interaction.guild.channels.fetch();
        await interaction.guild.roles.fetch();
        return interaction.editReply(`Applied ${config.applyPlan(interaction.options.getString('preview',true),interaction.guild,interaction.user.id)} configuration changes. Existing tickets, giveaways and member data were not modified.`);
      }
      await interaction.guild.channels.fetch();
      await interaction.guild.roles.fetch();
      const plan = sub === 'import'
        ? config.planImport(await readAttachment(interaction.options.getAttachment('file',true)),interaction.guild,interaction.user.id,
          interaction.options.getAttachment('mapping') ? await readAttachment(interaction.options.getAttachment('mapping')) : {})
        : config.planRollback(interaction.options.getString('revision',true),interaction.guild,interaction.user.id);
      return interaction.editReply({content:`Preview: ${plan.operations.length} settings rows will change. Missing sections are left unchanged.\nReview the attached before/after values, then use \`/configuration apply preview:${plan.id}\` within 15 minutes.`,
        ...file(plan.operations,'configuration-preview.json')});
    } catch (error) { return interaction.editReply({content:error.message.slice(0,1800),allowedMentions:{parse:[]} }); }
  }
};

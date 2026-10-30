const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { get } = require('../../database');
const related = require('../../utils/suggestions/similarity');

module.exports = {
  ephemeral:true,dmPermission:false,
  data:new SlashCommandBuilder().setName('suggestions').setDescription('Find related suggestions and manage duplicate links')
    .addSubcommand(s=>s.setName('search').setDescription('Find related posts without creating a suggestion')
      .addStringOption(o=>o.setName('text').setDescription('Idea to search for').setRequired(true).setMaxLength(500)))
    .addSubcommand(s=>s.setName('link').setDescription('Managers: link a duplicate to its original without removing votes')
      .addIntegerOption(o=>o.setName('duplicate').setDescription('Duplicate suggestion ID').setRequired(true).setMinValue(1))
      .addIntegerOption(o=>o.setName('original').setDescription('Original suggestion ID').setRequired(true).setMinValue(1)))
    .addSubcommand(s=>s.setName('unlink').setDescription('Managers: remove a duplicate link')
      .addIntegerOption(o=>o.setName('id').setDescription('Suggestion ID').setRequired(true).setMinValue(1))),
  async execute(interaction) {
    const settings = get('SELECT suggestionChannelId FROM guild_settings WHERE guildId=?',[interaction.guild.id]);
    const channel = settings?.suggestionChannelId ? await interaction.guild.channels.fetch(settings.suggestionChannelId).catch(()=>null) : null;
    if (!channel?.permissionsFor(interaction.member)?.has(PermissionFlagsBits.ViewChannel)) return interaction.editReply('You cannot view the configured suggestion channel.');
    try {
      const sub = interaction.options.getSubcommand();
      if (sub === 'search') {
        const rows = related.relatedSuggestions(interaction.guild.id,interaction.options.getString('text',true),{threshold:0.3,channelId:channel.id});
        return interaction.editReply({content:rows.map(row=>`[#${row.id}](${related.suggestionUrl(interaction.guild.id,channel.id,row)}) | ${row.status}${row.duplicateOfId ? ` | duplicate of #${row.duplicateOfId}` : ''}`).join('\n') || 'No related suggestions found in the 2,000 most recent posts.',allowedMentions:{parse:[]} });
      }
      if (!related.canManage(interaction.member,interaction.guild.id)) return interaction.editReply('Administrator or a configured suggestion manager role is required.');
      const id = interaction.options.getInteger(sub === 'link' ? 'duplicate' : 'id',true);
      const row = get('SELECT * FROM suggestions WHERE guildId=? AND id=?',[interaction.guild.id,id]);
      if (!row) throw new Error('Suggestion not found.');
      const original = sub === 'link' ? interaction.options.getInteger('original',true) : null;
      if (original) related.linkDuplicate(interaction.guild.id,id,original,interaction.user.id);
      else related.unlinkDuplicate(interaction.guild.id,id);
      let displayUpdated = false;
      if (row.messageId) {
        const message = await channel.messages.fetch(row.messageId).catch(()=>null);
        if (message?.author?.id === interaction.client.user.id && message.embeds?.length) {
          const embed = EmbedBuilder.from(message.embeds[0]);
          embed.setFields(...(embed.data.fields||[]).filter(field=>field.name !== 'Related Suggestion'));
          if (original) embed.addFields({name:'Related Suggestion',value:`Duplicate of #${original}`});
          displayUpdated = !!await message.edit({embeds:[embed],allowedMentions:{parse:[]}}).catch(()=>null);
        }
      }
      return interaction.editReply(`Suggestion #${id}: ${original ? `linked to #${original}` : 'duplicate link removed'}. Authors and votes are unchanged.${displayUpdated ? '' : ' The saved link is available in search; the original message could not be updated.'}`);
    } catch (error) { return interaction.editReply({content:error.message,allowedMentions:{parse:[]} }); }
  }
};

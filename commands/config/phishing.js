const {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder
} = require('discord.js');

const { all, get, run } = require('../../database');
const { normalizeDomain } = require('../../utils/phishingProtection');

module.exports = {
  cooldown: 1500,
  ephemeral: true,
  data: new SlashCommandBuilder()
    .setName('phishing')
    .setDescription('Configure phishing and scam-link protection')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand(command => command
      .setName('settings')
      .setDescription('Show phishing protection settings'))
    .addSubcommand(command => command
      .setName('enable')
      .setDescription('Enable phishing protection')
      .addChannelOption(option => option
        .setName('alerts')
        .setDescription('Optional private channel for phishing alerts')
        .addChannelTypes(ChannelType.GuildText)))
    .addSubcommand(command => command
      .setName('disable')
      .setDescription('Disable phishing protection'))
    .addSubcommand(command => command
      .setName('allow')
      .setDescription('Allow a trusted domain')
      .addStringOption(option => option.setName('domain').setDescription('Domain to allow').setRequired(true)))
    .addSubcommand(command => command
      .setName('unallow')
      .setDescription('Remove a trusted domain')
      .addStringOption(option => option.setName('domain').setDescription('Domain to remove').setRequired(true)))
    .addSubcommand(command => command
      .setName('block')
      .setDescription('Block a domain explicitly')
      .addStringOption(option => option.setName('domain').setDescription('Domain to block').setRequired(true)))
    .addSubcommand(command => command
      .setName('unblock')
      .setDescription('Remove a domain from the blocklist')
      .addStringOption(option => option.setName('domain').setDescription('Domain to remove').setRequired(true)))
    .addSubcommand(command => command
      .setName('list')
      .setDescription('List custom allowed and blocked domains')),

  async execute(interaction) {
    const action = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (action === 'enable' || action === 'disable') {
      const channel = interaction.options.getChannel('alerts');
      run(
        `INSERT INTO phishing_settings (guildId, enabled, alertChannelId, updatedBy, updatedAt)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(guildId) DO UPDATE SET
           enabled = excluded.enabled,
           alertChannelId = COALESCE(excluded.alertChannelId, phishing_settings.alertChannelId),
           updatedBy = excluded.updatedBy,
           updatedAt = excluded.updatedAt`,
        [guildId, action === 'enable' ? 1 : 0, channel?.id || null, interaction.user.id, Date.now()]
      );
      return interaction.editReply({
        content: `Phishing protection is now **${action === 'enable' ? 'enabled' : 'disabled'}**.`
      });
    }

    if (['allow', 'unallow', 'block', 'unblock'].includes(action)) {
      const domain = normalizeDomain(interaction.options.getString('domain', true));
      if (!domain || !domain.includes('.')) {
        return interaction.editReply({ content: 'Enter a valid domain such as `example.com`.' });
      }
      const allow = action.includes('allow');
      const remove = action.startsWith('un');
      const table = allow ? 'phishing_allowlist' : 'phishing_blocklist';
      if (remove) {
        run(`DELETE FROM ${table} WHERE guildId = ? AND domain = ?`, [guildId, domain]);
      } else {
        run(
          `INSERT OR REPLACE INTO ${table} (guildId, domain, addedBy, addedAt) VALUES (?, ?, ?, ?)`,
          [guildId, domain, interaction.user.id, Date.now()]
        );
      }
      return interaction.editReply({
        content: `\`${domain}\` was ${remove ? 'removed from' : 'added to'} the ${allow ? 'allowlist' : 'blocklist'}.`
      });
    }

    const settings = get(`SELECT * FROM phishing_settings WHERE guildId = ?`, [guildId]);
    const allowed = all(`SELECT domain FROM phishing_allowlist WHERE guildId = ? ORDER BY domain`, [guildId]);
    const blocked = all(`SELECT domain FROM phishing_blocklist WHERE guildId = ? ORDER BY domain`, [guildId]);
    const embed = new EmbedBuilder()
      .setColor(Number(settings?.enabled) === 1 ? 0x57F287 : 0x95A5A6)
      .setTitle('Phishing Protection')
      .addFields(
        { name: 'Status', value: Number(settings?.enabled) === 1 ? 'Enabled' : 'Disabled', inline: true },
        { name: 'Alert Channel', value: settings?.alertChannelId ? `<#${settings.alertChannelId}>` : 'Logging channel', inline: true },
        { name: 'Allowed Domains', value: allowed.map(row => `\`${row.domain}\``).join('\n') || 'None' },
        { name: 'Blocked Domains', value: blocked.map(row => `\`${row.domain}\``).join('\n') || 'None' }
      );
    return interaction.editReply({ embeds: [embed] });
  }
};

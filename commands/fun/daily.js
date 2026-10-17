const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { all, get } = require('../../database');
const { engagementSettings, seasonLeaderboard, setReminderPreference } = require('../../utils/dailyEngagement');

module.exports = {
  ephemeral: true, dmPermission: false, cooldown: 2000, auditLog: false,
  data: new SlashCommandBuilder().setName('daily').setDescription('Your daily activity reminders and seasonal scores')
    .addSubcommand(sub => sub.setName('reminders').setDescription('Opt in or out of daily activity reminder DMs for this server')
      .addBooleanOption(opt => opt.setName('enabled').setDescription('Receive a DM only for activities you have not joined').setRequired(true)))
    .addSubcommand(sub => sub.setName('status').setDescription('View your reminder preference and seasonal points'))
    .addSubcommand(sub => sub.setName('seasons').setDescription('Find current and previous seasons and their leaderboard IDs'))
    .addSubcommand(sub => sub.setName('leaderboard').setDescription('View current or previous seasonal scores')
      .addStringOption(opt => opt.setName('season_id').setDescription('Optional previous season ID').setMaxLength(60))),
  async execute(interaction) {
    const guildId = interaction.guild.id;
    const sub = interaction.options.getSubcommand();
    const settings = engagementSettings(guildId);
    if (sub === 'seasons') {
      const seasons = all('SELECT * FROM daily_seasons WHERE guildId = ? ORDER BY startedAt DESC LIMIT 20', [guildId]);
      return interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('Daily Activity Seasons')
        .setDescription(seasons.map(season => `**${season.name}**${season.endedAt ? ' (ended)' : ' (current)'}\nID: ${season.seasonId}`).join('\n\n'))], allowedMentions: { parse: [] } });
    }
    if (sub === 'reminders') {
      const enabled = interaction.options.getBoolean('enabled', true);
      setReminderPreference(guildId, interaction.user.id, enabled);
      return interaction.editReply({ content: enabled
        ? `You opted into reminder DMs for this server.${settings.remindersEnabled ? '' : ' Server reminders are currently disabled.'}`
        : 'You opted out. Queued reminders for this server are cancelled.' });
    }
    if (sub === 'leaderboard') {
      const seasonId = interaction.options.getString('season_id') || settings.seasonId;
      const entries = seasonLeaderboard(guildId, seasonId);
      const season = get('SELECT name FROM daily_seasons WHERE guildId = ? AND seasonId = ?', [guildId, seasonId]);
      return interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x5865F2)
        .setTitle(season?.name || 'Previous Season')
        .setDescription(entries.map((entry, index) => `**${index + 1}.** <@${entry.userId}>: ${entry.points} points`).join('\n') || 'No points recorded yet.')
        .setFooter({ text: `Season ID: ${seasonId}` })], allowedMentions: { parse: [] } });
    }
    const pref = get('SELECT reminders FROM daily_member_preferences WHERE guildId = ? AND userId = ?', [guildId, interaction.user.id]);
    const points = get(`SELECT COALESCE(SUM(points), 0) AS points FROM daily_point_events WHERE guildId = ? AND userId = ? AND seasonId = ?`,
      [guildId, interaction.user.id, settings.seasonId]).points;
    return interaction.editReply({ content: `**${settings.seasonName}**: ${points} points.\nReminder DMs: ${pref?.reminders ? 'opted in' : 'opted out'}. Server reminders: ${settings.remindersEnabled ? 'enabled' : 'disabled'}.` });
  }
};

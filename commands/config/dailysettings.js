const { EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { all } = require('../../database');
const { DAY_NAMES } = require('../../services/DailyInteractionService');
const { addMilestone, configureEngagement, engagementSettings, removeMilestone,
  setQuietDay, startSeason } = require('../../utils/dailyEngagement');

module.exports = {
  ephemeral: true,
  dmPermission: false,
  data: new SlashCommandBuilder().setName('dailysettings')
    .setDescription('Configure daily activity reminders, quiet days, trivia, seasons, and rewards')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub => sub.setName('status').setDescription('Show daily engagement settings and reward roles'))
    .addSubcommand(sub => sub.setName('reminders').setDescription('Allow opt-in DM reminders for unanswered activities')
      .addBooleanOption(opt => opt.setName('enabled').setDescription('Members must also opt in individually').setRequired(true))
      .addIntegerOption(opt => opt.setName('delay_minutes').setDescription('Wait this long after posting before reminding')
        .setMinValue(5).setMaxValue(1380)))
    .addSubcommand(sub => sub.setName('quiet-day').setDescription('Skip automatic activities and reminders on a weekday')
      .addIntegerOption(opt => opt.setName('day').setDescription('Weekday in the configured daily timezone').setRequired(true)
        .addChoices(...DAY_NAMES.map((name, value) => ({ name, value }))))
      .addBooleanOption(opt => opt.setName('quiet').setDescription('True to skip; false to restore normal posting').setRequired(true)))
    .addSubcommand(sub => sub.setName('trivia').setDescription('Set how long new private trivia rounds remain open')
      .addIntegerOption(opt => opt.setName('minutes').setDescription('Time until answers and explanations are revealed')
        .setMinValue(1).setMaxValue(1440).setRequired(true)))
    .addSubcommand(sub => sub.setName('points').setDescription('Set the maximum seasonal points earned per local day')
      .addIntegerOption(opt => opt.setName('daily_cap').setDescription('Joining earns 1; first answer earns 2; no extra points for turns')
        .setMinValue(1).setMaxValue(100).setRequired(true)))
    .addSubcommand(sub => sub.setName('season-start').setDescription('Start a new season without deleting prior scores or lifetime stats')
      .addStringOption(opt => opt.setName('name').setDescription('New season name').setMaxLength(60).setRequired(true))
      .addBooleanOption(opt => opt.setName('confirm').setDescription('Confirm new seasonal scores start at zero; earned roles remain')
        .setRequired(true)))
    .addSubcommand(sub => sub.setName('reward-add').setDescription('Award a safe role at a seasonal point milestone')
      .addRoleOption(opt => opt.setName('role').setDescription('Non-privileged role below you and the bot').setRequired(true))
      .addIntegerOption(opt => opt.setName('points').setDescription('Required seasonal points').setMinValue(1).setMaxValue(100000).setRequired(true)))
    .addSubcommand(sub => sub.setName('reward-remove').setDescription('Stop future grants of a milestone role; keep earned roles')
      .addRoleOption(opt => opt.setName('role').setDescription('Reward role').setRequired(true)))
    .addSubcommand(sub => sub.setName('reward-list').setDescription('List configured milestone roles')),

  async execute(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.editReply({ content: 'Manage Server permission is required.' });
    }
    const guildId = interaction.guild.id;
    const sub = interaction.options.getSubcommand();
    try {
      if (sub === 'status' || sub === 'reward-list') {
        const settings = engagementSettings(guildId);
        const rewards = all('SELECT * FROM daily_milestone_roles WHERE guildId = ? ORDER BY points', [guildId]);
        const grants = all(`SELECT status, COUNT(*) AS count FROM daily_role_grants WHERE guildId = ? GROUP BY status`, [guildId]);
        return interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('Daily Engagement Settings')
          .addFields({ name: 'Season', value: `${settings.seasonName}\nID: ${settings.seasonId}` },
            { name: 'Reminders', value: settings.remindersEnabled ? `Opt-in DMs after ${settings.reminderDelayMinutes} minutes` : 'Disabled' },
            { name: 'Quiet Days', value: JSON.parse(settings.quietDays).map(day => DAY_NAMES[day]).join(', ') || 'None' },
            { name: 'Trivia', value: `${settings.triviaMinutes} minutes for new rounds`, inline: true },
            { name: 'Daily Point Cap', value: String(settings.dailyPointCap), inline: true },
            { name: 'Milestone Roles', value: rewards.map(row => `<@&${row.roleId}>: ${row.points} points`).join('\n').slice(0, 1024) || 'None' },
            { name: 'Role Delivery', value: grants.map(row => `${row.status}: ${row.count}`).join(' | ') || 'No grants yet' })
          .setFooter({ text: 'Earned roles remain when seasons change. Lifetime stats are preserved.' })], allowedMentions: { parse: [] } });
      }
      if (sub === 'reminders') configureEngagement(guildId, {
        remindersEnabled: interaction.options.getBoolean('enabled', true) ? 1 : 0,
        reminderDelayMinutes: interaction.options.getInteger('delay_minutes') ?? engagementSettings(guildId).reminderDelayMinutes });
      if (sub === 'quiet-day') setQuietDay(guildId, interaction.options.getInteger('day', true), interaction.options.getBoolean('quiet', true));
      if (sub === 'trivia') configureEngagement(guildId, { triviaMinutes: interaction.options.getInteger('minutes', true) });
      if (sub === 'points') configureEngagement(guildId, { dailyPointCap: interaction.options.getInteger('daily_cap', true) });
      if (sub === 'season-start') {
        if (!interaction.options.getBoolean('confirm', true)) return interaction.editReply({ content: 'Season unchanged.' });
        startSeason(guildId, interaction.options.getString('name', true));
      }
      if (sub === 'reward-add') {
        const member = await interaction.guild.members.fetch(interaction.user.id);
        await interaction.guild.members.fetchMe();
        const selected = interaction.options.getRole('role', true);
        const role = await interaction.guild.roles.fetch(selected.id);
        addMilestone(interaction.guild, role, interaction.options.getInteger('points', true), member);
      }
      if (sub === 'reward-remove') removeMilestone(guildId, interaction.options.getRole('role', true).id);
      return interaction.editReply({ content: 'Daily engagement settings saved. Changes persist through restarts.' });
    } catch (error) { return interaction.editReply({ content: error.message }); }
  }
};

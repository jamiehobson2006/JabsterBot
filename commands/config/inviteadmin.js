const {
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder
} = require('discord.js');

const {
  all,
  get,
  run
} = require('../../database');

const {
  loadGuildInvites
} = require('../../utils/giveaways/cache');

function eventLine(event) {
  const who = event.inviterId ? `<@${event.inviterId}>` : 'No inviter';
  const invite = event.inviteCode ? `\`${event.inviteCode}\`` : 'Unknown';
  return `<t:${Math.floor(event.timestamp / 1000)}:R> | **${event.eventType}** | ${who} | ${invite} | ${event.confidence}`;
}

module.exports = {
  cooldown: 3000,
  ephemeral: true,

  data: new SlashCommandBuilder()
    .setName('inviteadmin')
    .setDescription('Manage and audit reliable invite tracking')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(subcommand => subcommand
      .setName('sync')
      .setDescription('Refresh the invite cache from Discord now'))
    .addSubcommand(subcommand => subcommand
      .setName('audit')
      .setDescription('View recent invite attribution events')
      .addUserOption(option => option
        .setName('user')
        .setDescription('Optional member whose join history to view')))
    .addSubcommand(subcommand => subcommand
      .setName('bonus')
      .setDescription('Add or remove manual bonus invites')
      .addUserOption(option => option
        .setName('user')
        .setDescription('Member receiving the adjustment')
        .setRequired(true))
      .addIntegerOption(option => option
        .setName('amount')
        .setDescription('Positive to add, negative to remove')
        .setMinValue(-1000)
        .setMaxValue(1000)
        .setRequired(true))
      .addStringOption(option => option
        .setName('reason')
        .setDescription('Reason recorded in the audit trail')
        .setMaxLength(300)
        .setRequired(true))),

  async execute(interaction) {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.editReply({ content: 'Manage Server permission is required.' });
    }

    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'sync') {
      if (!interaction.guild.members.me?.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.editReply({ content: 'I need Manage Server permission to fetch and attribute invite uses.' });
      }

      const cache = await loadGuildInvites(interaction.guild);
      return interaction.editReply({
        content: cache
          ? `Invite tracking synced: ${cache.filter(invite => !invite.vanity).size} active invite(s) cached.`
          : 'I could not refresh invites. Check my Manage Server permission.'
      });
    }

    if (subcommand === 'audit') {
      const user = interaction.options.getUser('user');
      const events = user
        ? all(
          `SELECT * FROM invite_events
           WHERE guildId = ? AND memberId = ?
           ORDER BY timestamp DESC LIMIT 12`,
          [interaction.guild.id, user.id]
        )
        : all(
          `SELECT * FROM invite_events
           WHERE guildId = ?
           ORDER BY timestamp DESC LIMIT 12`,
          [interaction.guild.id]
        );

      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle(user ? `Invite Audit: ${user.tag}` : 'Recent Invite Attribution')
          .setDescription(events.length ? events.map(eventLine).join('\n') : 'No invite events have been recorded yet.')
          .setFooter({ text: 'EXACT is credited; AMBIGUOUS and UNKNOWN are logged but never guessed.' })
          .setTimestamp()]
      });
    }

    const user = interaction.options.getUser('user', true);
    const amount = interaction.options.getInteger('amount', true);
    const reason = interaction.options.getString('reason', true).trim();
    const stats = get(
      'SELECT * FROM invite_stats WHERE guildId = ? AND userId = ?',
      [interaction.guild.id, user.id]
    );
    const currentBonus = Number(stats?.bonus) || 0;

    if (currentBonus + amount < 0) {
      return interaction.editReply({ content: `That would reduce ${user.tag}'s bonus below zero.` });
    }

    run(
      `INSERT INTO invite_stats (guildId, userId, bonus)
       VALUES (?, ?, ?)
       ON CONFLICT(guildId, userId)
       DO UPDATE SET bonus = bonus + excluded.bonus`,
      [interaction.guild.id, user.id, amount]
    );
    run(
      `INSERT INTO invite_events (
         guildId, memberId, inviterId, inviteCode, eventType,
         confidence, source, fake, timestamp, metadata
       ) VALUES (?, ?, ?, 'MANUAL', 'MANUAL', 'ADMIN', 0, ?, ?)`,
      [
        interaction.guild.id,
        user.id,
        interaction.user.id,
        Date.now(),
        JSON.stringify({ amount, reason })
      ]
    );

    return interaction.editReply({
      content: `Adjusted ${user}'s bonus by ${amount >= 0 ? '+' : ''}${amount}. New bonus: ${currentBonus + amount}.`
    });
  }
};

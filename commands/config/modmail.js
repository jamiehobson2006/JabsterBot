const {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder
} = require('discord.js');

const { get, run } = require('../../database');
const { sendModmailLog } = require('../../utils/modmail');

function isManager(interaction) {
  return interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild);
}

module.exports = {
  cooldown: 1500,
  ephemeral: true,
  data: new SlashCommandBuilder()
    .setName('modmail')
    .setDescription('Contact staff or configure DM modmail')
    .setDMPermission(false)
    .addSubcommand(command => command
      .setName('contact')
      .setDescription('Choose this server for your next DM to the bot'))
    .addSubcommand(command => command
      .setName('setup')
      .setDescription('Configure DM modmail for this server')
      .addChannelOption(option => option
        .setName('category')
        .setDescription('Category where private modmail channels are created')
        .addChannelTypes(ChannelType.GuildCategory)
        .setRequired(true))
      .addRoleOption(option => option
        .setName('staff_role')
        .setDescription('Role allowed to answer modmail')
        .setRequired(true))
      .addChannelOption(option => option
        .setName('log_channel')
        .setDescription('Optional channel for open and close notices')
        .addChannelTypes(ChannelType.GuildText)))
    .addSubcommand(command => command
      .setName('disable')
      .setDescription('Disable new modmail conversations'))
    .addSubcommand(command => command
      .setName('status')
      .setDescription('Show this server modmail configuration'))
    .addSubcommand(command => command
      .setName('close')
      .setDescription('Close the current modmail conversation')
      .addStringOption(option => option
        .setName('reason')
        .setDescription('Reason sent to the member')
        .setMinLength(3)
        .setMaxLength(500)
        .setRequired(true))),

  async execute(interaction) {
    const action = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (action === 'contact') {
      const settings = get(
        `SELECT * FROM modmail_settings WHERE guildId = ? AND enabled = 1`,
        [guildId]
      );
      if (!settings?.categoryId) {
        return interaction.editReply({ content: 'Modmail is not available in this server.' });
      }
      run(
        `INSERT INTO modmail_preferences (userId, guildId, updatedAt)
         VALUES (?, ?, ?)
         ON CONFLICT(userId) DO UPDATE SET guildId = excluded.guildId, updatedAt = excluded.updatedAt`,
        [interaction.user.id, guildId, Date.now()]
      );
      const sent = await interaction.user.send(
        `Your modmail destination is now **${interaction.guild.name}**. Reply to this DM with your message.`
      ).then(() => true).catch(() => false);
      return interaction.editReply({
        content: sent
          ? 'I sent you a DM. Reply there to contact the staff team.'
          : 'I could not DM you. Enable direct messages from server members and try again.'
      });
    }

    if (!isManager(interaction)) {
      return interaction.editReply({ content: 'You need Manage Server permission.' });
    }

    if (action === 'setup') {
      const category = interaction.options.getChannel('category', true);
      const staffRole = interaction.options.getRole('staff_role', true);
      const logChannel = interaction.options.getChannel('log_channel');
      const botMember = interaction.guild.members.me;

      if (staffRole.id === interaction.guild.roles.everyone.id || staffRole.managed) {
        return interaction.editReply({
          content: 'Choose a normal staff role other than @everyone or an integration-managed role.'
        });
      }
      if (staffRole.position >= botMember.roles.highest.position) {
        return interaction.editReply({ content: 'The staff role must be below my highest role.' });
      }

      const categoryPermissions = category.permissionsFor(botMember);
      if (!categoryPermissions?.has([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageRoles
      ])) {
        return interaction.editReply({
          content: 'I need View Channel, Manage Channels, and Manage Roles in that category.'
        });
      }

      if (logChannel && !logChannel.permissionsFor(botMember)?.has([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks
      ])) {
        return interaction.editReply({
          content: 'I need View Channel, Send Messages, and Embed Links in the selected log channel.'
        });
      }
      run(
        `INSERT INTO modmail_settings (
           guildId, enabled, categoryId, staffRoleId, logChannelId, updatedBy, updatedAt
         ) VALUES (?, 1, ?, ?, ?, ?, ?)
         ON CONFLICT(guildId) DO UPDATE SET
           enabled = 1,
           categoryId = excluded.categoryId,
           staffRoleId = excluded.staffRoleId,
           logChannelId = excluded.logChannelId,
           updatedBy = excluded.updatedBy,
           updatedAt = excluded.updatedAt`,
        [guildId, category.id, staffRole.id, logChannel?.id || null, interaction.user.id, Date.now()]
      );
      return interaction.editReply({
        content: `Modmail is enabled. Conversations will be created in **${category.name}** for ${staffRole}.`
      });
    }

    if (action === 'disable') {
      run(
        `INSERT INTO modmail_settings (guildId, enabled, updatedBy, updatedAt)
         VALUES (?, 0, ?, ?)
         ON CONFLICT(guildId) DO UPDATE SET enabled = 0, updatedBy = excluded.updatedBy, updatedAt = excluded.updatedAt`,
        [guildId, interaction.user.id, Date.now()]
      );
      return interaction.editReply({ content: 'New modmail conversations are disabled.' });
    }

    if (action === 'close') {
      const thread = get(
        `SELECT * FROM modmail_threads WHERE guildId = ? AND channelId = ? AND status = 'OPEN'`,
        [guildId, interaction.channel.id]
      );
      if (!thread) return interaction.editReply({ content: 'Use this inside an open modmail channel.' });
      const settings = get(`SELECT * FROM modmail_settings WHERE guildId = ?`, [guildId]);
      const allowed = interaction.memberPermissions.has(PermissionFlagsBits.Administrator) ||
        interaction.member.roles.cache.has(settings?.staffRoleId);
      if (!allowed) return interaction.editReply({ content: 'You cannot close this modmail conversation.' });

      const reason = interaction.options.getString('reason', true).trim();
      await interaction.channel.permissionOverwrites.edit(
        settings.staffRoleId,
        { SendMessages: false },
        { reason: `Modmail #${thread.id} closed by ${interaction.user.tag}: ${reason}` }
      );

      const result = run(
        `UPDATE modmail_threads
         SET status = 'CLOSED', closedAt = ?, closedBy = ?, closeReason = ?
         WHERE id = ? AND status = 'OPEN'`,
        [Date.now(), interaction.user.id, reason, thread.id]
      );
      if (!result.changes) {
        return interaction.editReply({ content: 'This modmail conversation was already closed.' });
      }
      const user = await interaction.client.users.fetch(thread.userId).catch(() => null);
      await user?.send(`Your modmail conversation in **${interaction.guild.name}** was closed.\nReason: ${reason}`)
        .catch(() => null);
      await interaction.channel.setName(`closed-modmail-${thread.id}`).catch(() => null);
      await sendModmailLog(interaction.guild, settings, new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle(`Modmail #${thread.id} Closed`)
        .addFields(
          { name: 'Member', value: `<@${thread.userId}> (${thread.userId})` },
          { name: 'Closed By', value: `${interaction.user}` },
          { name: 'Reason', value: reason.slice(0, 1024) },
          { name: 'Channel', value: `${interaction.channel}` }
        )
        .setTimestamp());
      return interaction.editReply({ content: `Modmail closed. Reason: ${reason}` });
    }

    const settings = get(`SELECT * FROM modmail_settings WHERE guildId = ?`, [guildId]);
    const open = get(
      `SELECT COUNT(*) AS total FROM modmail_threads WHERE guildId = ? AND status = 'OPEN'`,
      [guildId]
    )?.total || 0;
    const embed = new EmbedBuilder()
      .setColor(Number(settings?.enabled) === 1 ? 0x57F287 : 0x95A5A6)
      .setTitle('DM Modmail')
      .addFields(
        { name: 'Status', value: Number(settings?.enabled) === 1 ? 'Enabled' : 'Disabled', inline: true },
        { name: 'Open Conversations', value: String(open), inline: true },
        { name: 'Category', value: settings?.categoryId ? `<#${settings.categoryId}>` : 'Not set', inline: true },
        { name: 'Staff Role', value: settings?.staffRoleId ? `<@&${settings.staffRoleId}>` : 'Not set', inline: true },
        { name: 'Log Channel', value: settings?.logChannelId ? `<#${settings.logChannelId}>` : 'Not set', inline: true }
      );
    return interaction.editReply({ embeds: [embed] });
  }
};

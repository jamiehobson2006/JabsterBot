const {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder
} = require('discord.js');

const { all, get, run } = require('../../database');
const StaffRotaService = require('../../services/StaffRotaService');

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_CHOICES = DAYS.map((name, value) => ({ name, value }));

function parseTime(value) {
  const match = String(value || '').match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return match ? (Number(match[1]) * 60) + Number(match[2]) : null;
}

function validTimezone(value) {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function manager(interaction) {
  return interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild);
}

module.exports = {
  cooldown: 1500,
  ephemeral: true,
  data: new SlashCommandBuilder()
    .setName('staffrota')
    .setDescription('Configure staff shifts, availability, and escalation order')
    .setDMPermission(false)
    .addSubcommand(command => command
      .setName('setup')
      .setDescription('Configure the live staff rota dashboard')
      .addChannelOption(option => option.setName('channel').setDescription('Rota dashboard channel').addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addRoleOption(option => option.setName('staff_role').setDescription('Role allowed to set availability').setRequired(true)))
    .addSubcommand(command => command
      .setName('add')
      .setDescription('Add a recurring weekly staff shift')
      .addUserOption(option => option.setName('user').setDescription('Staff member').setRequired(true))
      .addIntegerOption(option => option.setName('day').setDescription('Shift start day').setChoices(...DAY_CHOICES).setRequired(true))
      .addStringOption(option => option.setName('start').setDescription('Start time, HH:MM').setRequired(true))
      .addStringOption(option => option.setName('end').setDescription('End time, HH:MM').setRequired(true))
      .addStringOption(option => option.setName('timezone').setDescription('IANA timezone, e.g. Europe/London').setRequired(true))
      .addIntegerOption(option => option.setName('priority').setDescription('Lower number is contacted first').setMinValue(1).setMaxValue(999).setRequired(true)))
    .addSubcommand(command => command
      .setName('remove')
      .setDescription('Remove a shift by its ID')
      .addIntegerOption(option => option.setName('id').setDescription('Shift ID').setMinValue(1).setRequired(true)))
    .addSubcommand(command => command
      .setName('list')
      .setDescription('List configured shifts'))
    .addSubcommand(command => command
      .setName('availability')
      .setDescription('Set your current staff availability')
      .addStringOption(option => option.setName('status').setDescription('Current availability').setRequired(true).addChoices(
        { name: 'Available', value: 'AVAILABLE' },
        { name: 'Busy', value: 'BUSY' },
        { name: 'Away', value: 'AWAY' },
        { name: 'Offline', value: 'OFFLINE' }
      ))
      .addStringOption(option => option.setName('note').setDescription('Optional short note').setMaxLength(100)))
    .addSubcommand(command => command
      .setName('refresh')
      .setDescription('Refresh the rota dashboard now')),

  async execute(interaction) {
    const action = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;
    const settings = get(`SELECT * FROM staff_rota_settings WHERE guildId = ?`, [guildId]);

    if (action === 'availability') {
      const allowed = interaction.memberPermissions.has(PermissionFlagsBits.Administrator) ||
        interaction.member.roles.cache.has(settings?.staffRoleId);
      if (!allowed) return interaction.editReply({ content: 'You need the configured staff role.' });
      const status = interaction.options.getString('status', true);
      const note = interaction.options.getString('note')?.trim() || null;
      run(
        `INSERT INTO staff_availability (guildId, userId, status, note, updatedAt)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(guildId, userId) DO UPDATE SET status = excluded.status, note = excluded.note, updatedAt = excluded.updatedAt`,
        [guildId, interaction.user.id, status, note, Date.now()]
      );
      await StaffRotaService.refresh(interaction.client, guildId);
      return interaction.editReply({ content: `Your availability is now **${status.toLowerCase()}**.` });
    }

    if (!manager(interaction)) {
      return interaction.editReply({ content: 'You need Manage Server permission.' });
    }

    if (action === 'setup') {
      const channel = interaction.options.getChannel('channel', true);
      const role = interaction.options.getRole('staff_role', true);
      const botMember = interaction.guild.members.me;
      if (role.id === interaction.guild.roles.everyone.id) {
        return interaction.editReply({ content: 'Choose a staff role other than @everyone.' });
      }
      if (!channel.permissionsFor(botMember)?.has([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.ReadMessageHistory
      ])) {
        return interaction.editReply({
          content: 'I need View Channel, Send Messages, Embed Links, and Read Message History there.'
        });
      }

      const keepMessageId = settings?.channelId === channel.id
        ? settings.messageId
        : null;
      run(
        `INSERT INTO staff_rota_settings (guildId, enabled, channelId, staffRoleId, messageId, updatedBy, updatedAt)
         VALUES (?, 1, ?, ?, ?, ?, ?)
         ON CONFLICT(guildId) DO UPDATE SET enabled = 1, channelId = excluded.channelId,
           staffRoleId = excluded.staffRoleId, messageId = excluded.messageId,
           updatedBy = excluded.updatedBy, updatedAt = excluded.updatedAt`,
        [guildId, channel.id, role.id, keepMessageId, interaction.user.id, Date.now()]
      );
      const refreshed = await StaffRotaService.refresh(interaction.client, guildId);
      if (!refreshed) {
        if (settings) {
          run(
            `UPDATE staff_rota_settings
             SET enabled = ?, channelId = ?, staffRoleId = ?, messageId = ?, updatedBy = ?, updatedAt = ?
             WHERE guildId = ?`,
            [settings.enabled, settings.channelId, settings.staffRoleId, settings.messageId,
              settings.updatedBy, settings.updatedAt, guildId]
          );
        } else {
          run(`UPDATE staff_rota_settings SET enabled = 0 WHERE guildId = ?`, [guildId]);
        }
        return interaction.editReply({ content: 'I could not create the rota dashboard, so the previous setup was kept.' });
      }

      if (settings?.channelId && settings.channelId !== channel.id && settings.messageId) {
        const oldChannel = await interaction.guild.channels.fetch(settings.channelId).catch(() => null);
        const oldMessage = await oldChannel?.messages?.fetch(settings.messageId).catch(() => null);
        await oldMessage?.delete().catch(() => null);
      }
      return interaction.editReply({ content: `Staff rota enabled in ${channel} for ${role}.` });
    }

    if (action === 'add') {
      const user = interaction.options.getUser('user', true);
      const day = interaction.options.getInteger('day', true);
      const start = parseTime(interaction.options.getString('start', true));
      const end = parseTime(interaction.options.getString('end', true));
      const timezone = interaction.options.getString('timezone', true);
      const priority = interaction.options.getInteger('priority', true);
      if (start === null || end === null || start === end) {
        return interaction.editReply({ content: 'Use valid 24-hour times such as `09:00` and `17:30`.' });
      }
      if (!validTimezone(timezone)) {
        return interaction.editReply({ content: 'That timezone is invalid. Use a name such as `Europe/London`.' });
      }
      const result = run(
        `INSERT INTO staff_shifts (
           guildId, userId, dayOfWeek, startMinute, endMinute, timezone,
           escalationOrder, active, createdBy, createdAt
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [guildId, user.id, day, start, end, timezone, priority, interaction.user.id, Date.now()]
      );
      await StaffRotaService.refresh(interaction.client, guildId);
      return interaction.editReply({ content: `Added shift #${result.lastInsertRowid} for ${user}.` });
    }

    if (action === 'remove') {
      const id = interaction.options.getInteger('id', true);
      const result = run(`DELETE FROM staff_shifts WHERE id = ? AND guildId = ?`, [id, guildId]);
      await StaffRotaService.refresh(interaction.client, guildId);
      return interaction.editReply({ content: result.changes ? `Removed shift #${id}.` : 'Shift not found.' });
    }

    if (action === 'refresh') {
      const updated = await StaffRotaService.refresh(interaction.client, guildId);
      return interaction.editReply({ content: updated ? 'Staff rota refreshed.' : 'Configure the rota first.' });
    }

    const shifts = all(
      `SELECT * FROM staff_shifts WHERE guildId = ? AND active = 1 ORDER BY dayOfWeek, startMinute`,
      [guildId]
    );
    const lines = shifts.map(shift =>
      `#${shift.id} | ${DAYS[shift.dayOfWeek]} ${StaffRotaService.formatMinute(shift.startMinute)}-${StaffRotaService.formatMinute(shift.endMinute)} ` +
      `(${shift.timezone}) | <@${shift.userId}> | P${shift.escalationOrder}`
    );
    const chunks = [];
    let current = '';
    for (const line of lines) {
      if (current && current.length + line.length + 1 > 3900) {
        chunks.push(current);
        current = '';
      }
      current += `${current ? '\n' : ''}${line}`;
    }
    if (current) chunks.push(current);
    if (!chunks.length) chunks.push('No shifts configured.');
    return interaction.editReply({
      embeds: chunks.slice(0, 10).map((description, index) => new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(index ? 'Staff Shifts (continued)' : 'Staff Shifts')
        .setDescription(description))
    });
  }
};

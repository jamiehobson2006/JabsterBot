const {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder
} = require('discord.js');

const {
  canManageTempVoice,
  deleteTempVoiceRoom,
  disableTempVoice,
  getTempVoiceRoom,
  getTempVoiceRooms,
  getTempVoiceSettings,
  setTempVoiceSettings
} = require('../../utils/tempVoice');

function requireAdmin(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
}

function getCurrentRoom(interaction) {
  const channel = interaction.member?.voice?.channel;
  const room = channel ? getTempVoiceRoom(channel.id) : null;
  return { channel, room };
}

function roomStatusEmbed(interaction, settings) {
  const rooms = getTempVoiceRooms(interaction.guild.id);

  return new EmbedBuilder()
    .setColor(settings?.enabled ? 0x57F287 : 0xED4245)
    .setTitle('Temporary Voice Rooms')
    .addFields(
      {
        name: 'Status',
        value: settings?.enabled ? 'Enabled' : 'Disabled',
        inline: true
      },
      {
        name: 'Lobby',
        value: settings?.lobbyChannelId ? `<#${settings.lobbyChannelId}>` : 'Not set',
        inline: true
      },
      {
        name: 'Category',
        value: settings?.categoryId ? `<#${settings.categoryId}>` : 'No category',
        inline: true
      },
      {
        name: 'Room Name',
        value: settings?.nameTemplate || "{username}'s Room",
        inline: true
      },
      {
        name: 'User Limit',
        value: settings?.userLimit ? String(settings.userLimit) : 'Unlimited',
        inline: true
      },
      {
        name: 'Active Rooms',
        value: String(rooms.length),
        inline: true
      }
    )
    .setFooter({ text: 'Join the lobby channel to create a room.' })
    .setTimestamp();
}

module.exports = {
  cooldown: 1500,
  ephemeral: true,

  data: new SlashCommandBuilder()
    .setName('tempvoice')
    .setDescription('Configure and manage temporary voice rooms')
    .addSubcommand(subcommand => subcommand
      .setName('setup')
      .setDescription('Configure the temporary voice lobby')
      .addChannelOption(option => option
        .setName('lobby')
        .setDescription('Voice channel users join to create a room')
        .addChannelTypes(ChannelType.GuildVoice)
        .setRequired(true))
      .addChannelOption(option => option
        .setName('category')
        .setDescription('Optional category for created rooms')
        .addChannelTypes(ChannelType.GuildCategory))
      .addStringOption(option => option
        .setName('name_template')
        .setDescription('Use {username}, {user}, or {server}')
        .setMaxLength(100))
      .addIntegerOption(option => option
        .setName('user_limit')
        .setDescription('0 means unlimited')
        .setMinValue(0)
        .setMaxValue(99)))
    .addSubcommand(subcommand => subcommand
      .setName('disable')
      .setDescription('Disable new temporary voice rooms'))
    .addSubcommand(subcommand => subcommand
      .setName('status')
      .setDescription('View temporary voice settings'))
    .addSubcommand(subcommand => subcommand
      .setName('rename')
      .setDescription('Rename your current temporary room')
      .addStringOption(option => option
        .setName('name')
        .setDescription('New room name')
        .setMaxLength(100)
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('limit')
      .setDescription('Set your current room user limit')
      .addIntegerOption(option => option
        .setName('amount')
        .setDescription('0 means unlimited')
        .setMinValue(0)
        .setMaxValue(99)
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('lock')
      .setDescription('Prevent new users joining your current room'))
    .addSubcommand(subcommand => subcommand
      .setName('unlock')
      .setDescription('Allow new users to join your current room'))
    .addSubcommand(subcommand => subcommand
      .setName('claim')
      .setDescription('Claim an unowned temporary room you are in'))
    .addSubcommand(subcommand => subcommand
      .setName('delete')
      .setDescription('Delete your current temporary room')),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    if (['setup', 'disable', 'status'].includes(subcommand)) {
      if (!requireAdmin(interaction)) {
        return interaction.editReply({ content: 'Administrator permission is required.' });
      }

      if (subcommand === 'status') {
        return interaction.editReply({
          embeds: [roomStatusEmbed(interaction, getTempVoiceSettings(interaction.guild.id))],
          allowedMentions: { parse: [] }
        });
      }

      if (subcommand === 'disable') {
        const result = disableTempVoice(interaction.guild.id, interaction.user.id);
        return interaction.editReply({
          content: result.changes
            ? 'Temporary voice rooms are disabled. Existing rooms remain until empty.'
            : 'Temporary voice rooms have not been configured.'
        });
      }

      const lobby = interaction.options.getChannel('lobby', true);
      const category = interaction.options.getChannel('category');
      const nameTemplate = interaction.options.getString('name_template') || "{username}'s Room";
      const userLimit = interaction.options.getInteger('user_limit') || 0;
      const botMember = interaction.guild.members.me;
      const lobbyPermissions = lobby.permissionsFor(botMember);

      if (!lobbyPermissions?.has([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.MoveMembers
      ]) || !botMember.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return interaction.editReply({
          content: 'I need Manage Channels, Move Members, View Channel, and Connect permissions.'
        });
      }

      setTempVoiceSettings({
        guildId: interaction.guild.id,
        enabled: true,
        lobbyChannelId: lobby.id,
        categoryId: category?.id || null,
        nameTemplate,
        userLimit,
        updatedBy: interaction.user.id
      });

      return interaction.editReply({
        content: `Temporary voice is enabled. Join ${lobby} to create a room.`
      });
    }

    const { channel, room } = getCurrentRoom(interaction);

    if (!channel || !room) {
      return interaction.editReply({
        content: 'Join a temporary voice room before using that command.'
      });
    }

    if (subcommand === 'claim') {
      const ownerPresent = channel.members.has(room.ownerId);

      if (ownerPresent && room.ownerId !== interaction.user.id && !requireAdmin(interaction)) {
        return interaction.editReply({
          content: 'The current room owner is still in this room.'
        });
      }

      const { run } = require('../../database');
      run(
        `UPDATE temp_voice_rooms
         SET ownerId = ?
         WHERE channelId = ?`,
        [interaction.user.id, channel.id]
      );

      return interaction.editReply({ content: `You now own ${channel}.` });
    }

    if (!canManageTempVoice(interaction.member, room)) {
      return interaction.editReply({
        content: 'Only the room owner or a member with Manage Channels can do that.'
      });
    }

    if (subcommand === 'rename') {
      const name = interaction.options.getString('name', true).trim();
      await channel.setName(name, `Temporary room renamed by ${interaction.user.tag}`);
      return interaction.editReply({ content: `Room renamed to **${name}**.` });
    }

    if (subcommand === 'limit') {
      const amount = interaction.options.getInteger('amount', true);
      await channel.setUserLimit(amount, `Temporary room limit changed by ${interaction.user.tag}`);
      return interaction.editReply({
        content: amount ? `Room limit set to ${amount}.` : 'Room limit removed.'
      });
    }

    if (subcommand === 'lock' || subcommand === 'unlock') {
      const locked = subcommand === 'lock';
      await channel.permissionOverwrites.edit(
        interaction.guild.roles.everyone,
        { Connect: locked ? false : null },
        { reason: `Temporary room ${locked ? 'locked' : 'unlocked'} by ${interaction.user.tag}` }
      );

      return interaction.editReply({ content: locked ? 'Room locked.' : 'Room unlocked.' });
    }

    const deleted = await deleteTempVoiceRoom(
      interaction.client,
      channel,
      `Temporary room deleted by ${interaction.user.tag}`
    );

    return interaction.editReply({
      content: deleted
        ? 'Temporary room deleted.'
        : 'I could not delete this room. Check that I have Manage Channels permission.'
    });
  }
};

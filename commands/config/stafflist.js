const {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder
} = require('discord.js');

const {
  run,
  get
} = require('../../database');

const StaffListService =
  require('../../services/StaffListService');

module.exports = {
  cooldown: 3000,
  ephemeral: true,

  data: new SlashCommandBuilder()
    .setName('stafflist')
    .setDescription('Configure the automatic staff directory')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(subcommand =>
      subcommand
        .setName('set')
        .setDescription('Set the staff directory channel and role')
        .addChannelOption(option =>
          option
            .setName('channel')
            .setDescription('Channel for the staff directory')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
        .addRoleOption(option =>
          option
            .setName('staff_role')
            .setDescription('Role that identifies staff members')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('refresh')
        .setDescription('Refresh this server staff directory now')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('clear')
        .setDescription('Disable the automatic staff directory')
    ),

  async execute(interaction) {
    if (
      !interaction.memberPermissions.has(
        PermissionFlagsBits.Administrator
      )
    ) {
      return interaction.editReply({
        content: 'You need Administrator permission.'
      });
    }

    const subcommand =
      interaction.options.getSubcommand();
    const previous = get('SELECT staffListChannelId,staffListRoleId,staffListMessageId,staffListMessageIds FROM guild_settings WHERE guildId=?', [interaction.guild.id]);

    if (subcommand === 'clear') {
      run(
        `INSERT INTO guild_settings (
           guildId,
           staffListChannelId,
           staffListRoleId,
           staffListMessageId
         )
         VALUES (?, NULL, NULL, NULL)
         ON CONFLICT(guildId)
         DO UPDATE SET staffListChannelId = NULL,
                       staffListRoleId = NULL,
                       staffListMessageId = NULL, staffListMessageIds = NULL`,
        [interaction.guild.id]
      );

      return interaction.editReply({
        content: 'The automatic staff directory has been disabled.'
      });
    }

    if (subcommand === 'set') {
      const channel =
        interaction.options.getChannel('channel', true);

      const role =
        interaction.options.getRole('staff_role', true);

      if (role.managed || role.id === interaction.guild.roles.everyone.id) {
        return interaction.editReply({
          content: 'Choose a normal server role for the staff directory.'
        });
      }

      const permissions =
        channel.permissionsFor(interaction.guild.members.me);

      if (
        !permissions?.has([
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.EmbedLinks,
          PermissionFlagsBits.ReadMessageHistory
        ])
      ) {
        return interaction.editReply({
          content: 'I need View Channel, Send Messages, Embed Links, and Read Message History there.'
        });
      }

      run(
        `INSERT INTO guild_settings (
           guildId,
           staffListChannelId,
           staffListRoleId,
           staffListMessageId
         )
         VALUES (?, ?, ?, NULL)
         ON CONFLICT(guildId)
         DO UPDATE SET staffListChannelId = excluded.staffListChannelId,
                       staffListRoleId = excluded.staffListRoleId,
                       staffListMessageId = CASE WHEN guild_settings.staffListChannelId=excluded.staffListChannelId THEN guild_settings.staffListMessageId ELSE NULL END,
                       staffListMessageIds = CASE WHEN guild_settings.staffListChannelId=excluded.staffListChannelId THEN guild_settings.staffListMessageIds ELSE NULL END`,
        [
          interaction.guild.id,
          channel.id,
          role.id
        ]
      );
    }

    const refreshed =
      await StaffListService.refreshGuild(interaction.guild);

    if (refreshed && subcommand === 'set' && previous?.staffListChannelId &&
        previous.staffListChannelId !== interaction.options.getChannel('channel').id) {
      const oldChannel = await interaction.guild.channels.fetch(previous.staffListChannelId).catch(() => null);
      const { messageIds, removeEmbedPages } = require('../../utils/embedPages');
      await removeEmbedPages(oldChannel, messageIds(previous.staffListMessageIds, previous.staffListMessageId), interaction.client.user.id)
        .catch(error => console.error('Old staff directory cleanup:', error.message));
    }

    return interaction.editReply({
      content: refreshed
        ? 'Staff directory updated. It will refresh automatically every 24 hours.'
        : 'The staff directory could not be updated. Check my permissions and configuration.'
    });
  }
};

const {
  PermissionsBitField,
  EmbedBuilder,
  SlashCommandBuilder,
  ChannelType
} = require('discord.js');

const {
  sendLog,
  createLogEmbed
} = require('../../utils/logger');

module.exports = {

  cooldown: 3000,

  data: new SlashCommandBuilder()

    .setName('unlock')

    .setDescription('Unlock the current channel'),

  async execute(interaction) {

    try {

      // ========================
      // 🔐 USER PERMISSION
      // ========================
      if (
        !interaction.memberPermissions.has(
          PermissionsBitField.Flags.ManageChannels
        )
      ) {

        return interaction.editReply({
          content:
            '❌ You need **Manage Channels** permission.'
        });
      }

      const channel =
        interaction.channel;

      const botMember =
        interaction.guild.members.me;

      // ========================
      // 🤖 BOT PERMISSION
      // ========================
      if (
        !botMember.permissions.has(
          PermissionsBitField.Flags.ManageChannels
        )
      ) {

        return interaction.editReply({
          content:
            '❌ I do not have permission to manage channels.'
        });
      }

      // ========================
      // 🚫 CHANNEL CHECK
      // ========================
      if (
        ![
          ChannelType.GuildText,
          ChannelType.GuildAnnouncement
        ].includes(channel.type)
      ) {

        return interaction.editReply({
          content:
            '❌ This command can only be used in text channels.'
        });
      }

      const everyone =
        interaction.guild.roles.everyone;

      const overwrite =
        channel.permissionOverwrites.cache.get(
          everyone.id
        );

      // ========================
      // 🧠 ALREADY UNLOCKED
      // ========================
      const isLocked =
        overwrite?.deny?.has(
          PermissionsBitField.Flags.SendMessages
        );

      if (!isLocked) {

        return interaction.editReply({
          content:
            '⚠️ This channel is already unlocked.'
        });
      }

      // ========================
      // 🔓 UNLOCK CHANNEL
      // ========================
      await channel.permissionOverwrites.edit(
        everyone,
        {
          SendMessages: null
        }
      );

      // ========================
      // 🎨 EMBED
      // ========================
      const embed =
        new EmbedBuilder()

          .setTitle(
            '🔓 Channel Unlocked'
          )

          .setColor(0x57F287)

          .setDescription(
            'Members can now send messages again.'
          )

          .setFooter({
            text:
              `Unlocked by ${interaction.user.tag}`
          })

          .setTimestamp();

      // ========================
      // ✅ RESPONSE
      // ========================
      await interaction.editReply({
        embeds: [embed]
      });

      // ========================
      // 🗑 AUTO DELETE
      // ========================
      setTimeout(() => {

        interaction
          .deleteReply()
          .catch(() => {});

      }, 2000);

      // ========================
      // 📜 LOG
      // ========================
      const log =
        createLogEmbed({

          action: 'UNLOCK',

          user: {
            id: 'CHANNEL',
            tag: channel.name
          },

          moderator: interaction.user,

          reason:
            `Unlocked #${channel.name}`
        });

      await sendLog(
        interaction.client,
        interaction.guild.id,
        log
      );

    } catch (err) {

      console.error(
        'Unlock Error:',
        err
      );

      if (
        interaction.deferred ||
        interaction.replied
      ) {

        return interaction.editReply({
          content:
            '❌ Failed to unlock channel. Check my permissions.'
        });
      }

      return interaction.reply({

        content:
          '❌ Failed to unlock channel.',

        ephemeral: true
      });
    }
  }
};
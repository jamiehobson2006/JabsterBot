const {
  PermissionsBitField,
  EmbedBuilder,
  SlashCommandBuilder,
  ChannelType
} = require('discord.js');

const { sendLog, createLogEmbed } = require('../../utils/logger');

module.exports = {

  cooldown: 3000,

  data: new SlashCommandBuilder()
    .setName('lock')
    .setDescription('Lock the current channel')

    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Reason for locking the channel')
        .setMaxLength(200)
    ),

  async execute(interaction) {

    try {

      // ========================
      // 🔐 PERMISSION CHECK
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

      const channel = interaction.channel;

      const reason =
        interaction.options.getString('reason') ||
        'No reason provided';

      const botMember =
        interaction.guild.members.me;

      // ========================
      // 📺 CHANNEL TYPE CHECK
      // ========================
      if (
        !channel ||
        ![
          ChannelType.GuildText,
          ChannelType.GuildAnnouncement
        ].includes(channel.type)
      ) {

        return interaction.editReply({
          content:
            '❌ You can only lock text channels.'
        });
      }

      // ========================
      // 🤖 BOT PERMISSIONS
      // ========================
      const perms =
        channel.permissionsFor(botMember);

      if (
        !perms?.has([
          PermissionsBitField.Flags.ManageChannels,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ViewChannel
        ])
      ) {

        return interaction.editReply({
          content:
            '❌ I am missing permissions in this channel.'
        });
      }

      const everyoneRole =
        interaction.guild.roles.everyone;

      // ========================
      // 🔒 ALREADY LOCKED?
      // ========================
      const overwrite =
        channel.permissionOverwrites.cache.get(
          everyoneRole.id
        );

      const alreadyLocked =
        overwrite?.deny.has(
          PermissionsBitField.Flags.SendMessages
        );

      if (alreadyLocked) {

        return interaction.editReply({
          content:
            '⚠️ This channel is already locked.'
        });
      }

      // ========================
      // 🔒 LOCK CHANNEL
      // ========================
      await channel.permissionOverwrites.edit(
        everyoneRole,
        {
          SendMessages: false
        }
      );

      // ========================
      // 📢 PUBLIC MESSAGE
      // ========================
      const lockMessage =
        await channel.send({

          embeds: [

            new EmbedBuilder()

              .setColor(0xED4245)

              .setTitle('🔒 Channel Locked')

              .setDescription(
                `**Reason:** ${reason}`
              )

              .setFooter({
                text:
                  `Locked by ${interaction.user.tag}`
              })

              .setTimestamp()
          ]
        });

      // 🧹 AUTO DELETE
      setTimeout(() => {
        lockMessage.delete().catch(() => {});
      }, 2000);

      // ========================
      // ✅ RESPONSE
      // ========================
      await interaction.editReply({
        content:
          `✅ Locked ${channel}.`
      });

      // ========================
      // 📜 MOD LOG
      // ========================
      const logEmbed =
        createLogEmbed({

          action: 'LOCK',

          user: {
            id: channel.id,
            tag: `#${channel.name}`
          },

          moderator: interaction.user,

          reason,

          caseId: null
        });

      await sendLog(
        interaction.client,
        interaction.guild.id,
        logEmbed
      );

    } catch (err) {

      console.error(
        'Lock Command Error:',
        err
      );

      if (
        interaction.deferred ||
        interaction.replied
      ) {

        return interaction.editReply({
          content:
            '❌ Failed to lock channel.'
        });
      }

      return interaction.reply({
        content:
          '❌ Failed to lock channel.',
        ephemeral: true
      });
    }
  }
};
const {
  ChannelType,
  EmbedBuilder,
  PermissionsBitField,
  SlashCommandBuilder
} = require('discord.js');

const {
  run
} = require('../../database');

const {
  createLogEmbed,
  sendLog
} = require('../../utils/logger');

module.exports = {
  cooldown: 3000,

  data:
    new SlashCommandBuilder()
      .setName('unlock')
      .setDescription('Unlock the current channel')
      .addStringOption(option =>
        option
          .setName('reason')
          .setDescription('Reason for unlocking the channel')
          .setMaxLength(200)
      ),

  async execute(interaction) {
    try {
      if (
        !interaction.memberPermissions.has(
          PermissionsBitField.Flags.ManageChannels
        )
      ) {
        return interaction.editReply({
          content:
            'You need Manage Channels permission.'
        });
      }

      const botMember =
        interaction.guild.members.me;

      if (
        !botMember.permissions.has(
          PermissionsBitField.Flags.ManageChannels
        )
      ) {
        return interaction.editReply({
          content:
            'I do not have Manage Channels permission.'
        });
      }

      const channel =
        interaction.channel;

      if (
        !channel ||
        ![
          ChannelType.GuildText,
          ChannelType.GuildAnnouncement
        ].includes(channel.type)
      ) {
        return interaction.editReply({
          content:
            'You can only unlock text channels.'
        });
      }

      const reason =
        interaction.options.getString('reason') ||
        'No reason provided';

      const everyoneRole =
        interaction.guild.roles.everyone;

      const overwrite =
        channel.permissionOverwrites.cache.get(
          everyoneRole.id
        );

      const isLocked =
        overwrite?.deny?.has(
          PermissionsBitField.Flags.SendMessages
        );

      if (!isLocked) {
        return interaction.editReply({
          content:
            'This channel is already unlocked.'
        });
      }

      await channel.permissionOverwrites.edit(
        everyoneRole,
        {
          SendMessages: null
        },
        {
          reason:
            `Unlocked by ${interaction.user.tag} | ${reason}`
        }
      );

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x57F287)
            .setTitle('Channel Unlocked')
            .setDescription(
              'Members can now send messages again.'
            )
            .addFields(
              {
                name: 'Channel',
                value: `${channel}`,
                inline: true
              },
              {
                name: 'Moderator',
                value: `${interaction.user}`,
                inline: true
              },
              {
                name: 'Reason',
                value: reason
              }
            )
            .setFooter({
              text:
                `${interaction.guild.name} Moderation`
            })
            .setTimestamp()
        ]
      });

      run(
        `INSERT INTO audit_logs
         (
           guildId,
           action,
           targetId,
           executorId,
           metadata,
           timestamp
         )
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          interaction.guild.id,
          'UNLOCK',
          channel.id,
          interaction.user.id,
          JSON.stringify({
            reason,
            channelId: channel.id
          }),
          Date.now()
        ]
      );

      const logEmbed =
        createLogEmbed({
          action: 'UNLOCK',
          user: {
            id: channel.id,
            tag: `#${channel.name}`
          },
          moderator:
            interaction.user,
          reason
        });

      await sendLog(
        interaction.client,
        interaction.guild.id,
        logEmbed
      );

    } catch (err) {
      console.error(
        'Unlock Command Error:',
        err
      );

      return interaction.editReply({
        content:
          'Failed to unlock channel.'
      });
    }
  }
};

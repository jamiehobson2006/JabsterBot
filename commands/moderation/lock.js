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
            'You can only lock text channels.'
        });
      }

      const reason =
        interaction.options.getString('reason') ||
        'No reason provided';

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
            'I am missing permissions in this channel.'
        });
      }

      const everyoneRole =
        interaction.guild.roles.everyone;

      const overwrite =
        channel.permissionOverwrites.cache.get(
          everyoneRole.id
        );

      if (
        overwrite?.deny.has(
          PermissionsBitField.Flags.SendMessages
        )
      ) {
        return interaction.editReply({
          content:
            'This channel is already locked.'
        });
      }

      await channel.permissionOverwrites.edit(
        everyoneRole,
        {
          SendMessages: false
        },
        {
          reason:
            `Locked by ${interaction.user.tag} | ${reason}`
        }
      );

      const publicEmbed =
        new EmbedBuilder()
          .setColor(0xED4245)
          .setTitle('Channel Locked')
          .setDescription('This channel has been locked.')
          .addFields(
            {
              name: 'Reason',
              value: reason
            },
            {
              name: 'Moderator',
              value: `${interaction.user}`,
              inline: true
            }
          )
          .setFooter({
            text:
              `${interaction.guild.name} Moderation`
          })
          .setTimestamp();

      const publicMessage =
        await channel.send({
          embeds: [publicEmbed]
        });

      setTimeout(() => {
        publicMessage.delete().catch(() => {});
      }, 5000);

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x57F287)
            .setTitle('Channel Locked')
            .setDescription(
              `${channel} has been locked successfully.`
            )
            .addFields({
              name: 'Reason',
              value: reason
            })
            .setFooter({
              text:
                `Moderator: ${interaction.user.tag}`
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
          'LOCK',
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
          action: 'LOCK',
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
        'Lock Command Error:',
        err
      );

      return interaction.editReply({
        content:
          'Failed to lock channel.'
      });
    }
  }
};

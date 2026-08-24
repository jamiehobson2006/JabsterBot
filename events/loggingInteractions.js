const {
  ChannelType,
  MessageFlags
} = require('discord.js');

const {
  disableLogCategory,
  getCategory,
  getLogDestination,
  setLogDestination
} = require('../utils/loggingConfig');

const {
  createAuditEmbed,
  logAudit
} = require('../utils/logger');

const {
  buildLoggingCategoryPanel,
  buildLoggingDashboard,
  canConfigureLogging
} = require('../utils/loggingPanel');

function isLoggingInteraction(interaction) {
  return Boolean(
    interaction.isButton?.() ||
    interaction.isStringSelectMenu?.() ||
    interaction.isChannelSelectMenu?.()
  ) && String(interaction.customId || '').startsWith('logging_');
}

async function deny(interaction) {
  return interaction.reply({
    content: 'You need Administrator permission or a logging manager role to configure logging.',
    flags: MessageFlags.Ephemeral
  });
}

function isValidDestination(channel, guildId) {
  return Boolean(
    channel &&
    channel.guildId === guildId &&
    [
      ChannelType.GuildText,
      ChannelType.GuildAnnouncement
    ].includes(channel.type)
  );
}

module.exports = {
  name: 'interactionCreate',

  async execute(interaction) {
    if (!interaction.inGuild?.() || !isLoggingInteraction(interaction)) {
      return;
    }

    try {
      if (!canConfigureLogging(interaction)) {
        return deny(interaction);
      }

      if (
        interaction.isStringSelectMenu() &&
        interaction.customId === 'logging_category_select'
      ) {
        const type = interaction.values[0];

        if (!getCategory(type)) {
          return interaction.reply({
            content: 'That logging category is invalid.',
            flags: MessageFlags.Ephemeral
          });
        }

        return interaction.update(
          buildLoggingCategoryPanel(interaction.guild.id, type)
        );
      }

      if (interaction.isChannelSelectMenu()) {
        const type = interaction.customId.replace('logging_channel_', '');
        const channel = interaction.channels.first();

        if (!getCategory(type) || !isValidDestination(channel, interaction.guild.id)) {
          return interaction.reply({
            content: 'Choose a text or announcement channel in this server.',
            flags: MessageFlags.Ephemeral
          });
        }

        const permissions = channel.permissionsFor(
          interaction.guild.members.me
        );

        if (!permissions?.has([
          'ViewChannel',
          'SendMessages',
          'EmbedLinks'
        ])) {
          return interaction.reply({
            content: 'I need View Channel, Send Messages, and Embed Links in that channel.',
            flags: MessageFlags.Ephemeral
          });
        }

        setLogDestination({
          guildId: interaction.guild.id,
          type,
          channelId: channel.id
        });

        return interaction.update(
          buildLoggingCategoryPanel(
            interaction.guild.id,
            type,
            `${getCategory(type).label} logs are now being sent to <#${channel.id}>.`
          )
        );
      }

      if (interaction.isButton() && interaction.customId === 'logging_dashboard') {
        return interaction.update(
          buildLoggingDashboard(interaction.guild.id)
        );
      }

      if (
        interaction.isButton() &&
        interaction.customId.startsWith('logging_test_')
      ) {
        const type = interaction.customId.replace('logging_test_', '');
        const destination = getLogDestination(interaction.guild.id, type);

        if (!getCategory(type)) {
          return interaction.reply({
            content: 'That logging category is invalid.',
            flags: MessageFlags.Ephemeral
          });
        }

        if (!destination.enabled || !destination.channelId) {
          return interaction.update(
            buildLoggingCategoryPanel(
              interaction.guild.id,
              type,
              'Set a channel for this category before sending a test log.'
            )
          );
        }

        await interaction.deferUpdate();

        await logAudit(
          interaction.client,
          interaction.guild.id,
          {
            action: 'LOGGING_TEST_SENT',
            targetId: interaction.user.id,
            executorId: interaction.user.id,
            type,
            metadata: {
              test: true,
              channelId: destination.channelId
            },
            embed: createAuditEmbed({
              action: `${getCategory(type).label} Log Test`,
              target: `${interaction.user.tag}\n<@${interaction.user.id}>`,
              executor: `${interaction.user.tag}\n<@${interaction.user.id}>`,
              channel: `<#${destination.channelId}>`,
              extra: 'This test confirms that this logging category is routed correctly.',
              color: 0x5865F2
            })
          }
        );

        return interaction.editReply(
          buildLoggingCategoryPanel(
            interaction.guild.id,
            type,
            `A test log was sent to <#${destination.channelId}>.`
          )
        );
      }

      if (interaction.isButton()) {
        const type = interaction.customId.replace('logging_disable_', '');

        if (!getCategory(type)) {
          return;
        }

        disableLogCategory({
          guildId: interaction.guild.id,
          type
        });

        return interaction.update(
          buildLoggingCategoryPanel(
            interaction.guild.id,
            type,
            `${getCategory(type).label} logs have been disabled.`
          )
        );
      }
    } catch (err) {
      console.error('Logging interaction error:', err);

      if (interaction.deferred || interaction.replied) {
        return interaction.followUp({
          content: 'Failed to update logging configuration.',
          flags: MessageFlags.Ephemeral
        }).catch(() => null);
      }

      return interaction.reply({
        content: 'Failed to update logging configuration.',
        flags: MessageFlags.Ephemeral
      }).catch(() => null);
    }
  }
};

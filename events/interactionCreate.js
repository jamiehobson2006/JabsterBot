const { EmbedBuilder, MessageFlags, PermissionsBitField } = require('discord.js');
const { get, run } = require('../database');
const { useCooldown } = require('../utils/cooldowns');

const ephemeralCommands = [
  'ban',
  'kick',
  'mute',
  'unmute',
  'warn',
  'warnings',
  'clearwarns',
  'case',
  'modlogs',
  'history',
  'editcase',
  'modlogremove',
  'purge',
  'role',
  'poll',
  'slowmode',
  'lock',
  'unlock',
  'setmodlogs',
  'suggestchannel',
  'setstaffrole',
  'setadminrole',
  'setgiveawayrole',
  'setticketchannel',
  'settranscriptchannel',
  'ticketpanel',
  'ticketstats',
];

function isStaleInteractionError(error) {
  return error?.code === 10062 || error?.code === 40060;
}

async function safelyDeferReply(interaction, ephemeral) {
  if (interaction.deferred || interaction.replied) return true;

  try {
    await interaction.deferReply({
      flags: ephemeral ? MessageFlags.Ephemeral : undefined,
    });
    return true;
  } catch (error) {
    if (!isStaleInteractionError(error)) {
      console.error('Failed to defer interaction:', error);
    }
    return false;
  }
}

async function safelyReply(interaction, payload) {
  try {
    if (interaction.deferred || interaction.replied) {
      return interaction.editReply(payload);
    }

    return interaction.reply(payload);
  } catch (error) {
    if (!isStaleInteractionError(error)) {
      console.error('Failed to respond to interaction:', error);
    }
    return null;
  }
}

module.exports = {
  name: 'interactionCreate',

  async execute(interaction, client) {
    if (interaction.isButton()) {
      try {
        const { customId } = interaction;

        if (customId.startsWith('suggest_')) {
          if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
            return safelyReply(interaction, {
              content: 'Admin only.',
              flags: MessageFlags.Ephemeral,
            });
          }

          await interaction.deferUpdate();
          const messageId = interaction.message.id;
          const suggestion = get('SELECT * FROM suggestions WHERE messageId = ?', [messageId]);

          if (!suggestion) {
            return interaction.followUp({
              content: 'Suggestion not found.',
              flags: MessageFlags.Ephemeral,
            });
          }

          if (suggestion.status !== 'PENDING') {
            return interaction.followUp({
              content: `Already ${suggestion.status}.`,
              flags: MessageFlags.Ephemeral,
            });
          }

          const embed = EmbedBuilder.from(interaction.message.embeds[0]);

          if (customId.startsWith('suggest_accept')) {
            embed.setColor(0x57F287).setFooter({ text: `Accepted by ${interaction.user.tag}` });
            run('UPDATE suggestions SET status = ?, moderatorId = ? WHERE messageId = ?', [
              'ACCEPTED',
              interaction.user.id,
              messageId,
            ]);
          } else if (customId.startsWith('suggest_deny')) {
            embed.setColor(0xED4245).setFooter({ text: `Denied by ${interaction.user.tag}` });
            run('UPDATE suggestions SET status = ?, moderatorId = ? WHERE messageId = ?', [
              'DENIED',
              interaction.user.id,
              messageId,
            ]);
          }

          return interaction.message.edit({ embeds: [embed], components: [] });
        }

        return;
      } catch (err) {
        console.error('Button error:', err);
        if (!interaction.replied && !interaction.deferred) {
          return safelyReply(interaction, {
            content: 'Error handling button.',
            flags: MessageFlags.Ephemeral,
          });
        }
      }
    }

    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
      const shouldBeEphemeral = ephemeralCommands.includes(interaction.commandName);
      const acknowledged = await safelyDeferReply(interaction, shouldBeEphemeral);
      if (!acknowledged) return;

      const cooldown = await useCooldown(
        interaction.guild?.id,
        interaction.user.id,
        interaction.commandName,
        command.cooldown || 1500,
      );

      if (cooldown > 0) {
        return safelyReply(interaction, {
          content: `Slow down! Try again in **${Math.ceil(cooldown / 1000)}s**.`,
        });
      }

      await command.execute(interaction, client);
    } catch (error) {
      console.error(`Command error (${interaction.commandName}):`, error);

      await safelyReply(interaction, {
        content: 'Something went wrong.',
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};

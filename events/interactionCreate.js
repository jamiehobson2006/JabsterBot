const {
  MessageFlags
} = require('discord.js');

const {
  useCooldown
} = require('../utils/cooldowns');

const ephemeralCommands =
  new Set([
    'application',
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
    'settranscriptchannel',
    'linkblock',
    'ticketsetup',
    'ticketpanel',
    'ticketstats',
    'dailyfact'
  ]);

function isStaleInteractionError(error) {
  return (
    error?.code === 10062 ||
    error?.code === 40060 ||
    error?.code === 10015
  );
}

async function safelyDeferReply(
  interaction,
  ephemeral
) {
  if (
    interaction.deferred ||
    interaction.replied
  ) {
    return true;
  }

  try {
    await interaction.deferReply({
      flags:
        ephemeral
          ? MessageFlags.Ephemeral
          : undefined
    });

    return true;

  } catch (error) {
    if (!isStaleInteractionError(error)) {
      console.error(
        'Failed to defer interaction:',
        error
      );
    }

    return false;
  }
}

async function safelyReply(
  interaction,
  payload
) {
  try {
    if (
      interaction.deferred ||
      interaction.replied
    ) {
      try {
        return await interaction.editReply(
          payload
        );

      } catch {
        return await interaction.followUp({
          ...payload,
          flags:
            payload.flags ||
            MessageFlags.Ephemeral
        });
      }
    }

    return await interaction.reply({
      ...payload,
      flags:
        payload.flags ||
        MessageFlags.Ephemeral
    });

  } catch (error) {
    if (!isStaleInteractionError(error)) {
      console.error(
        'Failed to reply to interaction:',
        error
      );
    }

    return null;
  }
}

module.exports = {
  name: 'interactionCreate',

  async execute(
    interaction,
    client
  ) {
    if (
      !interaction.guild ||
      !interaction.isChatInputCommand()
    ) {
      return;
    }

    const command =
      client.commands.get(
        interaction.commandName
      );

    if (!command) {
      return safelyReply(
        interaction,
        {
          content:
            'This command is outdated. Try redeploying slash commands.',
          flags: MessageFlags.Ephemeral
        }
      );
    }

    const shouldBeEphemeral =
      command.ephemeral ||
      ephemeralCommands.has(
        interaction.commandName
      );

    const acknowledged =
      await safelyDeferReply(
        interaction,
        shouldBeEphemeral
      );

    if (!acknowledged) {
      return;
    }

    try {
      const cooldown =
        await useCooldown(
          interaction.guild.id,
          interaction.user.id,
          interaction.commandName,
          command.cooldown || 1500
        );

      if (cooldown > 0) {
        return safelyReply(
          interaction,
          {
            content:
              `Slow down. Try again in **${Math.ceil(cooldown / 1000)}s**.`,
            flags: MessageFlags.Ephemeral
          }
        );
      }

      await command.execute(
        interaction,
        client
      );

    } catch (error) {
      console.error(
        `Command Error (${interaction.commandName}):`,
        error
      );

      if (error?.code === 50013) {
        return safelyReply(
          interaction,
          {
            content:
              'I am missing permissions to perform that action.',
            flags: MessageFlags.Ephemeral
          }
        );
      }

      if (error?.code === 10003) {
        return safelyReply(
          interaction,
          {
            content:
              'Channel not found.',
            flags: MessageFlags.Ephemeral
          }
        );
      }

      if (error?.code === 10007) {
        return safelyReply(
          interaction,
          {
            content:
              'User not found.',
            flags: MessageFlags.Ephemeral
          }
        );
      }

      return safelyReply(
        interaction,
        {
          content:
            'Something went wrong.',
          flags: MessageFlags.Ephemeral
        }
      );
    }
  }
};

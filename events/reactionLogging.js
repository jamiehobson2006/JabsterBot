const {
  createAuditEmbed,
  logAudit
} = require('../utils/logger');

const {
  getLogDestination
} = require('../utils/loggingConfig');

async function hydrateReaction(reaction) {
  if (reaction.partial) {
    await reaction.fetch();
  }

  if (reaction.message.partial) {
    await reaction.message.fetch();
  }

  return reaction;
}

function emojiText(reaction) {
  return reaction.emoji.id
    ? `<:${reaction.emoji.name}:${reaction.emoji.id}>`
    : reaction.emoji.name || 'Unknown emoji';
}

async function logReaction(reaction, user, client, action, color) {
  if (user.bot || !reaction.message.guild) {
    return;
  }

  const guild = reaction.message.guild;

  if (!getLogDestination(guild.id, 'REACTIONS').enabled) {
    return;
  }

  await hydrateReaction(reaction);

  const message = reaction.message;
  const messageLink =
    `https://discord.com/channels/${guild.id}/${message.channel.id}/${message.id}`;

  await logAudit(client, guild.id, {
    action,
    targetId: user.id,
    type: 'REACTIONS',
    metadata: {
      userId: user.id,
      emoji: reaction.emoji.identifier,
      channelId: message.channel.id,
      messageId: message.id
    },
    embed: createAuditEmbed({
      action: action === 'REACTION_ADDED'
        ? 'Reaction Added'
        : 'Reaction Removed',
      target: `${user.tag}\n<@${user.id}>`,
      channel: `<#${message.channel.id}>`,
      messageLink: `[Jump to message](${messageLink})`,
      extra: `Emoji: ${emojiText(reaction)}`,
      color
    })
  });
}

module.exports = {
  name: 'messageReactionAdd',

  async execute(reaction, user, client) {
    try {
      await logReaction(
        reaction,
        user,
        client,
        'REACTION_ADDED',
        0x57F287
      );
    } catch (err) {
      console.error('Reaction add logging error:', err);
    }
  }
};

module.exports.removeReactionLog = async function removeReactionLog(
  reaction,
  user,
  client
) {
  try {
    await logReaction(
      reaction,
      user,
      client,
      'REACTION_REMOVED',
      0xED4245
    );
  } catch (err) {
    console.error('Reaction remove logging error:', err);
  }
};

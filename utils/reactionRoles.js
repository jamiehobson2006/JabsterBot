function parseReactionEmoji(input) {

  const value =
    String(input || '').trim();

  const customEmoji =
    value.match(/^<a?:([A-Za-z0-9_]+):(\d+)>$/);

  if (customEmoji) {

    return {
      display: value,
      key: `${customEmoji[1]}:${customEmoji[2]}`
    };
  }

  if (!value || /\s/.test(value) || value.length > 32) {

    return null;
  }

  return {
    display: value,
    key: value
  };
}

function reactionEmojiKey(reaction) {

  if (reaction.emoji.id) {

    return `${reaction.emoji.name}:${reaction.emoji.id}`;
  }

  return reaction.emoji.name || null;
}

function canManageReactionRole(
  guild,
  role
) {

  const botMember =
    guild.members.me;

  return Boolean(
    role &&
    !role.managed &&
    botMember &&
    botMember.permissions.has(
      PermissionFlagsBits.ManageRoles
    ) &&
    role.position < botMember.roles.highest.position
  );
}

module.exports = {
  canManageReactionRole,
  parseReactionEmoji,
  reactionEmojiKey
};
const {
  PermissionFlagsBits
} = require('discord.js');

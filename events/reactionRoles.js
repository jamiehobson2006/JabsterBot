const {
  all,
  get
} = require('../database');

const {
  canManageReactionRole,
  reactionEmojiKey
} = require('../utils/reactionRoles');

async function hydrateReaction(reaction) {

  if (reaction.partial) {

    await reaction.fetch();
  }

  if (reaction.message.partial) {

    await reaction.message.fetch();
  }

  return reaction;
}

async function getReactionRoleMapping(reaction) {

  const emojiKey =
    reactionEmojiKey(reaction);

  if (!emojiKey) {

    return null;
  }

  return get(
    `SELECT mappings.roleId,
            panels.exclusive,
            panels.guildId
     FROM reaction_role_mappings AS mappings
     INNER JOIN reaction_role_panels AS panels
       ON panels.messageId = mappings.messageId
     WHERE mappings.messageId = ?
     AND mappings.emojiKey = ?`,
    [reaction.message.id, emojiKey]
  );
}

async function removeExclusiveRoles({
  guild,
  member,
  messageId,
  keptRoleId
}) {

  const mappings =
    all(
      `SELECT roleId
       FROM reaction_role_mappings
       WHERE messageId = ?
       AND roleId != ?`,
      [messageId, keptRoleId]
    );

  for (const mapping of mappings) {

    const role =
      guild.roles.cache.get(mapping.roleId);

    if (
      member.roles.cache.has(mapping.roleId) &&
      canManageReactionRole(guild, role)
    ) {

      await member.roles.remove(
        role,
        'Exclusive reaction role selection'
      );
    }
  }
}

async function addReactionRole(reaction, user) {

  if (user.bot || !reaction.message.guild) {

    return;
  }

  await hydrateReaction(reaction);

  const mapping =
    await getReactionRoleMapping(reaction);

  if (mapping?.guildId !== reaction.message.guild.id) {

    return;
  }

  const member =
    await reaction.message.guild.members.fetch(user.id)
      .catch(() => null);

  const role =
    reaction.message.guild.roles.cache.get(mapping.roleId);

  if (!member || !canManageReactionRole(reaction.message.guild, role)) {

    return;
  }

  try {

    if (mapping.exclusive) {

      await removeExclusiveRoles({
        guild: reaction.message.guild,
        member,
        messageId: reaction.message.id,
        keptRoleId: role.id
      });
    }

    if (!member.roles.cache.has(role.id)) {

      await member.roles.add(
        role,
        'Reaction role added'
      );
    }

  } catch (err) {

    console.error('Reaction role add error:', err);
  }
}

async function removeReactionRole(reaction, user) {

  if (user.bot || !reaction.message.guild) {

    return;
  }

  await hydrateReaction(reaction);

  const mapping =
    await getReactionRoleMapping(reaction);

  if (mapping?.guildId !== reaction.message.guild.id) {

    return;
  }

  const member =
    await reaction.message.guild.members.fetch(user.id)
      .catch(() => null);

  const role =
    reaction.message.guild.roles.cache.get(mapping.roleId);

  if (
    !member ||
    !member.roles.cache.has(mapping.roleId) ||
    !canManageReactionRole(reaction.message.guild, role)
  ) {

    return;
  }

  await member.roles.remove(
    role,
    'Reaction role removed'
  ).catch(err =>
    console.error('Reaction role remove error:', err)
  );
}

module.exports = {

  name: 'messageReactionAdd',

  async execute(reaction, user) {

    await addReactionRole(reaction, user);
  }
};

module.exports.removeReactionRole =
  removeReactionRole;

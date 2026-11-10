const { PermissionFlagsBits: P } = require('discord.js');

async function authorizeModeration(interaction, targetId, permission) {
  const guild = interaction.guild;
  const actor = await guild.members.fetch({ user: interaction.user.id, force: true });
  if (!actor.permissions.has(permission)) throw new Error('You no longer have permission to perform this moderation action.');
  if (targetId === interaction.user.id || targetId === interaction.client.user.id || targetId === guild.ownerId) {
    throw new Error('You cannot moderate yourself, this bot or the server owner.');
  }
  let target;
  try { target = await guild.members.fetch({ user: targetId, force: true }); }
  catch (error) { if (Number(error.code) !== 10007) throw error; }
  const bot = guild.members.fetchMe ? await guild.members.fetchMe({ force: true }) : guild.members.me;
  if (!bot?.permissions.has(permission)) throw new Error('I no longer have the required moderation permission.');
  if(!target && permission!==P.BanMembers) throw new Error('The target is no longer a member of this server.');
  if (target) {
    if (actor.id !== guild.ownerId && (target.roles.highest.comparePositionTo
      ? target.roles.highest.comparePositionTo(actor.roles.highest) >= 0
      : target.roles.highest.position >= actor.roles.highest.position)) {
      throw new Error('The target now has an equal or higher role than you.');
    }
    if (target.roles.highest.position >= bot.roles.highest.position ||
        target.permissions.has(P.Administrator) && actor.id !== guild.ownerId) {
      throw new Error('This member is protected by role hierarchy or administrator permissions.');
    }
  }
  return { actor, target, bot };
}

module.exports = { authorizeModeration };

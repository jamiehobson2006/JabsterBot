const { ChannelType, PermissionFlagsBits: P } = require('discord.js');

const REQUIRED_CATEGORY_PERMISSIONS = [P.ViewChannel, P.SendMessages, P.ManageChannels, P.EmbedLinks];

async function fetchCategory(guild, id) {
  if (!id) return null;
  try {
    const category = await guild.channels.fetch(id, { force: true });
    if (!category || category.type !== ChannelType.GuildCategory ||
        (category.guildId || category.guild?.id) !== guild.id) return null;
    return category;
  } catch (error) {
    if (Number(error.code) === 10003) return null;
    throw error;
  }
}

async function fetchStaffRole(guild, id) {
  if (!id) return null;
  let role;
  try { role = await guild.roles.fetch(id, { force: true }); }
  catch (error) { if (Number(error.code) === 10011) return null; throw error; }
  if (!role || role.id === guild.id || role.managed || role.guild?.id !== guild.id) return null;
  return role;
}

async function resolveConfiguration(guild, { categoryId, roleId }) {
  const category = await fetchCategory(guild, categoryId);
  if (!category) throw new Error('The ticket category was deleted, is not a category, or belongs to another server. Choose a category again with /ticket setup.');
  const role = await fetchStaffRole(guild, roleId);
  if (!role) throw new Error('The ticket staff role is missing or invalid. Choose a normal server role with /ticket setup.');
  const bot = await guild.members.fetchMe({ force: true });
  if (!category.permissionsFor(bot)?.has(REQUIRED_CATEGORY_PERMISSIONS)) {
    throw new Error('I need View Channel, Send Messages, Manage Channels and Embed Links in the ticket category.');
  }
  return { category, role, bot };
}

async function assertCategoryCapacity(guild, categoryId) {
  const channels = await guild.channels.fetch();
  const category = channels.get(categoryId);
  if (!category || category.type !== ChannelType.GuildCategory) {
    throw new Error('The ticket category no longer exists. Choose a category again with /ticket setup.');
  }
  const children = [...channels.values()].filter(channel => channel?.parentId === categoryId && !channel.isThread?.());
  if (children.length >= 50) throw new Error('This ticket category is full (50 channels). Move or close existing channels, or choose another category with /ticket setup.');
}

function creationError(error) {
  const fields = error.rawError?.errors || error.errors || {};
  if (fields.parent_id || Number(error.code) === 10003) {
    return new Error('Discord rejected the ticket category. Check that it still exists, has space, and that I can manage it, then select it again with /ticket setup.', { cause: error });
  }
  if (Number(error.code) === 50013 || Number(error.code) === 50001) {
    return new Error('Discord denied access while creating the ticket. Check my category permissions, including Manage Channels and permission-overwrite access.', { cause: error });
  }
  return error;
}

module.exports = { assertCategoryCapacity, creationError, fetchCategory, fetchStaffRole, resolveConfiguration };

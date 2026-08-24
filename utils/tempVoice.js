const {
  ChannelType,
  PermissionFlagsBits
} = require('discord.js');

const {
  all,
  get,
  run
} = require('../database');

const {
  createAuditEmbed,
  logAudit
} = require('./logger');

function getTempVoiceSettings(guildId) {
  return get(
    `SELECT *
     FROM temp_voice_settings
     WHERE guildId = ?`,
    [guildId]
  );
}

function setTempVoiceSettings({
  guildId,
  enabled,
  lobbyChannelId,
  categoryId,
  nameTemplate,
  userLimit,
  updatedBy
}) {
  return run(
    `INSERT INTO temp_voice_settings (
       guildId, enabled, lobbyChannelId, categoryId,
       nameTemplate, userLimit, updatedBy, updatedAt
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(guildId)
     DO UPDATE SET enabled = excluded.enabled,
                   lobbyChannelId = excluded.lobbyChannelId,
                   categoryId = excluded.categoryId,
                   nameTemplate = excluded.nameTemplate,
                   userLimit = excluded.userLimit,
                   updatedBy = excluded.updatedBy,
                   updatedAt = excluded.updatedAt`,
    [
      guildId,
      enabled ? 1 : 0,
      lobbyChannelId || null,
      categoryId || null,
      nameTemplate || "{username}'s Room",
      Number(userLimit) || 0,
      updatedBy || null,
      Date.now()
    ]
  );
}

function disableTempVoice(guildId, updatedBy) {
  const settings = getTempVoiceSettings(guildId);

  if (!settings) {
    return { changes: 0 };
  }

  return run(
    `UPDATE temp_voice_settings
     SET enabled = 0,
         updatedBy = ?,
         updatedAt = ?
     WHERE guildId = ?`,
    [updatedBy, Date.now(), guildId]
  );
}

function getTempVoiceRoom(channelId) {
  return get(
    `SELECT *
     FROM temp_voice_rooms
     WHERE channelId = ?`,
    [channelId]
  );
}

function getOwnerTempVoiceRoom(guildId, ownerId) {
  return get(
    `SELECT *
     FROM temp_voice_rooms
     WHERE guildId = ?
     AND ownerId = ?
     ORDER BY createdAt ASC
     LIMIT 1`,
    [guildId, ownerId]
  );
}

function getTempVoiceRooms(guildId) {
  return all(
    `SELECT *
     FROM temp_voice_rooms
     WHERE guildId = ?
     ORDER BY createdAt ASC`,
    [guildId]
  );
}

function createRoomRecord({ channelId, guildId, ownerId }) {
  return run(
    `INSERT OR REPLACE INTO temp_voice_rooms (
       channelId, guildId, ownerId, createdAt
     )
     VALUES (?, ?, ?, ?)`,
    [channelId, guildId, ownerId, Date.now()]
  );
}

function removeTempVoiceRoom(channelId) {
  return run(
    `DELETE FROM temp_voice_rooms
     WHERE channelId = ?`,
    [channelId]
  );
}

function renderRoomName(template, member) {
  const fallback = "{username}'s Room";
  const value = String(template || fallback)
    .replace(/\{username\}/gi, member.user.username)
    .replace(/\{user\}/gi, member.displayName || member.user.username)
    .replace(/\{server\}/gi, member.guild.name)
    .replace(/[\r\n]/g, ' ')
    .trim();

  return (value || `${member.user.username}'s Room`).slice(0, 100);
}

async function createTempVoiceRoom(member, settings) {
  const guild = member.guild;
  const existing = getOwnerTempVoiceRoom(guild.id, member.id);

  if (existing) {
    const existingChannel = await guild.channels.fetch(existing.channelId)
      .catch(() => null);

    if (existingChannel?.type === ChannelType.GuildVoice) {
      return existingChannel;
    }

    removeTempVoiceRoom(existing.channelId);
  }

  const parent = settings.categoryId
    ? await guild.channels.fetch(settings.categoryId).catch(() => null)
    : null;

  const room = await guild.channels.create({
    name: renderRoomName(settings.nameTemplate, member),
    type: ChannelType.GuildVoice,
    parent: parent?.type === ChannelType.GuildCategory ? parent.id : undefined,
    userLimit: Math.max(0, Math.min(99, Number(settings.userLimit) || 0)),
    reason: `Temporary voice room for ${member.user.tag}`
  });

  createRoomRecord({
    channelId: room.id,
    guildId: guild.id,
    ownerId: member.id
  });

  await logAudit(guild.client, guild.id, {
    action: 'TEMP_VOICE_CREATED',
    targetId: member.id,
    executorId: member.id,
    type: 'VOICE',
    metadata: { channelId: room.id },
    embed: createAuditEmbed({
      action: 'Temporary Voice Room Created',
      target: `${member.user.tag}\n<@${member.id}>`,
      channel: `<#${room.id}>`,
      color: 0x57F287
    })
  });

  return room;
}

async function deleteTempVoiceRoom(client, channel, reason = 'Temporary voice room empty') {
  const record = getTempVoiceRoom(channel.id);

  if (!record) {
    return false;
  }

  if (!channel.deletable) {
    return false;
  }

  try {
    await channel.delete(reason);
  } catch (err) {
    console.error('Temporary voice room delete error:', err.message);
    return false;
  }

  removeTempVoiceRoom(channel.id);

  await logAudit(client, record.guildId, {
    action: 'TEMP_VOICE_DELETED',
    targetId: record.ownerId,
    executorId: client.user?.id,
    type: 'VOICE',
    metadata: { channelId: channel.id, reason },
    embed: createAuditEmbed({
      action: 'Temporary Voice Room Deleted',
      target: `<@${record.ownerId}>`,
      extra: reason,
      color: 0xED4245
    })
  });

  return true;
}

function canManageTempVoice(member, room) {
  return Boolean(
    member?.id === room?.ownerId ||
    member?.permissions?.has(PermissionFlagsBits.ManageChannels)
  );
}

async function cleanupTempVoiceRooms(client) {
  const rooms = all('SELECT * FROM temp_voice_rooms');

  for (const room of rooms) {
    const guild = client.guilds.cache.get(room.guildId);
    const channel = guild
      ? await guild.channels.fetch(room.channelId).catch(() => null)
      : null;

    if (!channel || channel.type !== ChannelType.GuildVoice) {
      removeTempVoiceRoom(room.channelId);
      continue;
    }

    if (channel.members.size === 0) {
      await deleteTempVoiceRoom(client, channel, 'Temporary voice room cleanup');
    }
  }
}

module.exports = {
  canManageTempVoice,
  cleanupTempVoiceRooms,
  createTempVoiceRoom,
  deleteTempVoiceRoom,
  disableTempVoice,
  getOwnerTempVoiceRoom,
  getTempVoiceRoom,
  getTempVoiceRooms,
  getTempVoiceSettings,
  removeTempVoiceRoom,
  setTempVoiceSettings
};

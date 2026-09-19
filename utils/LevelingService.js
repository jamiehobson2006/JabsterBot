const {
  EmbedBuilder
} = require('discord.js');

const {
  all,
  get,
  run
} = require('../database');

const {
  calculateLevel
} = require('./leveling');

const {
  getLevelingConfig,
  parseIdList
} = require('./levelingConfig');

const {
  automaticRoleSafetyError
} = require('./roleSafety');

function getXpRange(config) {
  const min = Math.max(1, Number(config.xpMin) || 15);
  const max = Math.max(min, Number(config.xpMax) || 25);

  return { min, max };
}

function queueLevelRewards(guildId, userId, level) {
  run(
    `INSERT OR IGNORE INTO leveling_reward_grants (
       guildId, userId, roleId, level, status
     )
     SELECT guildId, ?, roleId, level, 'PENDING'
     FROM leveling_rewards
     WHERE guildId = ? AND level <= ?`,
    [userId, guildId, level]
  );
}

async function applyPendingRewards(guild, member) {
  const pending = all(
    `SELECT * FROM leveling_reward_grants
     WHERE guildId = ? AND userId = ? AND status = 'PENDING'
     ORDER BY level`,
    [guild.id, member.id]
  );

  for (const grant of pending) {
    const role = guild.roles.cache.get(grant.roleId);

    const safetyError = automaticRoleSafetyError(guild, role);
    if (safetyError) {
      run(
        `UPDATE leveling_reward_grants
         SET status = 'CANCELLED', attempts = attempts + 1, lastError = ?
         WHERE guildId = ? AND userId = ? AND roleId = ?`,
        [safetyError, guild.id, member.id, grant.roleId]
      );
      continue;
    }

    try {
      if (!member.roles.cache.has(role.id)) {
        await member.roles.add(role, `Level reward for reaching level ${grant.level}`);
      }

      run(
        `UPDATE leveling_reward_grants
         SET status = 'GRANTED', grantedAt = ?, lastError = NULL
         WHERE guildId = ? AND userId = ? AND roleId = ?`,
        [Date.now(), guild.id, member.id, role.id]
      );
    } catch (error) {
      run(
        `UPDATE leveling_reward_grants
         SET attempts = attempts + 1,
             status = CASE WHEN attempts + 1 >= 5 THEN 'FAILED' ELSE status END,
             lastError = ?
         WHERE guildId = ? AND userId = ? AND roleId = ?`,
        [String(error.message || error).slice(0, 500), guild.id, member.id, grant.roleId]
      );
    }
  }
}

function replaceVariables(template, userId, level, xp, messages) {
  return template
    .replaceAll('{user}', `<@${userId}>`)
    .replaceAll('{level}', String(level))
    .replaceAll('{xp}', xp.toLocaleString())
    .replaceAll('{messages}', messages.toLocaleString());
}

async function sendLevelUpMessage(message, member, config, level, xp, messages) {
  if (config.levelUpStyle === 'OFF') return;

  const levelChannel = config.levelChannelId
    ? await message.guild.channels.fetch(config.levelChannelId).catch(() => null)
    : message.channel;

  if (!levelChannel?.isTextBased() || typeof levelChannel.send !== 'function') {
    return;
  }

  const allowedMentions = {
    users: [member.id],
    roles: [],
    parse: []
  };

  if (config.levelUpStyle === 'MESSAGE') {
    const template = config.levelMessage || '{user} reached level {level}!';
    await levelChannel.send({
      content: replaceVariables(template, member.id, level, xp, messages),
      allowedMentions
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0x57F287)
    .setAuthor({
      name: `${member.displayName} reached Level ${level}`,
      iconURL: member.user.displayAvatarURL({ size: 128 })
    })
    .setDescription(`${member} has leveled up.`)
    .addFields(
      {
        name: 'Level',
        value: String(level),
        inline: true
      },
      {
        name: 'Total XP',
        value: xp.toLocaleString(),
        inline: true
      },
      {
        name: 'Eligible Messages',
        value: messages.toLocaleString(),
        inline: true
      }
    )
    .setFooter({ text: 'Jabster Studios Leveling' })
    .setTimestamp();

  await levelChannel.send({
    embeds: [embed],
    allowedMentions
  });
}

class LevelingService {
  static interval = null;

  static async processPending(client) {
    const pending = all(
      `SELECT DISTINCT guildId, userId
       FROM leveling_reward_grants
       WHERE status = 'PENDING'`
    );

    for (const row of pending) {
      const guild = client.guilds.cache.get(row.guildId);
      if (!guild) continue;
      const member = await guild.members.fetch(row.userId).catch(() => null);
      if (member) await applyPendingRewards(guild, member);
    }
  }

  static start(client) {
    if (LevelingService.interval) return LevelingService.interval;
    LevelingService.processPending(client)
      .catch(error => console.error('Level reward recovery failed:', error));
    LevelingService.interval = setInterval(() => {
      LevelingService.processPending(client)
        .catch(error => console.error('Level reward recovery failed:', error));
    }, 5 * 60 * 1000);
    LevelingService.interval.unref?.();
    return LevelingService.interval;
  }

  static async handleMessage(message) {
    if (!message.guild || message.author?.bot || !message.member) {
      return { awarded: false, reason: 'INVALID_MESSAGE' };
    }

    const config = getLevelingConfig(message.guild.id);
    const mutedChannels = parseIdList(config.ignoredChannels);
    const mutedRoles = parseIdList(config.ignoredRoles);
    const channelIds = [message.channel.id, message.channel.parentId].filter(Boolean);

    if (Number(config.enabled) !== 1) {
      return { awarded: false, reason: 'DISABLED' };
    }

    if (channelIds.some(channelId => mutedChannels.includes(channelId))) {
      return { awarded: false, reason: 'MUTED_CHANNEL' };
    }

    if (mutedRoles.some(roleId => message.member.roles.cache.has(roleId))) {
      return { awarded: false, reason: 'MUTED_ROLE' };
    }

    const guildId = message.guild.id;
    const userId = message.author.id;
    const now = Date.now();
    let user = get(
      `SELECT *
       FROM leveling_users
       WHERE guildId = ? AND userId = ?`,
      [guildId, userId]
    );

    if (!user) {
      run(
        `INSERT INTO leveling_users (guildId, userId, xp, level, messages, lastXpTime)
         VALUES (?, ?, 0, 0, 0, 0)`,
        [guildId, userId]
      );
      user = { xp: 0, level: 0, messages: 0, lastXpTime: 0 };
    }

    const cooldown = Math.max(0, Number(config.cooldown) || 0) * 1000;
    if (now - Number(user.lastXpTime || 0) < cooldown) {
      return { awarded: false, reason: 'COOLDOWN' };
    }

    const { min, max } = getXpRange(config);
    const xpGain = Math.floor(Math.random() * (max - min + 1)) + min;
    const newXp = Number(user.xp) + xpGain;
    const newLevel = calculateLevel(newXp);
    const newMessageCount = Number(user.messages || 0) + 1;

    run(
      `UPDATE leveling_users
       SET xp = ?, level = ?, messages = ?, lastXpTime = ?
       WHERE guildId = ? AND userId = ?`,
      [newXp, newLevel, newMessageCount, now, guildId, userId]
    );

    if (newLevel > Number(user.level || 0)) {
      queueLevelRewards(guildId, userId, newLevel);
    }

    const hasPendingRewards = Boolean(get(
      `SELECT 1 FROM leveling_reward_grants
       WHERE guildId = ? AND userId = ? AND status = 'PENDING' LIMIT 1`,
      [guildId, userId]
    ));

    if (newLevel <= Number(user.level || 0) && !hasPendingRewards) {
      return { awarded: true, xpGain, level: newLevel, leveledUp: false };
    }

    const member = await message.guild.members.fetch(userId).catch(() => null);
    if (!member) {
      return {
        awarded: true,
        xpGain,
        level: newLevel,
        leveledUp: newLevel > Number(user.level || 0)
      };
    }

    await applyPendingRewards(message.guild, member);

    if (newLevel <= Number(user.level || 0)) {
      return { awarded: true, xpGain, level: newLevel, leveledUp: false };
    }

    await sendLevelUpMessage(message, member, config, newLevel, newXp, newMessageCount)
      .catch(error => console.error('Level-up announcement failed:', error));

    return { awarded: true, xpGain, level: newLevel, leveledUp: true };
  }
}

module.exports = LevelingService;

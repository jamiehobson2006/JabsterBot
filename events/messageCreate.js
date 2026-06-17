const {
  PermissionsBitField
} = require('discord.js');

const {
  run,
  get
} = require('../database');

const {
  createAuditEmbed,
  logAudit
} = require('../utils/logger');

const {
  calculateLevel
} = require('../utils/leveling');

const LevelingService =
  require('../utils/LevelingService');

// ==================================================
// ⏱ MESSAGE COOLDOWN CACHE
// ==================================================
const messageCooldowns =
  new Map();

const linkPattern =
  /\b(?:https?:\/\/|www\.|discord\.gg\/|discord(?:app)?\.com\/invite\/)[^\s<]*/i;

function findBlockedLink(content) {

  if (
    typeof content !== 'string'
  ) {

    return null;
  }

  const match =
    content.match(linkPattern);

  return match?.[0] || null;
}

function canBypassLinkBlock(
  message,
  settings
) {

  if (
    message.member?.permissions.has(
      PermissionsBitField.Flags.Administrator
    ) ||
    message.member?.permissions.has(
      PermissionsBitField.Flags.ManageMessages
    )
  ) {

    return true;
  }

  return Boolean(
    settings?.linkBypassRoleId &&
    message.member?.roles.cache.has(
      settings.linkBypassRoleId
    )
  );
}

async function handleLinkBlock(
  message,
  client
) {

  const blockedLink =
    findBlockedLink(
      message.content
    );

  if (!blockedLink) {

    return false;
  }

  const settings =
    get(

      `SELECT linkBlockEnabled, linkBypassRoleId
       FROM guild_settings
       WHERE guildId = ?`,

      [message.guild.id]
    );

  if (
    Number(settings?.linkBlockEnabled || 0) !== 1 ||
    canBypassLinkBlock(message, settings)
  ) {

    return false;
  }

  await message.delete()
    .catch(err => {

      console.error(
        'Link block delete failed:',
        err.message
      );
    });

  await message.channel.send({

    content:
      `${message.author}, links are blocked in this server.`,

    allowedMentions: {
      users: [message.author.id],
      roles: [],
      parse: []
    }
  })

    .then(sent =>

      setTimeout(
        () => sent.delete().catch(() => {}),
        5000
      )
    )

    .catch(() => {});

  await logAudit(

    client,

    message.guild.id,

    {
      action: 'LINK_BLOCKED',
      targetId: message.author.id,
      executorId: client.user?.id,
      type: 'MESSAGES',
      metadata: {
        channelId: message.channel.id,
        link: blockedLink
      },
      embed: createAuditEmbed({
        action: 'Link Blocked',
        target: `${message.author.tag}\n<@${message.author.id}>`,
        executor: client.user
          ? `${client.user.tag}\n<@${client.user.id}>`
          : 'Bot',
        channel: `<#${message.channel.id}>`,
        extra: `Blocked link: ${blockedLink}`,
        color: 0xED4245
      })
    }
  );

  return true;
}

// ==================================================
// ⏱ RESET HELPERS
// ==================================================
function shouldResetDaily(lastReset) {

  const now =
    new Date();

  const last =
    new Date(lastReset);

  return (

    now.getUTCDate() !==
    last.getUTCDate() ||

    now.getUTCMonth() !==
    last.getUTCMonth() ||

    now.getUTCFullYear() !==
    last.getUTCFullYear()
  );
}

function shouldResetWeekly(lastReset) {

  // ================================================
  // 📅 MONDAY UTC RESET
  // ================================================
  const now =
    new Date();

  const last =
    new Date(lastReset);

  const nowWeek =
    getWeekStart(now);

  const lastWeek =
    getWeekStart(last);

  return (
    nowWeek.getTime() !==
    lastWeek.getTime()
  );
}

function shouldResetMonthly(lastReset) {

  const now =
    new Date();

  const last =
    new Date(lastReset);

  return (

    now.getUTCMonth() !==
    last.getUTCMonth() ||

    now.getUTCFullYear() !==
    last.getUTCFullYear()
  );
}

// ==================================================
// 📅 WEEK START
// ==================================================
function getWeekStart(date) {

  const d =
    new Date(date);

  const day =
    d.getUTCDay();

  const diff =
    day === 0
      ? -6
      : 1 - day;

  d.setUTCDate(
    d.getUTCDate() + diff
  );

  d.setUTCHours(
    0,
    0,
    0,
    0
  );

  return d;
}

module.exports = {

  name: 'messageCreate',

  async execute(message) {

    try {

      // ==========================================
      // 🚫 IGNORE BOTS / DMS
      // ==========================================
      if (
        !message.guild ||
        message.author.bot
      ) {

        return;
      }

      // ==========================================
      // 🚫 IGNORE EMPTY
      // ==========================================
      const hasContent =
        message.content &&
        message.content.trim();

      const hasAttachments =
        message.attachments?.size > 0;

      if (
        !hasContent &&
        !hasAttachments
      ) {

        return;
      }

      // ==========================================
      // 🚫 IGNORE COMMANDS
      // ==========================================
      if (
        message.content?.startsWith('/')
      ) {

        return;
      }

      const guildId =
        message.guild.id;

      const userId =
        message.author.id;

      const now =
        Date.now();

      if (
        await handleLinkBlock(
          message,
          client
        )
      ) {

        return;
      }

      // ==========================================
      // ⏱ ANTI-SPAM COOLDOWN
      // ==========================================
      const cooldownKey =
        `${guildId}:${userId}`;

      const lastMessage =
        messageCooldowns.get(
          cooldownKey
        );

      if (
        lastMessage &&
        now - lastMessage < 10000
      ) {

        return;
      }

      messageCooldowns.set(
        cooldownKey,
        now
      );

      // ==========================================
      // 🧹 CLEANUP CACHE
      // ==========================================
      setTimeout(() => {

        messageCooldowns.delete(
          cooldownKey
        );

      }, 15000);

      // ==========================================
      // 📊 FETCH STATS
      // ==========================================
      let stats =
        get(

          `SELECT *
           FROM message_stats
           WHERE guildId = ?
           AND userId = ?`,

          [

            guildId,

            userId
          ]
        );

      // ==========================================
      // 🆕 CREATE ENTRY
      // ==========================================
      if (!stats) {

        run(

          `INSERT INTO message_stats (

            guildId,
            userId,

            totalMessages,

            dailyMessages,
            weeklyMessages,
            monthlyMessages,

            lastDailyReset,
            lastWeeklyReset,
            lastMonthlyReset

          )

          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,

          [

            guildId,
            userId,

            1,

            1,
            1,
            1,

            now,
            now,
            now
          ]
        );

        return;
      }

      // ==========================================
      // 🔄 RESET CHECKS
      // ==========================================
      let daily =
        stats.dailyMessages || 0;

      let weekly =
        stats.weeklyMessages || 0;

      let monthly =
        stats.monthlyMessages || 0;

      let dailyReset =
        stats.lastDailyReset || 0;

      let weeklyReset =
        stats.lastWeeklyReset || 0;

      let monthlyReset =
        stats.lastMonthlyReset || 0;

      // ==========================================
      // 📅 DAILY RESET
      // ==========================================
      if (
        shouldResetDaily(
          dailyReset
        )
      ) {

        daily = 0;
        dailyReset = now;
      }

      // ==========================================
      // 📆 WEEKLY RESET
      // ==========================================
      if (
        shouldResetWeekly(
          weeklyReset
        )
      ) {

        weekly = 0;
        weeklyReset = now;
      }

      // ==========================================
      // 🗓 MONTHLY RESET
      // ==========================================
      if (
        shouldResetMonthly(
          monthlyReset
        )
      ) {

        monthly = 0;
        monthlyReset = now;
      }

      run(

        `UPDATE message_stats

         SET

         totalMessages =
         totalMessages + 1,

         dailyMessages = ?,
         weeklyMessages = ?,
         monthlyMessages = ?,

         lastDailyReset = ?,
         lastWeeklyReset = ?,
         lastMonthlyReset = ?

         WHERE guildId = ?
         AND userId = ?`,

        [

          daily + 1,
          weekly + 1,
          monthly + 1,

          dailyReset,
          weeklyReset,
          monthlyReset,

          guildId,
          userId
        ]
      );

      await LevelingService.handleMessage(
  message
);

    } catch (err) {

      console.error(
        'Message Tracker Error:',
        err
      );
    }
  }
};

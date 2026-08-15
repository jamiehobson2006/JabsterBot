const {
  run,
  get
} = require('../database');

const {
  createAuditEmbed,
  logAudit
} = require('../utils/logger');

const {
  findCensoredTerm,
  getCensorBypassCategories,
  getCensorBypassChannels,
  getCensorBypassRoles,
  getCensorSettings,
  listCensorTerms
} = require('../utils/censor');

const {
  hasWhitelistedRole,
  isWhitelistedChannel
} = require('../utils/contentFilterWhitelist');

const {
  suppressMessageDelete,
  unsuppressMessageDelete
} = require('../utils/messageDeletionTracker');

const {
  addMessage
} = require('../utils/tickets/stats');

const {
  hasTicketAccess
} = require('../utils/tickets/permissions');

const {
  findOrRecoverOpenTicket
} = require('../utils/tickets/recoverTicket');

const {
  getLinkCategoryWhitelist,
  getLinkChannelWhitelist,
  getLinkWhitelist
} = require('../utils/linkWhitelist');

const LevelingService =
  require('../utils/LevelingService');

// ==================================================
// ⏱ MESSAGE COOLDOWN CACHE
// ==================================================
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
  return hasWhitelistedRole(
    message.member,
    getLinkWhitelist(settings)
  ) || isWhitelistedChannel(
    message,
    getLinkChannelWhitelist(settings),
    getLinkCategoryWhitelist(settings)
  );
}

async function getOpenTicket(message, client) {
  const ticket = get(
    `SELECT *
     FROM tickets
     WHERE guildId = ?
     AND channelId = ?
     AND UPPER(status) = 'OPEN'`,
    [message.guild.id, message.channel.id]
  );

  if (ticket) {
    return ticket;
  }

  // Only attempt recovery in a channel that carries bot-created ticket metadata.
  if (!String(message.channel.topic || '').startsWith('Jabster Studios ticket')) {
    return null;
  }

  return findOrRecoverOpenTicket({
    guild: message.guild,
    channel: message.channel,
    client
  });
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

  const ticket = await getOpenTicket(message, client);

  if (['partnership', 'application', 'appeal'].includes(ticket?.type)) {
    return false;
  }

  const settings =
    get(

      `SELECT linkBlockEnabled,
              linkBypassRoleId,
              linkBypassRoleIds,
              linkBypassChannelIds,
              linkBypassCategoryIds
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

  suppressMessageDelete(message.id);

  try {

    await message.delete();

  } catch (err) {

    unsuppressMessageDelete(message.id);

    console.error(
      'Link block delete failed:',
      err.message
    );

    return false;
  }

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

async function handleCensor(
  message,
  client
) {

  const settings =
    getCensorSettings(message.guild.id);

  if (Number(settings?.censorEnabled || 0) !== 1) {

    return false;
  }

  if (
    hasWhitelistedRole(message.member, getCensorBypassRoles(settings)) ||
    isWhitelistedChannel(
      message,
      getCensorBypassChannels(settings),
      getCensorBypassCategories(settings)
    )
  ) {
    return false;
  }

  const term =
    findCensoredTerm(
      message.content,
      listCensorTerms(message.guild.id)
    );

  if (!term) {

    return false;
  }

  suppressMessageDelete(message.id);

  try {

    await message.delete();

  } catch (err) {

    unsuppressMessageDelete(message.id);

    console.error('Censor delete failed:', err.message);

    return false;
  }

  await logAudit(
    client,
    message.guild.id,
    {
      action: 'MESSAGE_CENSORED',
      targetId: message.author.id,
      executorId: client.user?.id,
      type: 'MESSAGES',
      metadata: {
        channelId: message.channel.id,
        messageId: message.id,
        term,
        content: message.content || null
      },
      embed: createAuditEmbed({
        action: 'Message Censored',
        target: `${message.author.tag}\n<@${message.author.id}>`,
        executor: client.user
          ? `${client.user.tag}\n<@${client.user.id}>`
          : 'Bot',
        channel: `<#${message.channel.id}>`,
        extra:
          `Matched term: \`${term}\`\n` +
          `Content: ${message.content || '*No text content*'}`,
        color: 0xED4245
      })
    }
  );

  return true;
}

async function trackTicketStaffMessage(
  message,
  client
) {
  const ticket = await getOpenTicket(message, client);

  if (!ticket) {
    return;
  }

  if (
    !hasTicketAccess({
      member: message.member,
      guildId: message.guild.id,
      type: ticket.type,
      channelId: message.channel.id
    })
  ) {
    return;
  }

  addMessage(
    message.guild.id,
    message.author.id
  );
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

  async execute(message, client) {

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
      const guildId =
        message.guild.id;

      const userId =
        message.author.id;

      const now =
        Date.now();

      if (
        await handleCensor(
          message,
          client
        )
      ) {

        return;
      }

      if (
        await handleLinkBlock(
          message,
          client
        )
      ) {

        return;
      }

      await trackTicketStaffMessage(
        message,
        client
      );

      // ==========================================
      // ⏱ ANTI-SPAM COOLDOWN
      // ==========================================
      // ==========================================
      // 🧹 CLEANUP CACHE
      // ==========================================
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

        await LevelingService.handleMessage(
  message
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

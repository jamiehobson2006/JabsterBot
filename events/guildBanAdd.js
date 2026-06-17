const {
  AuditLogEvent
} = require('discord.js');

const {
  get
} = require('../database');

const {
  createAuditEmbed,
  logAudit
} = require('../utils/logger');

const {
  findRecentAuditLog,
  formatExecutor
} = require('../utils/auditLookup');

module.exports = {

  name: 'guildBanAdd',

  async execute(ban, client) {

    try {

      const recentCase =
        get(

          `SELECT id
           FROM cases
           WHERE guildId = ?
           AND userId = ?
           AND action = 'BAN'
           AND COALESCE(createdAt, timestamp, 0) > ?
           ORDER BY id DESC
           LIMIT 1`,

          [
            ban.guild.id,
            ban.user.id,
            Date.now() - 10000
          ]
        );

      if (recentCase) {
        return;
      }

      const audit =
        await findRecentAuditLog(
          ban.guild,
          AuditLogEvent.MemberBanAdd,
          ban.user.id
        );

      await logAudit(
        client,
        ban.guild.id,
        {
          action: 'BAN_EVENT',
          targetId: ban.user.id,
          executorId: audit?.executor?.id,
          type: 'MODERATION',
          metadata: {
            reason: ban.reason || audit?.reason || null
          },
          embed: createAuditEmbed({
            action: 'Member Banned',
            target: `${ban.user.tag}\n<@${ban.user.id}>`,
            executor: formatExecutor(audit),
            reason: ban.reason || audit?.reason || undefined,
            color: 0xED4245
          })
        }
      );

    } catch (err) {

      console.error(
        'GuildBanAdd Error:',
        err
      );
    }
  }
};

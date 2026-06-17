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

  name: 'guildBanRemove',

  async execute(ban, client) {

    try {

      const recentCase =
        get(

          `SELECT id
           FROM cases
           WHERE guildId = ?
           AND userId = ?
           AND action = 'UNBAN'
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
          AuditLogEvent.MemberBanRemove,
          ban.user.id
        );

      await logAudit(
        client,
        ban.guild.id,
        {
          action: 'UNBAN_EVENT',
          targetId: ban.user.id,
          executorId: audit?.executor?.id,
          type: 'MODERATION',
          metadata: {
            reason: ban.reason || audit?.reason || null
          },
          embed: createAuditEmbed({
            action: 'Member Unbanned',
            target: `${ban.user.tag}\n<@${ban.user.id}>`,
            executor: formatExecutor(audit),
            reason: ban.reason || audit?.reason || undefined,
            color: 0x57F287
          })
        }
      );

    } catch (err) {

      console.error(
        'GuildBanRemove Error:',
        err
      );
    }
  }
};

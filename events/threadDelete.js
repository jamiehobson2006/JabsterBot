const {
  AuditLogEvent
} = require('discord.js');

const {
  createAuditEmbed,
  logAudit
} = require('../utils/logger');

const {
  findRecentAuditLog,
  formatExecutor
} = require('../utils/auditLookup');

module.exports = {
  name: 'threadDelete',

  async execute(thread, client) {
    try {
      if (!thread.guild) {
        return;
      }

      const audit = await findRecentAuditLog(
        thread.guild,
        AuditLogEvent.ChannelDelete,
        thread.id
      );

      await logAudit(client, thread.guild.id, {
        action: 'THREAD_DELETED',
        targetId: thread.id,
        executorId: audit?.executor?.id,
        type: 'SERVER',
        metadata: {
          threadId: thread.id,
          parentId: thread.parentId,
          ownerId: thread.ownerId || null
        },
        embed: createAuditEmbed({
          action: 'Thread Deleted',
          target: `${thread.name || 'Unknown thread'}\n${thread.id}`,
          executor: formatExecutor(audit),
          reason: audit?.reason || undefined,
          channel: thread.parentId
            ? `<#${thread.parentId}>`
            : 'Unknown',
          color: 0xED4245
        })
      });
    } catch (err) {
      console.error('ThreadDelete Error:', err);
    }
  }
};

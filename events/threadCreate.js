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
  name: 'threadCreate',

  async execute(thread, newlyCreated, client) {
    try {
      if (!newlyCreated || !thread.guild) {
        return;
      }

      const audit = await findRecentAuditLog(
        thread.guild,
        AuditLogEvent.ChannelCreate,
        thread.id
      );

      await logAudit(client, thread.guild.id, {
        action: 'THREAD_CREATED',
        targetId: thread.id,
        executorId: audit?.executor?.id,
        type: 'SERVER',
        metadata: {
          threadId: thread.id,
          parentId: thread.parentId,
          ownerId: thread.ownerId || null,
          type: thread.type
        },
        embed: createAuditEmbed({
          action: 'Thread Created',
          target: `${thread.name}\n<#${thread.id}>`,
          executor: formatExecutor(audit),
          reason: audit?.reason || undefined,
          channel: thread.parentId
            ? `<#${thread.parentId}>`
            : 'Unknown',
          extra:
            `Owner: ${thread.ownerId ? `<@${thread.ownerId}>` : 'Unknown'}\n` +
            `Auto archive: ${thread.autoArchiveDuration || 'Unknown'} minutes`,
          color: 0x57F287
        })
      });
    } catch (err) {
      console.error('ThreadCreate Error:', err);
    }
  }
};

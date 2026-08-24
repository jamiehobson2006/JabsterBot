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
  name: 'threadUpdate',

  async execute(oldThread, newThread, client) {
    try {
      const changes = [];

      if (oldThread.name !== newThread.name) {
        changes.push(`Name: ${oldThread.name} -> ${newThread.name}`);
      }

      if (oldThread.archived !== newThread.archived) {
        changes.push(`Archived: ${oldThread.archived} -> ${newThread.archived}`);
      }

      if (oldThread.locked !== newThread.locked) {
        changes.push(`Locked: ${oldThread.locked} -> ${newThread.locked}`);
      }

      if (oldThread.invitable !== newThread.invitable) {
        changes.push(`Invitable: ${oldThread.invitable} -> ${newThread.invitable}`);
      }

      if (oldThread.autoArchiveDuration !== newThread.autoArchiveDuration) {
        changes.push(`Auto archive: ${oldThread.autoArchiveDuration} -> ${newThread.autoArchiveDuration} minutes`);
      }

      if (oldThread.rateLimitPerUser !== newThread.rateLimitPerUser) {
        changes.push(`Slowmode: ${oldThread.rateLimitPerUser || 0}s -> ${newThread.rateLimitPerUser || 0}s`);
      }

      if (!changes.length || !newThread.guild) {
        return;
      }

      const audit = await findRecentAuditLog(
        newThread.guild,
        AuditLogEvent.ChannelUpdate,
        newThread.id
      );

      await logAudit(client, newThread.guild.id, {
        action: 'THREAD_UPDATED',
        targetId: newThread.id,
        executorId: audit?.executor?.id,
        type: 'SERVER',
        metadata: {
          threadId: newThread.id,
          parentId: newThread.parentId,
          changes
        },
        embed: createAuditEmbed({
          action: 'Thread Updated',
          target: `${newThread.name}\n<#${newThread.id}>`,
          executor: formatExecutor(audit),
          reason: audit?.reason || undefined,
          channel: newThread.parentId
            ? `<#${newThread.parentId}>`
            : 'Unknown',
          extra: changes.join('\n'),
          color: 0xFEE75C
        })
      });
    } catch (err) {
      console.error('ThreadUpdate Error:', err);
    }
  }
};

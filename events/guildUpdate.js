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

function changed(before, after, label, changes) {
  if (before !== after) {
    changes.push(`${label}: ${before || 'None'} -> ${after || 'None'}`);
  }
}

module.exports = {
  name: 'guildUpdate',

  async execute(oldGuild, newGuild, client) {
    try {
      const changes = [];

      changed(oldGuild.name, newGuild.name, 'Name', changes);
      changed(oldGuild.description, newGuild.description, 'Description', changes);
      changed(oldGuild.icon, newGuild.icon, 'Icon', changes);
      changed(oldGuild.banner, newGuild.banner, 'Banner', changes);
      changed(
        oldGuild.verificationLevel,
        newGuild.verificationLevel,
        'Verification level',
        changes
      );
      changed(
        oldGuild.explicitContentFilter,
        newGuild.explicitContentFilter,
        'Explicit content filter',
        changes
      );
      changed(
        oldGuild.defaultMessageNotifications,
        newGuild.defaultMessageNotifications,
        'Default notifications',
        changes
      );

      if (!changes.length) {
        return;
      }

      const audit = await findRecentAuditLog(
        newGuild,
        AuditLogEvent.GuildUpdate,
        newGuild.id
      );

      await logAudit(
        client,
        newGuild.id,
        {
          action: 'SERVER_UPDATED',
          targetId: newGuild.id,
          executorId: audit?.executor?.id,
          type: 'SERVER',
          metadata: { changes },
          embed: createAuditEmbed({
            action: 'Server Updated',
            target: newGuild.name,
            executor: formatExecutor(audit),
            reason: audit?.reason || undefined,
            extra: changes.join('\n'),
            color: 0xFEE75C
          })
        }
      );
    } catch (err) {
      console.error('GuildUpdate Error:', err);
    }
  }
};

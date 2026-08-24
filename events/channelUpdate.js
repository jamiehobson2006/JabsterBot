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

function formatChannel(channel) {
  return `${channel.name || 'Unknown'}\n${channel.id}`;
}

function formatPermission(permission) {
  return permission.replace(/([a-z])([A-Z])/g, '$1 $2');
}

function permissionSet(overwrite, property) {
  return new Set(overwrite?.[property]?.toArray?.() || []);
}

function difference(next, previous) {
  return [...next].filter(value => !previous.has(value));
}

function overwriteTarget(guild, overwrite) {
  const role = guild.roles.cache.get(overwrite.id);
  if (role) return `<@&${role.id}>`;

  const member = guild.members.cache.get(overwrite.id);
  if (member) return `<@${member.id}>`;

  return `ID: ${overwrite.id}`;
}

function formatOverwriteChange(guild, before, after) {
  const target = overwriteTarget(guild, after || before);

  if (!before) {
    const allowed = [...permissionSet(after, 'allow')].map(formatPermission);
    const denied = [...permissionSet(after, 'deny')].map(formatPermission);
    return `Permissions added for ${target}: Allow ${allowed.join(', ') || 'None'} | Deny ${denied.join(', ') || 'None'}`;
  }

  if (!after) {
    return `Permissions removed for ${target}`;
  }

  const allowAdded = difference(permissionSet(after, 'allow'), permissionSet(before, 'allow'));
  const allowRemoved = difference(permissionSet(before, 'allow'), permissionSet(after, 'allow'));
  const denyAdded = difference(permissionSet(after, 'deny'), permissionSet(before, 'deny'));
  const denyRemoved = difference(permissionSet(before, 'deny'), permissionSet(after, 'deny'));
  const details = [];

  if (allowAdded.length) details.push(`Allow +${allowAdded.map(formatPermission).join(', ')}`);
  if (allowRemoved.length) details.push(`Allow -${allowRemoved.map(formatPermission).join(', ')}`);
  if (denyAdded.length) details.push(`Deny +${denyAdded.map(formatPermission).join(', ')}`);
  if (denyRemoved.length) details.push(`Deny -${denyRemoved.map(formatPermission).join(', ')}`);

  return details.length
    ? `${target}: ${details.join(' | ')}`
    : null;
}

function permissionOverwriteChanges(oldChannel, newChannel) {
  const before = oldChannel.permissionOverwrites?.cache || new Map();
  const after = newChannel.permissionOverwrites?.cache || new Map();
  const ids = new Set([...before.keys(), ...after.keys()]);

  return [...ids]
    .map(id => formatOverwriteChange(
      newChannel.guild,
      before.get(id),
      after.get(id)
    ))
    .filter(Boolean);
}

module.exports = {
  name: 'channelUpdate',

  async execute(oldChannel, newChannel, client) {
    try {
      if (!newChannel.guild || newChannel.isThread?.()) {
        return;
      }

      const changes = [];

      if (oldChannel.name !== newChannel.name) {
        changes.push(`Name: ${oldChannel.name} -> ${newChannel.name}`);
      }

      if (oldChannel.parentId !== newChannel.parentId) {
        changes.push(`Category: ${oldChannel.parentId || 'None'} -> ${newChannel.parentId || 'None'}`);
      }

      if (oldChannel.topic !== newChannel.topic) {
        changes.push(
          `Topic: ${oldChannel.topic || 'None'} -> ${newChannel.topic || 'None'}`
        );
      }

      if (oldChannel.nsfw !== newChannel.nsfw) {
        changes.push(`NSFW: ${oldChannel.nsfw} -> ${newChannel.nsfw}`);
      }

      if (oldChannel.rateLimitPerUser !== newChannel.rateLimitPerUser) {
        changes.push(`Slowmode: ${oldChannel.rateLimitPerUser || 0}s -> ${newChannel.rateLimitPerUser || 0}s`);
      }

      if (oldChannel.bitrate !== newChannel.bitrate) {
        changes.push(`Bitrate: ${oldChannel.bitrate || 0} -> ${newChannel.bitrate || 0}`);
      }

      if (oldChannel.userLimit !== newChannel.userLimit) {
        changes.push(`User limit: ${oldChannel.userLimit || 0} -> ${newChannel.userLimit || 0}`);
      }

      if (oldChannel.rtcRegion !== newChannel.rtcRegion) {
        changes.push(`RTC region: ${oldChannel.rtcRegion || 'Automatic'} -> ${newChannel.rtcRegion || 'Automatic'}`);
      }

      if (oldChannel.defaultAutoArchiveDuration !== newChannel.defaultAutoArchiveDuration) {
        changes.push(`Default thread archive: ${oldChannel.defaultAutoArchiveDuration || 'Unknown'} -> ${newChannel.defaultAutoArchiveDuration || 'Unknown'} minutes`);
      }

      if (oldChannel.defaultThreadRateLimitPerUser !== newChannel.defaultThreadRateLimitPerUser) {
        changes.push(`Default thread slowmode: ${oldChannel.defaultThreadRateLimitPerUser || 0}s -> ${newChannel.defaultThreadRateLimitPerUser || 0}s`);
      }

      changes.push(...permissionOverwriteChanges(oldChannel, newChannel));

      if (!changes.length) {
        return;
      }

      const audit = await findRecentAuditLog(
        newChannel.guild,
        AuditLogEvent.ChannelUpdate,
        newChannel.id
      );

      await logAudit(
        client,
        newChannel.guild.id,
        {
          action: 'CHANNEL_UPDATED',
          targetId: newChannel.id,
          executorId: audit?.executor?.id,
          type: 'SERVER',
          metadata: {
            channelId: newChannel.id,
            changes
          },
          embed: createAuditEmbed({
            action: 'Channel Updated',
            target: formatChannel(newChannel),
            executor: formatExecutor(audit),
            reason: audit?.reason || undefined,
            extra: changes.join('\n'),
            color: 0xFEE75C
          })
        }
      );
    } catch (err) {
      console.error('ChannelUpdate Error:', err);
    }
  }
};

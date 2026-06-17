const {
  AuditLogEvent
} = require('discord.js');

const {
  removeInvite
} = require('../utils/giveaways/cache');

const {
  createAuditEmbed,
  logAudit
} = require('../utils/logger');

const {
  findRecentAuditLog,
  formatExecutor
} = require('../utils/auditLookup');

module.exports = {

  name: 'inviteDelete',

  async execute(invite, client) {

    try {

      // ==========================================
      // 🛡 VALIDATION
      // ==========================================
      if (
        !invite ||
        !invite.guild ||
        !invite.code
      ) {

        return;
      }

      // ==========================================
      // 🚫 IGNORE VANITY URL
      // ==========================================
      if (
        invite.guild.vanityURLCode &&
        invite.code ===
        invite.guild.vanityURLCode
      ) {

        return;
      }

      // ==========================================
      // 🗑 REMOVE FROM CACHE
      // ==========================================
      removeInvite(

        invite.guild.id,

        invite.code
      );

      const audit =
        await findRecentAuditLog(
          invite.guild,
          AuditLogEvent.InviteDelete,
          invite.code
        );

      await logAudit(
        client,
        invite.guild.id,
        {
          action: 'INVITE_DELETED',
          executorId: audit?.executor?.id,
          type: 'INVITES',
          metadata: {
            code: invite.code,
            channelId: invite.channel?.id
          },
          embed: createAuditEmbed({
            action: 'Invite Deleted',
            executor: formatExecutor(audit),
            channel: invite.channel
              ? `<#${invite.channel.id}>`
              : 'Unknown',
            reason: audit?.reason || undefined,
            extra: `Code: ${invite.code}`,
            color: 0xED4245
          })
        }
      );

      // ==========================================
      // 🧾 DEBUG LOG
      // ==========================================
      if (
        process.env.NODE_ENV !==
        'production'
      ) {

        console.log(

          `➖ Invite deleted | ` +

          `${invite.guild.name} | ` +

          `${invite.code}`
        );
      }

    } catch (err) {

      console.error(
        'InviteDelete Error:',
        err
      );
    }
  }
};

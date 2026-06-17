const {
  AuditLogEvent
} = require('discord.js');

const {
  addInvite
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

  name: 'inviteCreate',

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
      // 💾 CACHE INVITE
      // ==========================================
      addInvite(

        invite.guild.id,

        invite
      );

      const audit =
        await findRecentAuditLog(
          invite.guild,
          AuditLogEvent.InviteCreate,
          invite.code
        );

      await logAudit(
        client,
        invite.guild.id,
        {
          action: 'INVITE_CREATED',
          executorId: audit?.executor?.id,
          type: 'INVITES',
          metadata: {
            code: invite.code,
            channelId: invite.channel?.id,
            maxUses: invite.maxUses || 0
          },
          embed: createAuditEmbed({
            action: 'Invite Created',
            executor: formatExecutor(audit),
            channel: invite.channel
              ? `<#${invite.channel.id}>`
              : 'Unknown',
            reason: audit?.reason || undefined,
            extra:
              `Code: ${invite.code}\n` +
              `Max Uses: ${invite.maxUses || 'Unlimited'}`,
            color: 0x57F287
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

          `➕ Invite created | ` +

          `${invite.guild.name} | ` +

          `${invite.code}`
        );
      }

    } catch (err) {

      console.error(
        'InviteCreate Error:',
        err
      );
    }
  }
};

const { randomUUID } = require('node:crypto');
const { EmbedBuilder, PermissionFlagsBits: P } = require('discord.js');
const { all, get, run, transaction } = require('../database');
const { withWorkLease } = require('./workLeases');
const {
  beginModerationAction, markDiscordApplied, completeModerationAction, markModerationFailed
} = require('./moderationActions');
const { createAuditEmbed, logAudit } = require('./logger');

const STAFF_PERMISSIONS = [P.Administrator, P.ManageGuild, P.BanMembers, P.KickMembers,
  P.ModerateMembers, P.ManageMessages, P.ManageRoles, P.ManageChannels, P.ManageWebhooks];
const ACTIVE_STATES = ['PREPARING', 'BANNING', 'ACTIVE', 'RELEASING'];
const workers = new WeakMap();
const leaseKey = (guildId, userId) => `trap-channel:${guildId}:${userId}`;
const errorText = error => String(error?.message || error).slice(0, 1000);

function settingsFor(guildId) {
  return get('SELECT * FROM trap_channel_settings WHERE guildId=?', [guildId]);
}

function isExempt(member, guild) {
  if (member.id === guild.ownerId || member.user?.bot) return true;
  if (STAFF_PERMISSIONS.some(permission => member.permissions.has(permission))) return true;
  const settings = get('SELECT staffRoleId,adminRoleId,giveawayRoleId FROM guild_settings WHERE guildId=?', [guild.id]) || {};
  const roles = [settings.staffRoleId, settings.adminRoleId, settings.giveawayRoleId,
    ...all('SELECT roleId FROM ticket_settings WHERE guildId=?', [guild.id]).map(row => row.roleId),
    ...all('SELECT reviewerRoleId FROM application_forms WHERE guildId=?', [guild.id]).map(row => row.reviewerRoleId),
    ...all('SELECT roleId FROM trap_channel_exempt_roles WHERE guildId=?', [guild.id]).map(row => row.roleId)];
  return roles.some(id => id && member.roles.cache.has(id));
}

async function fetchBan(guild, userId) {
  try { return await guild.bans.fetch({ user: userId, force: true }); }
  catch (error) {
    if (Number(error.code) === 10026) return null;
    throw error;
  }
}

function setState(id, status, error = null) {
  run('UPDATE trap_channel_incidents SET status=?,lastError=?,updatedAt=?,nextAttemptAt=0 WHERE id=?',
    [status, error, Date.now(), id]);
}

function cancelPreparation(row, status, reason) {
  transaction(() => {
    setState(row.id, status, reason);
    const record = get('SELECT status FROM moderation_actions WHERE recordId=?', [row.moderationRecordId]);
    if (record?.status === 'PENDING') markModerationFailed(row.moderationRecordId, new Error(reason));
  });
}

async function audit(client, row, action, extra) {
  try {
    await logAudit(client, row.guildId, {
      action, type: 'MODERATION', targetId: row.userId, executorId: client.user.id,
      metadata: { caseId: row.caseId, channelId: row.channelId, dmSent: Boolean(row.dmSent), ...extra },
      embed: createAuditEmbed({ action, target: `<@${row.userId}>`, executor: 'Jabster Studios',
        channel: `<#${row.channelId}>`, reason: extra?.reason || 'Trap-channel account protection',
        extra: `${row.caseId ? `Case #${row.caseId}\n` : ''}Recovery DM: ${row.dmSent ? 'sent' : 'not delivered'}\n${extra?.detail || ''}`,
        color: action === 'TRAP_BAN_EXPIRED' ? 0x57F287 : 0xED4245 })
    });
  } catch (error) { console.error('Trap-channel logging failed:', error); }
}

function recordAppliedBan(row) {
  markDiscordApplied(row.moderationRecordId,row.createdAt || Date.now());
  const result = completeModerationAction(row.moderationRecordId);
  run("UPDATE trap_channel_incidents SET status='ACTIVE',caseId=?,updatedAt=?,lastError=NULL,nextAttemptAt=0 WHERE id=?",
    [result.caseId, Date.now(), row.id]);
  return get('SELECT * FROM trap_channel_incidents WHERE id=?', [row.id]);
}

async function handleTrapMessage(message, client) {
  if (!message.guild || message.author.bot || message.webhookId || message.system) return false;
  const settings = settingsFor(message.guild.id);
  if (!settings?.enabled || settings.channelId !== message.channelId) return false;

  let exempt = false;
  let removalFailed = false;
  try {
    await withWorkLease(leaseKey(message.guild.id, message.author.id), async assertOwned => {
      const guild = message.guild;
      const member = await guild.members.fetch({ user: message.author.id, force: true });
      if (isExempt(member, guild)) { exempt = true; return; }
      const bot = await guild.members.fetchMe({ force: true });
      if (!bot.permissions.has(P.BanMembers) || !member.bannable || (message.channel?.permissionsFor && !message.channel.permissionsFor(bot)?.has(P.ManageMessages))) {
        throw new Error('Cannot apply trap protection: missing Ban Members permission or target role is too high.');
      }
      const existing = get(`SELECT * FROM trap_channel_incidents WHERE guildId=? AND userId=?
        AND status IN ('PREPARING','BANNING','ACTIVE','RELEASING')`, [guild.id, member.id]);
      if (existing && ['PREPARING','BANNING'].includes(existing.status)) return;
      const currentBan = await fetchBan(guild, member.id);
      if (currentBan) return;
      // A member manually unbanned and readmitted is eligible for a new incident.
      if (existing) setState(existing.id,'RELEASED');
      assertOwned();
      // Configuration can change while Discord requests are in flight.
      const current = settingsFor(guild.id);
      if (!current?.enabled || current.channelId !== message.channelId || isExempt(member, guild)) return;
      const id = randomUUID();
      const now = Date.now();
      const expiresAt = now + current.durationHours * 3_600_000;
      const banReason = `Trap-channel protection: possible compromised account. [trap:${id}]`;
      transaction(() => {
        const moderation = beginModerationAction({ guildId: guild.id, userId: member.id,
          moderatorId: client.user.id, action: 'BAN', reason: 'Posted in the configured trap channel; possible compromised account.',
          duration: `${current.durationHours}h`, expiresAt, channelId: message.channelId });
        run(`INSERT INTO trap_channel_incidents
          (id,guildId,userId,channelId,messageId,banReason,status,createdAt,expiresAt,updatedAt,moderationRecordId)
          VALUES(?,?,?,?,?,?,'PREPARING',?,?,?,?)`,
        [id,guild.id,member.id,message.channelId,message.id,banReason,now,expiresAt,now,moderation.recordId]);
      });

      let dmError = null;
      try {
        await member.user.send({ allowedMentions: { parse: [] }, embeds: [new EmbedBuilder()
          .setColor(0xED4245).setTitle('Account safety notice')
          .setDescription(`You posted in the do-not-post trap channel in **${guild.name}**. This may indicate a compromised account, but it is not proof.\n\n` +
            `You will be temporarily banned for ${current.durationHours} hour(s). The bot is scheduled to lift this ban <t:${Math.floor(expiresAt / 1000)}:F>. ` +
            'Server staff may override this decision. The ban can only be lifted while the bot is online and has permission.\n\n' +
            'If this was not you, secure your Discord account, change your password, enable two-factor authentication, and remove unfamiliar authorized apps. ' +
            'Jabster Studios will never ask for your password, token, or a QR-code login.\n\n' +
            `Once the ban has been lifted and your account is secure, you can rejoin here:\n${current.inviteUrl}`)] });
        run('UPDATE trap_channel_incidents SET dmSent=1 WHERE id=?', [id]);
      } catch (error) { dmError = errorText(error); }

      assertOwned();
      const latest = settingsFor(guild.id);
      const freshMember = await guild.members.fetch({ user: member.id, force: true });
      if (!latest?.enabled || latest.channelId !== message.channelId || isExempt(freshMember, guild) || !freshMember.bannable) {
        cancelPreparation(get('SELECT * FROM trap_channel_incidents WHERE id=?', [id]),
          'CANCELLED', 'Protection disabled or member became exempt before the ban.');
        return;
      }
      // Do not replace a manual ban made while the safety DM was being delivered.
      if (await fetchBan(guild, member.id)) {
        cancelPreparation(get('SELECT * FROM trap_channel_incidents WHERE id=?', [id]),
          'SUPERSEDED', 'Another moderation action banned this member before the trap ban.');
        return;
      }
      assertOwned();
      const finalSettings = settingsFor(guild.id);
      if (!finalSettings?.enabled || finalSettings.channelId !== message.channelId || isExempt(freshMember,guild)) {
        cancelPreparation(get('SELECT * FROM trap_channel_incidents WHERE id=?',[id]),'CANCELLED','Trap protection changed before application.');
        return;
      }
      setState(id, 'BANNING', dmError);
      await guild.members.ban(member.id, { reason: banReason, deleteMessageSeconds: 0 });
      const row = recordAppliedBan(get('SELECT * FROM trap_channel_incidents WHERE id=?', [id]));
      if (typeof message.delete === 'function') {
        try { await message.delete(); }
        catch (error) { removalFailed = true; console.error('Trap message removal failed:',error); }
      }
      await audit(client, row, 'TRAP_BAN', { detail: `Automatic unban scheduled <t:${Math.floor(expiresAt / 1000)}:F>.` });
    });
  } catch (error) {
    // A failed/uncertain ban remains in BANNING and is reconciled against Discord, never blindly repeated.
    if (/already running/.test(error.message)) return true;
    console.error('Trap-channel protection failed:', error);
    return false;
  }
  return !exempt && !removalFailed;
}

async function reconcileIncident(client, id, now = Date.now()) {
  const original = get('SELECT * FROM trap_channel_incidents WHERE id=?', [id]);
  if (!original || !ACTIVE_STATES.includes(original.status)) return;
  return withWorkLease(leaseKey(original.guildId, original.userId), async assertOwned => {
    let row = get('SELECT * FROM trap_channel_incidents WHERE id=?', [id]);
    if (!ACTIVE_STATES.includes(row?.status)) return;
    const guild = client.guilds.cache.get(row.guildId);
    if (!guild) throw new Error('Server unavailable; retaining scheduled trap ban for retry.');
    const ban = await fetchBan(guild, row.userId);
    assertOwned();
    if (!ban) {
      const state = ['ACTIVE','RELEASING'].includes(row.status) ? 'RELEASED' : 'CANCELLED';
      if (state === 'CANCELLED') cancelPreparation(row,state,'No trap ban found during recovery.');
      else setState(id, state);
      return;
    }
    if (ban.reason !== row.banReason) {
      setState(id, 'SUPERSEDED', 'Ban belongs to another moderation action; automatic unban cancelled.');
      await audit(client, row, 'TRAP_BAN_SUPERSEDED', { detail: 'A different ban is in place. It will not be automatically removed.' });
      return;
    }
    if (!row.caseId) row = recordAppliedBan(row);
    if (row.expiresAt > now) return;
    assertOwned();
    setState(id, 'RELEASING');
    await guild.members.unban(row.userId, 'Trap-channel temporary ban expired');
    setState(id, 'RELEASED');
    await audit(client, row, 'TRAP_BAN_EXPIRED', { detail: 'Temporary ban lifted. The member may use their recovery invite to rejoin.' });
  });
}

function startTrapProtection(client) {
  if (workers.has(client)) return workers.get(client);
  const timer = require('./serviceRunner').startManagedLoop(
    'trap-channel-expiry', () => processTrapBans(client), 30_000, { timeoutMs: 60_000 });
  workers.set(client,timer);
  return timer;
}

async function processTrapBans(client, now = Date.now()) {
  const rows = all(`SELECT id FROM trap_channel_incidents WHERE nextAttemptAt<=? AND
    ((status IN ('ACTIVE','RELEASING') AND expiresAt<=?) OR
     (status IN ('PREPARING','BANNING') AND updatedAt<=?)) ORDER BY expiresAt LIMIT 100`, [now,now,now-120_000]);
  for (const row of rows) {
    try { await reconcileIncident(client, row.id, now); }
    catch (error) {
      run('UPDATE trap_channel_incidents SET lastError=?,nextAttemptAt=? WHERE id=?', [errorText(error),now+60_000,row.id]);
      console.error('Trap-ban recovery failed; will retry:', error);
    }
  }
  return rows.length;
}

async function holdTrapBan(client, guildId, userId) {
  return withWorkLease(leaseKey(guildId,userId), async assertOwned => {
    const row = get("SELECT * FROM trap_channel_incidents WHERE guildId=? AND userId=? AND status='ACTIVE'", [guildId,userId]);
    if (!row) throw new Error('No active trap ban was found for that user.');
    const guild = client.guilds.cache.get(guildId);
    if (!guild || (await fetchBan(guild,userId))?.reason !== row.banReason) throw new Error('The original trap ban is no longer in place.');
    assertOwned();
    transaction(() => {
      setState(row.id, 'HELD');
      run('UPDATE cases SET expiresAt=NULL,duration=NULL WHERE id=? AND guildId=?', [row.caseId,guildId]);
      run('UPDATE moderation_actions SET expiresAt=NULL,duration=NULL WHERE recordId=?', [row.moderationRecordId]);
    });
    await audit(client,row,'TRAP_BAN_HELD',{ detail: 'Administrator cancelled the automatic expiry. Manual unban is required.' });
  });
}

module.exports = { handleTrapMessage, holdTrapBan, isExempt, processTrapBans, reconcileIncident, settingsFor, startTrapProtection };

const {
  findCensoredTerm,
  getCensorSettings,
  listCensorTerms,
  getCensorBypassRoles,
  getCensorBypassChannels,
  getCensorBypassCategories
} = require('./censor');
const { findRacistTerm } = require('./racismFilter');
const { hasWhitelistedRole, isWhitelistedChannel } = require('./contentFilterWhitelist');
const { suppressMessageDelete, unsuppressMessageDelete } = require('./messageDeletionTracker');
const { createAuditEmbed, logAudit } = require('./logger');
const { performModerationAction } = require('./moderationActions');

async function sendCensorNotice(message, content) {
  if (typeof message.channel?.send !== 'function') return;

  return message.channel.send({
    content,
    allowedMentions: {
      users: [message.author.id],
      roles: [],
      parse: []
    }
  })
    .then(sent => {
      const timer = setTimeout(() => sent.delete().catch(() => {}), 5000);
      timer.unref?.();
    })
    .catch(() => {});
}

async function handleCensor(message, client) {
  if (!message.guild || !message.author || message.author.bot || !message.content) return false;

  const settings = getCensorSettings(message.guild.id);
  const builtInTerm = Number(settings?.censorAntiRacismEnabled) === 1
    ? findRacistTerm(message.content)
    : null;
  let term = builtInTerm;

  if (!term) {
    if (Number(settings?.censorEnabled) !== 1) return false;
    if (
      hasWhitelistedRole(message.member, getCensorBypassRoles(settings)) ||
      isWhitelistedChannel(
        message,
        getCensorBypassChannels(settings),
        getCensorBypassCategories(settings)
      )
    ) {
      return false;
    }

    term = findCensoredTerm(
      message.content,
      listCensorTerms(message.guild.id),
      settings?.censorMatchMode || 'STRICT'
    );
  }

  if (!term) return false;

  suppressMessageDelete(message.id);
  try {
    await message.delete();
  } catch (error) {
    unsuppressMessageDelete(message.id);
    console.error('Censor delete failed:', error.message);
    return false;
  }

  const filter = builtInTerm ? 'ANTI_RACISM' : 'CUSTOM';
  const configuredAction = String(settings?.censorAction || 'DELETE').toUpperCase();
  const action = builtInTerm ? 'DELETE_WARN' : configuredAction;
  let timeoutCaseId = null;
  let timeoutError = null;

  if (action === 'TIMEOUT' && message.member?.moderatable) {
    const duration = 5 * 60 * 1000;
    const expiresAt = Date.now() + duration;

    try {
      const result = await performModerationAction(
        {
          guildId: message.guild.id,
          userId: message.author.id,
          moderatorId: client.user.id,
          action: 'AUTO-TIMEOUT',
          reason: `Custom censor match: ${term}`,
          duration,
          expiresAt,
          channelId: message.channel.id
        },
        () => message.member.timeout(duration, `Custom censor match: ${term}`)
      );
      timeoutCaseId = result.caseId;
    } catch (error) {
      timeoutError = error.message;
      console.error('Censor timeout failed:', error);
    }
  }

  if (action === 'DELETE_WARN' || builtInTerm) {
    await sendCensorNotice(
      message,
      `${message.author}, that message was removed by this server's content filter.`
    );
  }

  await logAudit(client, message.guild.id, {
    action: 'MESSAGE_CENSORED',
    targetId: message.author.id,
    executorId: client.user?.id,
    type: 'MESSAGES',
    metadata: {
      channelId: message.channel.id,
      messageId: message.id,
      term,
      filter,
      matchMode: builtInTerm ? 'BUILT_IN' : settings?.censorMatchMode || 'STRICT',
      enforcementAction: action,
      timeoutCaseId,
      timeoutError,
      edited: Boolean(message.editedTimestamp),
      content: message.content
    },
    embed: createAuditEmbed({
      action: builtInTerm ? 'Racial Slur Blocked' : 'Message Censored',
      target: `${message.author.tag}\n<@${message.author.id}>`,
      executor: client.user ? `${client.user.tag}\n<@${client.user.id}>` : 'Bot',
      channel: `<#${message.channel.id}>`,
      extra:
        `Filter: ${filter}\n` +
        `Matched term: ${term}\n` +
        `Action: ${action}` +
        (timeoutCaseId ? ` (Case #${timeoutCaseId})` : '') +
        `\nContent: ${message.content}`,
      color: 0xED4245
    })
  }).catch(error => console.error('Censor audit failed:', error.message));

  return true;
}

module.exports = { handleCensor };

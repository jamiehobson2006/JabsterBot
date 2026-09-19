const {
  findCensoredTerm, getCensorSettings, listCensorTerms,
  getCensorBypassRoles, getCensorBypassChannels, getCensorBypassCategories
} = require('./censor');
const { findRacistTerm } = require('./racismFilter');
const { hasWhitelistedRole, isWhitelistedChannel } = require('./contentFilterWhitelist');
const { suppressMessageDelete, unsuppressMessageDelete } = require('./messageDeletionTracker');
const { createAuditEmbed, logAudit } = require('./logger');

async function handleCensor(message, client) {
  if (!message.guild || !message.author || message.author.bot || !message.content) return false;
  const settings = getCensorSettings(message.guild.id);
  const builtInTerm = Number(settings?.censorAntiRacismEnabled) === 1
    ? findRacistTerm(message.content)
    : null;
  let term = builtInTerm;

  if (!term) {
    if (Number(settings?.censorEnabled) !== 1) return false;
    if (hasWhitelistedRole(message.member, getCensorBypassRoles(settings)) ||
        isWhitelistedChannel(message, getCensorBypassChannels(settings), getCensorBypassCategories(settings))) {
      return false;
    }
    term = findCensoredTerm(message.content, listCensorTerms(message.guild.id));
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
  await logAudit(client, message.guild.id, {
    action: 'MESSAGE_CENSORED',
    targetId: message.author.id,
    executorId: client.user?.id,
    type: 'MESSAGES',
    metadata: {
      channelId: message.channel.id, messageId: message.id,
      term, filter, edited: Boolean(message.editedTimestamp), content: message.content
    },
    embed: createAuditEmbed({
      action: builtInTerm ? 'Racial Slur Blocked' : 'Message Censored',
      target: `${message.author.tag}\n<@${message.author.id}>`,
      executor: client.user ? `${client.user.tag}\n<@${client.user.id}>` : 'Bot',
      channel: `<#${message.channel.id}>`,
      extra: `Filter: ${filter}\nMatched term: ${term}\nContent: ${message.content}`,
      color: 0xED4245
    })
  }).catch(error => console.error('Censor audit failed:', error.message));
  return true;
}

module.exports = { handleCensor };

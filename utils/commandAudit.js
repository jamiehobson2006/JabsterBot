const MUTATING_COMMANDS = new Set([
  'application',
  'ban',
  'censor',
  'clearwarns',
  'dailyfact',
  'gblacklist',
  'gdelete',
  'gend',
  'giveaway',
  'greroll',
  'gunblacklist',
  'kick',
  'level',
  'leveling',
  'levelreward',
  'linkblock',
  'lock',
  'modlogremove',
  'mute',
  'poll',
  'purge',
  'role',
  'setinvitechannel',
  'setmodlogs',
  'settranscriptchannel',
  'slowmode',
  'socialadd',
  'socialremove',
  'stafflist',
  'suggestchannel',
  'ticket',
  'ticketfeedback',
  'ticketpanel',
  'ticketsetup',
  'unban',
  'unlock',
  'unmute',
  'warn'
]);

const READ_ONLY_SUBCOMMANDS = new Set([
  'bypass-category-list',
  'bypass-channel-list',
  'bypass-role-list',
  'category-list',
  'channel-list',
  'debug',
  'info',
  'list',
  'mutedchannels',
  'settings',
  'stats',
  'status',
  'view',
  'whitelist-list'
]);

function getSubcommand(interaction) {
  try {
    return interaction.options?.getSubcommand(false) || null;
  } catch {
    return null;
  }
}

function shouldLogCommand(command, interaction) {
  if (command.auditLog === true) return true;
  if (command.auditLog === false) return false;

  if (!MUTATING_COMMANDS.has(interaction.commandName)) {
    return false;
  }

  return !READ_ONLY_SUBCOMMANDS.has(getSubcommand(interaction));
}

module.exports = {
  MUTATING_COMMANDS,
  READ_ONLY_SUBCOMMANDS,
  shouldLogCommand
};

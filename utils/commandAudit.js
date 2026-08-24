const MUTATING_COMMANDS = new Set([
  'application',
  'antispam',
  'ban',
  'censor',
  'changelog',
  'clearwarns',
  'commandcontrol',
  'dailyfact',
  'freegames',
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
  'loggingmanager',
  'loggingstyle',
  'lock',
  'modlogremove',
  'mute',
  'poll',
  'purge',
  'role',
  'reactionrole',
  'setinvitechannel',
  'setmodlogs',
  'settranscriptchannel',
  'slowmode',
  'socialadd',
  'socialremove',
  'stafflist',
  'suggestchannel',
  'suggestionmanager',
  'verification',
  'greetings',
  'ticket',
  'ticketfeedback',
  'ticketpanel',
  'ticketsetup',
  'tickettargets',
  'tempvoice',
  'unban',
  'unlock',
  'unmute',
  'warn'
]);

const READ_ONLY_SUBCOMMANDS = new Set([
  'bypass-category-list',
  'bypass-channel-list',
  'bypass-role-list',
  'bypass-list',
  'category-list',
  'channel-list',
  'debug',
  'info',
  'list',
  'mutedchannels',
  'reset',
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

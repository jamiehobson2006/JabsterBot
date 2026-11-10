const MUTATING_COMMANDS = new Set([
  'automation',
  'trapchannel',
  'application',
  'antispam',
  'ban',
  'censor',
  'changelog',
  'clearwarns',
  'commandcontrol',
  'configuration',
  'suggestions',
  'dailyfact',
  'dailyinteraction',
  'dailysettings',
  'delivery',
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
  'modmail',
  'phishing',
  'poll',
  'pollmanage',
  'purge',
  'role',
  'selfrole',
  'reactionrole',
  'setinvitechannel',
  'inviteadmin',
  'setmodlogs',
  'settranscriptchannel',
  'slowmode',
  'socialadd',
  'socialremove',
  'stafflist',
  'staffrota',
  'suggestchannel',
  'suggestionmanager',
  'verification',
  'greetings',
  'ticket',
  'ticketfeedback',
  'ticketpanel',
  'ticketsetup',
  'ticketsla',
  'tickettargets',
  'tempvoice',
  'unban',
  'unlock',
  'unmute',
  'warn'
]);

const READ_ONLY_SUBCOMMANDS = new Set([
  'analytics',
  'leaderboard',
  'member-stats',
  'prompt-list',
  'theme-list',
  'reward-list',
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
  'settings',
  'stats',
  'status',
  'view',
  'contact',
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
  if(['knowledge','challenge','partner','temprole','training','socialsettings'].includes(interaction.commandName)) {
    const sub=getSubcommand(interaction);
    return !['list','show','view','search','history','pending','approved','settings','next','start','answer','results','queue','ticket'].includes(sub);
  }
  if(interaction.commandName==='ticketstats') return ['hours','hours-clear'].includes(getSubcommand(interaction));
  if (interaction.commandName === 'automation') return !['use','list','status','preview'].includes(getSubcommand(interaction));
  if(interaction.commandName==='logging') return ['retention','exclude'].includes(interaction.options?.getString?.('view'));
  if (interaction.commandName === 'factsources') return getSubcommand(interaction) === 'verify';
  if (interaction.commandName === 'configuration') return getSubcommand(interaction) === 'apply';
  if (interaction.commandName === 'suggestions') return ['link','unlink'].includes(getSubcommand(interaction));
  if (command.auditLog === true) return true;
  if (command.auditLog === false) return false;

  if (!MUTATING_COMMANDS.has(interaction.commandName)) {
    return false;
  }

  if (interaction.commandName === 'selfrole') {
    return ['allow', 'disallow'].includes(getSubcommand(interaction));
  }

  return !READ_ONLY_SUBCOMMANDS.has(getSubcommand(interaction));
}

module.exports = {
  MUTATING_COMMANDS,
  READ_ONLY_SUBCOMMANDS,
  shouldLogCommand
};

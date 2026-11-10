// Each entry reuses its existing handler; only the public slash-command path changes.
const GROUPS = [
  { name: 'giveaway', description: 'Create, manage and review giveaways.', category: 'giveaways', entries: {
    start: 'giveaway', list: 'glist', info: 'ginfo', stats: 'gstats', end: 'gend',
    reroll: 'greroll', delete: 'gdelete', blacklist: 'gblacklist', unblacklist: 'gunblacklist'
  } },
  { name: 'social', description: 'Configure YouTube and Twitch notifications.', category: 'social', entries: {
    add: 'socialadd', remove: 'socialremove', list: 'sociallist', settings: 'socialsettings'
  } },
  { name: 'ticket', description: 'Ticket management, setup, archives, feedback and statistics.', category: 'config', entries: {
    manage: 'ticket', setup: 'ticketsetup', panel: 'ticketpanel', stats: 'ticketstats',
    feedback: 'ticketfeedback', sla: 'ticketsla', targets: 'tickettargets', transcripts: 'settranscriptchannel'
  } },
  { name: 'leveling', description: 'Ranks, leaderboards, XP settings and reward roles.', category: 'leveling', entries: {
    config: 'leveling', admin: 'level', rewards: 'levelreward', rank: 'rank', leaderboard: 'leaderboard'
  } },
  { name: 'invites', description: 'Invite counts, attribution, leaderboards and configuration.', category: 'utility', entries: {
    view: 'invites', leaderboard: 'invitetop', info: 'inviteinfo', admin: 'inviteadmin', channel: 'setinvitechannel'
  } },
  { name: 'logging', description: 'Logging dashboard, destinations, presentation and managers.', category: 'config', entries: {
    dashboard: 'logging', managers: 'loggingmanager', style: 'loggingstyle', channel: 'setmodlogs'
  } },
  { name: 'suggestions', description: 'Submit suggestions and manage channels, duplicates and reviewers.', category: 'suggestions', entries: {
    submit: 'suggest', duplicates: 'suggestions', channel: 'suggestchannel', managers: 'suggestionmanager'
  } },
  { name: 'modlogs', description: 'Punishment history, case details and audited corrections.', category: 'moderation', entries: {
    list: 'modlogs', case: 'case', edit: 'editcase', remove: 'modlogremove', history: 'history'
  } },
  { name: 'warnings', description: 'View, issue and clear member warnings.', category: 'moderation', entries: {
    list: 'warnings', add: 'warn', clear: 'clearwarns'
  } },
  { name: 'fun', description: 'Games, memes and light-hearted community commands.', category: 'fun', entries: {
    '8ball': '8ball', coinflip: 'coinflip', meme: 'meme', rate: 'rate', ship: 'ship'
  } },
  { name: 'info', description: 'Member, server and bot information.', category: 'utility', entries: {
    user: 'userinfo', server: 'serverinfo', ping: 'ping', uptime: 'uptime'
  } }
];

const LEGACY_PATHS = Object.fromEntries(GROUPS.flatMap(group =>
  Object.entries(group.entries).map(([action, source]) => [source, `${group.name} ${action}`])));

function normalizePath(value) {
  return String(value || '').trim().toLowerCase().replace(/^\//, '').replace(/\s+/g, ' ');
}

function legacyCommandPath(value) {
  const name = normalizePath(value);
  return LEGACY_PATHS[name] || name;
}

module.exports = { GROUPS, LEGACY_PATHS, legacyCommandPath, normalizePath };

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempDir = fs.mkdtempSync(
  path.join(os.tmpdir(), 'jabster-studios-daily-interactions-')
);

process.env.DATABASE_PATH = path.join(tempDir, 'database.db');

const {
  initDatabase
} = require('../database');

const {
  addCustomPrompt,
  buildInteractionEmbed,
  chooseInteraction,
  clearDayTheme,
  getDailyInteractionAnalytics,
  getDailyInteractionConfig,
  getEngagementLeaderboard,
  getMemberEngagementStats,
  getInteractionTypes,
  listDayThemes,
  listCustomPrompts,
  removeCustomPrompt,
  recordMemberEngagement,
  setDayTheme,
  setCustomPromptEnabled,
  updateDailyInteractionConfig,
  updateInteractionType
} = require('../services/DailyInteractionService');

test('daily interaction configuration and activity controls persist', () => {
  initDatabase();

  updateDailyInteractionConfig('guild-1', {
    channelId: 'community-chat',
    pingRoleId: 'community-role',
    hour: 18,
    minute: 30,
    timezone: 'Europe/London',
    titlePrefix: 'Community Spark',
    color: 0x57F287,
    discussionEnabled: 1,
    updatedBy: 'admin-1'
  });

  updateInteractionType({
    guildId: 'guild-1',
    type: 'GAME',
    weight: 5
  });

  updateInteractionType({
    guildId: 'guild-1',
    type: 'QUESTION',
    enabled: false
  });

  const config = getDailyInteractionConfig('guild-1');
  assert.equal(config.channelId, 'community-chat');
  assert.equal(config.hour, 18);
  assert.equal(config.titlePrefix, 'Community Spark');

  const types = getInteractionTypes('guild-1');
  assert.equal(types.find(type => type.type === 'GAME').weight, 5);
  assert.equal(types.find(type => type.type === 'QUESTION').enabled, 0);
});

test('custom prompts can be managed and random selection returns an enabled activity', () => {
  initDatabase();

  const id = addCustomPrompt({
    guildId: 'guild-1',
    type: 'GAME',
    prompt: 'Share your favourite co-op game and why it is fun with friends.',
    title: 'Custom Community Game',
    createdBy: 'admin-1'
  });

  assert.equal(listCustomPrompts('guild-1', 'GAME').some(prompt => prompt.id === Number(id)), true);

  setCustomPromptEnabled({ guildId: 'guild-1', id, enabled: false });
  assert.equal(listCustomPrompts('guild-1', 'GAME').find(prompt => prompt.id === Number(id)).enabled, 0);

  const interaction = chooseInteraction({
    guildId: 'guild-1',
    type: 'RANDOM',
    random: () => 0
  });

  assert.ok(interaction);
  assert.notEqual(interaction.type, 'QUESTION');
  assert.ok(interaction.prompt.length > 0);

  assert.equal(removeCustomPrompt('guild-1', id).changes, 1);
});

test('daily interaction embeds show participation and the community activity', () => {
  const embed = buildInteractionEmbed(
    {
      color: 0x5865F2,
      titlePrefix: 'Community Spark'
    },
    {
      type: 'GAME',
      prompt: 'Word chain: reply with a word beginning with the last letter of adventure.',
      source: 'built-in'
    },
    4
  );

  assert.match(embed.data.title, /Community Spark/);
  assert.match(embed.data.description, /Word chain/);
  assert.equal(embed.data.fields.find(field => field.name === 'Participants').value, '4');
});

test('weekday themes persist and can be returned to weighted random selection', () => {
  initDatabase();

  setDayTheme({ guildId: 'guild-1', dayOfWeek: 1, type: 'GAME' });
  setDayTheme({ guildId: 'guild-1', dayOfWeek: 5, type: 'CHALLENGE' });

  const themes = listDayThemes('guild-1');
  assert.equal(themes.find(theme => theme.dayOfWeek === 1).type, 'GAME');
  assert.equal(themes.find(theme => theme.dayOfWeek === 5).type, 'CHALLENGE');
  assert.equal(clearDayTheme('guild-1', 1).changes, 1);
  assert.equal(listDayThemes('guild-1').some(theme => theme.dayOfWeek === 1), false);
});

test('member engagement tracks points and one streak update per local date', () => {
  initDatabase();

  recordMemberEngagement({
    guildId: 'guild-2',
    userId: 'user-1',
    dateKey: '2026-08-01',
    joined: true,
    responded: true,
    now: 1
  });
  recordMemberEngagement({
    guildId: 'guild-2',
    userId: 'user-1',
    dateKey: '2026-08-01',
    responded: true,
    now: 2
  });
  recordMemberEngagement({
    guildId: 'guild-2',
    userId: 'user-1',
    dateKey: '2026-08-02',
    joined: true,
    now: 3
  });

  const stats = getMemberEngagementStats('guild-2', 'user-1');
  assert.equal(stats.totalJoins, 2);
  assert.equal(stats.totalResponses, 2);
  assert.equal(stats.currentStreak, 2);
  assert.equal(stats.longestStreak, 2);
  assert.equal(getEngagementLeaderboard('guild-2')[0].userId, 'user-1');
  const analytics = getDailyInteractionAnalytics('guild-2');
  assert.equal(analytics.posts, 0);
  assert.equal(analytics.participants, 0);
  assert.equal(analytics.responses, 0);
  assert.deepEqual(analytics.types, []);
});

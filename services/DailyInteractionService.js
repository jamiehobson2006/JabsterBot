const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits
} = require('discord.js');

const {
  all,
  get,
  run
} = require('../database');

const {
  createAuditEmbed,
  logAudit
} = require('../utils/logger');

const {
  listCensorTerms
} = require('../utils/censor');

const {
  validateDailyInteractionContent,
  validateDailyInteractionPrompt
} = require('../utils/dailyInteractionSafety');

const DAY_MS = 24 * 60 * 60 * 1000;
const DELIVERY_COOLDOWN_MS = 30 * DAY_MS;
const DEFAULT_TIMEZONE = 'Europe/London';
const threadCreationLocks = new Map();

const DAY_NAMES = Object.freeze([
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday'
]);

const INTERACTION_TYPES = Object.freeze({
  QUESTION: {
    label: 'Question of the Day',
    emoji: '💬',
    prompts: [
      'What is one small thing that made your day better recently?',
      'If you could instantly master one skill, which would you choose?',
      'What game, film, or show would you recommend to everyone here?',
      'What is a goal you would love to complete this month?',
      'What is the best piece of advice you have ever received?',
      'What is a hobby you would like to try one day?',
      'What is one thing you are looking forward to this week?',
      'What simple item makes your setup or room better?',
      'What is a game feature you wish more games included?',
      'What is a positive habit you would recommend to someone else?'
    ]
  },
  WOULD_YOU_RATHER: {
    label: 'Would You Rather',
    emoji: '⚖️',
    prompts: [
      'Would you rather explore space or the deepest ocean?',
      'Would you rather have unlimited time or unlimited money?',
      'Would you rather always be early or always be lucky?',
      'Would you rather replay your favourite game for the first time or watch your favourite film for the first time?',
      'Would you rather live in a world with no music or no games?',
      'Would you rather build a city or explore a lost world?',
      'Would you rather have a perfect memory or perfect focus?',
      'Would you rather be able to pause time or rewind it for one minute?',
      'Would you rather have a new game release every week or one amazing game every year?',
      'Would you rather always know the best route or always find the best deal?'
    ]
  },
  THIS_OR_THAT: {
    label: 'This or That',
    emoji: '🔀',
    prompts: [
      'Early bird or night owl?',
      'Sweet snacks or savoury snacks?',
      'Voice chat or text chat?',
      'Single-player adventures or multiplayer chaos?',
      'Mountains or beaches?',
      'Console or PC?',
      'Sunrise or sunset?',
      'Planning ahead or being spontaneous?',
      'Rainy-day games or sunny-day adventures?',
      'Fantasy worlds or science-fiction worlds?'
    ]
  },
  CHALLENGE: {
    label: 'Daily Challenge',
    emoji: '🎯',
    prompts: [
      'Share something you are proud of, however small it seems.',
      'Welcome or encourage someone you do not usually talk to.',
      'Describe a screenshot, drawing, build, or project you have worked on.',
      'Teach the community one useful thing in a short message.',
      'Give a genuine shout-out to another community member.',
      'Share one small win from this week.',
      'Recommend a positive activity someone can do in ten minutes.',
      'Describe your ideal community event in one short message.',
      'Share a favourite tip for a game or hobby.',
      'Thank someone who has helped you recently.'
    ]
  },
  GAME: {
    label: 'Community Game',
    emoji: '🎮',
    prompts: [
      'Word chain: reply with a word beginning with the last letter of **adventure**.',
      'Two truths and a lie: post three statements about yourself and let people guess the lie.',
      'Alphabet challenge: name a game, film, or show beginning with the letter **M**.',
      'Emoji story: describe your day using exactly five emojis.',
      'One-word story: add one word to continue the community story in the thread.',
      'Word chain: reply with a word beginning with the last letter of **lantern**.',
      'Alphabet challenge: name a game, film, or show beginning with the letter **S**.',
      'Rhyme round: name one word that rhymes with light.',
      'Five-letter round: share one ordinary word with exactly five letters.',
      'Co-op pick: name one game that would make a fun community game night.'
    ]
  },
  TRIVIA: {
    label: 'Quick Trivia',
    emoji: '\u{1F9E0}',
    prompts: [
      'Trivia: What is the largest planet in our solar system?',
      'Trivia: Which ocean is the largest on Earth?',
      'Trivia: How many sides does a hexagon have?',
      'Trivia: What colour do blue and yellow make when mixed?',
      'Trivia: Which animal is famous for black and white stripes?',
      'Trivia: What is the capital city of Japan?',
      'Trivia: Which season comes after summer in the UK?',
      'Trivia: How many minutes are in one hour?',
      'Trivia: What is the tallest type of land animal?',
      'Trivia: Which planet is known as the Red Planet?'
    ]
  },
  ICEBREAKER: {
    label: 'Icebreaker',
    emoji: '\u{1F44B}',
    prompts: [
      'What is your go-to comfort game, film, or show?',
      'What is a small tradition you enjoy?',
      'What is one place you would love to visit someday?',
      'What is your favourite way to relax after a busy day?',
      'What is a skill you are currently improving?',
      'What is one thing your friends would say you are good at?',
      'What is your favourite type of community event?',
      'What is something that always makes you laugh?',
      'What is a game you think deserves more attention?',
      'What would your ideal weekend look like?'
    ]
  },
  CREATIVE: {
    label: 'Creative Corner',
    emoji: '\u{1F3A8}',
    prompts: [
      'Invent a name for a new Roblox game in five words or fewer.',
      'Describe a dream game update in one sentence.',
      'Name a new community event idea.',
      'Create a friendly slogan for today in one line.',
      'Describe a fictional item you would add to a game.',
      'Give a new name to your favourite game genre.',
      'Write a short title for an underwater adventure.',
      'Describe a peaceful place using three words.',
      'Invent a harmless superpower for a community helper.',
      'Name one thing that would make a game lobby more fun.'
    ]
  },
  COMMUNITY_PICK: {
    label: 'Community Pick',
    emoji: '\u{1F4CB}',
    prompts: [
      'Pick one for game night: racing, building, survival, or puzzles.',
      'Pick a future event time: weekday evening or weekend afternoon.',
      'Pick a theme for a community challenge: summer, underwater, space, or fantasy.',
      'Pick one feature for a dream server: game nights, art shows, tournaments, or movie nights.',
      'Pick a setting for an adventure: island, city, forest, or mountains.',
      'Pick a community reward: custom role, spotlight, event access, or badge.',
      'Pick a game mood: relaxed, competitive, creative, or social.',
      'Pick an event style: team challenge, scavenger hunt, quiz, or showcase.',
      'Pick a soundtrack mood: calm, upbeat, cinematic, or retro.',
      'Pick a mascot idea: robot, dragon, explorer, or wizard.'
    ]
  },
  APPRECIATION: {
    label: 'Positive Moment',
    emoji: '\u{1F31F}',
    prompts: [
      'Share one thing this community does well.',
      'Give a kind compliment to someone who helped you recently.',
      'What is one achievement you are proud of this month?',
      'Share one encouraging sentence someone might need today.',
      'What makes a community feel welcoming to you?',
      'Thank someone for a good memory or useful advice.',
      'Share one thing you have learned from another member.',
      'What is one way people can make online spaces kinder?',
      'Recognise a positive choice you made this week.',
      'Share a small moment that made you smile.'
    ]
  }
});

function validTimezone(timezone) {
  try {
    Intl.DateTimeFormat('en-GB', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

function getDateParts(date, timezone = DEFAULT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: validTimezone(timezone) ? timezone : DEFAULT_TIMEZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit'
  })
    .formatToParts(date)
    .reduce((result, part) => {
      if (part.type !== 'literal') result[part.type] = part.value;
      return result;
    }, {});

  return {
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    dayOfWeek: Math.max(0, ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
      .indexOf(parts.weekday))
  };
}

function interactionType(type) {
  return INTERACTION_TYPES[String(type || '').toUpperCase()] || null;
}

function listInteractionTypes() {
  return Object.entries(INTERACTION_TYPES).map(([value, data]) => ({
    value,
    ...data
  }));
}

function ensureDailyInteractionConfig(guildId) {
  run(
    `INSERT OR IGNORE INTO daily_interaction_config (guildId)
     VALUES (?)`,
    [guildId]
  );

  for (const type of Object.keys(INTERACTION_TYPES)) {
    run(
      `INSERT OR IGNORE INTO daily_interaction_types (guildId, type)
       VALUES (?, ?)`,
      [guildId, type]
    );
  }

  return getDailyInteractionConfig(guildId);
}

function getDailyInteractionConfig(guildId) {
  return get(
    `SELECT *
     FROM daily_interaction_config
     WHERE guildId = ?`,
    [guildId]
  );
}

function getInteractionTypes(guildId) {
  ensureDailyInteractionConfig(guildId);

  return all(
    `SELECT *
     FROM daily_interaction_types
     WHERE guildId = ?
     ORDER BY type ASC`,
    [guildId]
  );
}

function setDayTheme({ guildId, dayOfWeek, type }) {
  const normalizedType = String(type || '').toUpperCase();
  const day = Number(dayOfWeek);

  if (!Number.isInteger(day) || day < 0 || day > 6) {
    throw new Error('Choose a day from Sunday through Saturday.');
  }

  if (!interactionType(normalizedType)) {
    throw new Error('Invalid daily interaction type.');
  }

  ensureDailyInteractionConfig(guildId);
  return run(
    `INSERT INTO daily_interaction_day_themes (guildId, dayOfWeek, type)
     VALUES (?, ?, ?)
     ON CONFLICT(guildId, dayOfWeek)
     DO UPDATE SET type = excluded.type`,
    [guildId, day, normalizedType]
  );
}

function clearDayTheme(guildId, dayOfWeek) {
  return run(
    `DELETE FROM daily_interaction_day_themes
     WHERE guildId = ?
     AND dayOfWeek = ?`,
    [guildId, Number(dayOfWeek)]
  );
}

function listDayThemes(guildId) {
  return all(
    `SELECT *
     FROM daily_interaction_day_themes
     WHERE guildId = ?
     ORDER BY dayOfWeek ASC`,
    [guildId]
  );
}

function getDayTheme(guildId, dayOfWeek) {
  return get(
    `SELECT *
     FROM daily_interaction_day_themes
     WHERE guildId = ?
     AND dayOfWeek = ?`,
    [guildId, Number(dayOfWeek)]
  );
}

function updateDailyInteractionConfig(guildId, fields) {
  const allowed = new Set([
    'enabled',
    'channelId',
    'pingRoleId',
    'hour',
    'minute',
    'timezone',
    'titlePrefix',
    'color',
    'discussionEnabled',
    'lastDateKey',
    'updatedBy'
  ]);

  const entries = Object.entries(fields)
    .filter(([key]) => allowed.has(key));

  if (!entries.length) return { changes: 0 };

  const title = entries.find(([key]) => key === 'titlePrefix');
  if (title) {
    const validation = validateDailyInteractionContent({
      answer: title[1],
      censorTerms: listCensorTerms(guildId),
      maxLength: 120
    });

    if (!validation.valid) {
      throw new Error(`Daily interaction title rejected: ${validation.message}`);
    }

    title[1] = validation.answer;
  }

  ensureDailyInteractionConfig(guildId);

  const assignments = entries.map(([key]) => `${key} = ?`);
  const values = entries.map(([, value]) => value);

  assignments.push('updatedAt = ?');
  values.push(Date.now(), guildId);

  return run(
    `UPDATE daily_interaction_config
     SET ${assignments.join(', ')}
     WHERE guildId = ?`,
    values
  );
}

function updateInteractionType({ guildId, type, enabled, weight }) {
  const normalizedType = String(type || '').toUpperCase();
  if (!interactionType(normalizedType)) {
    throw new Error('Invalid daily interaction type.');
  }

  ensureDailyInteractionConfig(guildId);
  const assignments = [];
  const values = [];

  if (enabled !== undefined) {
    assignments.push('enabled = ?');
    values.push(enabled ? 1 : 0);
  }

  if (weight !== undefined) {
    assignments.push('weight = ?');
    values.push(Math.max(1, Math.min(10, Number(weight) || 1)));
  }

  if (!assignments.length) return { changes: 0 };

  values.push(guildId, normalizedType);

  return run(
    `UPDATE daily_interaction_types
     SET ${assignments.join(', ')}
     WHERE guildId = ?
     AND type = ?`,
    values
  );
}

function addCustomPrompt({ guildId, type, prompt, title, createdBy }) {
  const normalizedType = String(type || '').toUpperCase();
  if (!interactionType(normalizedType)) {
    throw new Error('Invalid daily interaction type.');
  }

  const validation = validateDailyInteractionPrompt({
    prompt,
    title,
    censorTerms: listCensorTerms(guildId)
  });

  if (!validation.valid) {
    throw new Error(validation.message);
  }

  return run(
    `INSERT INTO daily_interaction_prompts (
       guildId, type, prompt, title, createdBy, createdAt
     )
     VALUES (?, ?, ?, ?, ?, ?)`,
    [guildId, normalizedType, validation.prompt, validation.title, createdBy, Date.now()]
  ).lastInsertRowid;
}

function listCustomPrompts(guildId, type = null) {
  const normalizedType = type ? String(type).toUpperCase() : null;

  return normalizedType
    ? all(
      `SELECT *
       FROM daily_interaction_prompts
       WHERE guildId = ?
       AND type = ?
       ORDER BY id ASC`,
      [guildId, normalizedType]
    )
    : all(
      `SELECT *
       FROM daily_interaction_prompts
       WHERE guildId = ?
       ORDER BY type ASC, id ASC`,
      [guildId]
    );
}

function removeCustomPrompt(guildId, id) {
  return run(
    `DELETE FROM daily_interaction_prompts
     WHERE guildId = ?
     AND id = ?`,
    [guildId, id]
  );
}

function setCustomPromptEnabled({ guildId, id, enabled }) {
  return run(
    `UPDATE daily_interaction_prompts
     SET enabled = ?
     WHERE guildId = ?
     AND id = ?`,
    [enabled ? 1 : 0, guildId, id]
  );
}

function promptsForType(guildId, type) {
  const normalizedType = String(type).toUpperCase();
  const preset = interactionType(normalizedType);

  if (!preset) return [];

  const censorTerms = listCensorTerms(guildId);
  const safePrompt = prompt => validateDailyInteractionPrompt({
    prompt: prompt.prompt,
    title: prompt.title,
    censorTerms
  }).valid;

  const builtIn = preset.prompts.map((prompt, index) => ({
    key: `builtin:${normalizedType}:${index}`,
    type: normalizedType,
    prompt,
    title: null,
    source: 'built-in'
  })).filter(safePrompt);

  const custom = listCustomPrompts(guildId, normalizedType)
    .filter(row => Number(row.enabled) === 1)
    .map(row => ({
      key: `custom:${row.id}`,
      type: normalizedType,
      prompt: row.prompt,
      title: row.title,
      source: 'custom'
    }))
    .filter(safePrompt);

  return [...builtIn, ...custom];
}

function chooseWeightedType(types, random = Math.random) {
  const usable = types.filter(type => Number(type.enabled) === 1 && interactionType(type.type));
  const total = usable.reduce((sum, type) => sum + Math.max(1, Number(type.weight) || 1), 0);

  if (!total) return null;

  let selected = random() * total;
  for (const type of usable) {
    selected -= Math.max(1, Number(type.weight) || 1);
    if (selected < 0) return type.type;
  }

  return usable[usable.length - 1].type;
}

function choosePrompt({ guildId, type, now = Date.now(), random = Math.random }) {
  const prompts = promptsForType(guildId, type);
  if (!prompts.length) return null;

  const cutoff = now - DELIVERY_COOLDOWN_MS;
  run(
    `DELETE FROM daily_interaction_history
     WHERE guildId = ?
     AND deliveredAt < ?`,
    [guildId, cutoff]
  );

  const history = new Map(
    all(
      `SELECT promptKey, deliveredAt
       FROM daily_interaction_history
       WHERE guildId = ?`,
      [guildId]
    ).map(row => [row.promptKey, row.deliveredAt])
  );

  const eligible = prompts.filter(prompt => !history.has(prompt.key));
  if (eligible.length) {
    return eligible[Math.floor(random() * eligible.length)];
  }

  const oldest = [...prompts]
    .sort((left, right) => (history.get(left.key) || 0) - (history.get(right.key) || 0));

  return oldest[0] || null;
}

function chooseInteraction({ guildId, type = 'RANDOM', now = Date.now(), random = Math.random }) {
  const selectedType = String(type || 'RANDOM').toUpperCase() === 'RANDOM'
    ? chooseWeightedType(getInteractionTypes(guildId), random)
    : String(type).toUpperCase();

  if (!interactionType(selectedType)) return null;

  const prompt = choosePrompt({ guildId, type: selectedType, now, random });
  return prompt ? { ...prompt, type: selectedType } : null;
}

function savePromptDelivery(guildId, promptKey, deliveredAt) {
  return run(
    `INSERT INTO daily_interaction_history (guildId, promptKey, deliveredAt)
     VALUES (?, ?, ?)
     ON CONFLICT(guildId, promptKey)
     DO UPDATE SET deliveredAt = excluded.deliveredAt`,
    [guildId, promptKey, deliveredAt]
  );
}

function restorePromptDelivery(guildId, promptKey, previous) {
  if (previous?.deliveredAt) {
    return run(
      `UPDATE daily_interaction_history
       SET deliveredAt = ?
       WHERE guildId = ?
       AND promptKey = ?`,
      [previous.deliveredAt, guildId, promptKey]
    );
  }

  return run(
    `DELETE FROM daily_interaction_history
     WHERE guildId = ?
     AND promptKey = ?`,
    [guildId, promptKey]
  );
}

function buildInteractionEmbed(config, interaction, participants = 0) {
  const type = interactionType(interaction.type);
  const censorTerms = listCensorTerms(config.guildId);
  const titleValidation = validateDailyInteractionContent({
    answer: interaction.title || `${config.titlePrefix || 'Jabster Studios'} | ${type.label}`,
    censorTerms,
    maxLength: 240
  });
  const promptValidation = validateDailyInteractionContent({
    answer: interaction.prompt,
    censorTerms,
    maxLength: 600
  });
  const title = titleValidation.valid
    ? titleValidation.answer
    : `Jabster Studios | ${type.label}`;
  const description = promptValidation.valid
    ? promptValidation.answer
    : 'This interaction prompt is no longer available.';

  const embed = new EmbedBuilder()
    .setColor(Number(config.color) || 0x5865F2)
    .setTitle(`${type.emoji} ${title}`.slice(0, 256))
    .setDescription(description)
    .addFields(
      { name: 'Type', value: type.label, inline: true },
      { name: 'Participants', value: String(participants), inline: true },
      { name: 'How to Join', value: 'Click **Join In** to count, then use **Submit Answer** to share your response.' }
    )
    .setFooter({ text: `Jabster Studios Daily Interactions | ${interaction.source === 'custom' ? 'Community custom prompt' : 'Built-in prompt'}` })
    .setTimestamp();

  return embed;
}

function buildInteractionComponents({ discussionEnabled }) {
  const buttons = [
    new ButtonBuilder()
      .setCustomId('dailyinteraction_join')
      .setLabel('Join In')
      .setStyle(ButtonStyle.Success)
  ];

  if (discussionEnabled) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId('dailyinteraction_answer')
        .setLabel('Submit Answer')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('dailyinteraction_discuss')
        .setLabel('Open Discussion')
        .setStyle(ButtonStyle.Primary)
    );
  }

  return [new ActionRowBuilder().addComponents(buttons)];
}

async function getOrCreateDiscussionThread({ guild, message, post, openedBy }) {
  if (post.threadId) {
    const existingThread = await guild.channels.fetch(post.threadId).catch(() => null);
    if (existingThread) return existingThread;
  }

  const existingCreation = threadCreationLocks.get(post.messageId);
  if (existingCreation) return existingCreation;

  const creation = (async () => {
    const thread = await message.startThread({
      name: `Discuss ${post.type.replace(/_/g, ' ').toLowerCase()}`.slice(0, 100),
      autoArchiveDuration: 1440,
      reason: `Daily interaction discussion opened by ${openedBy || 'a community member'}`
    });

    run(
      `UPDATE daily_interaction_posts
       SET threadId = ?
       WHERE messageId = ?`,
      [thread.id, post.messageId]
    );

    return thread;
  })();

  threadCreationLocks.set(post.messageId, creation);

  try {
    return await creation;
  } finally {
    if (threadCreationLocks.get(post.messageId) === creation) {
      threadCreationLocks.delete(post.messageId);
    }
  }
}

function dayDifference(previousDateKey, currentDateKey) {
  if (!previousDateKey || !currentDateKey) return null;

  const previous = Date.parse(`${previousDateKey}T00:00:00.000Z`);
  const current = Date.parse(`${currentDateKey}T00:00:00.000Z`);
  if (!Number.isFinite(previous) || !Number.isFinite(current)) return null;
  return Math.round((current - previous) / DAY_MS);
}

function recordMemberEngagement({
  guildId,
  userId,
  dateKey,
  joined = false,
  responded = false,
  now = Date.now()
}) {
  if (!joined && !responded) return getMemberEngagementStats(guildId, userId);

  const current = getMemberEngagementStats(guildId, userId);
  if (!current) {
    const firstStreak = dateKey ? 1 : 0;
    run(
      `INSERT INTO daily_interaction_member_stats (
         guildId, userId, totalJoins, totalResponses, currentStreak,
         longestStreak, lastDateKey, lastParticipatedAt
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        guildId,
        userId,
        joined ? 1 : 0,
        responded ? 1 : 0,
        firstStreak,
        firstStreak,
        dateKey || null,
        now
      ]
    );
    return getMemberEngagementStats(guildId, userId);
  }

  let currentStreak = Number(current.currentStreak) || 0;
  let longestStreak = Number(current.longestStreak) || 0;
  let lastDateKey = current.lastDateKey;

  if (dateKey && lastDateKey !== dateKey) {
    currentStreak = dayDifference(lastDateKey, dateKey) === 1
      ? currentStreak + 1
      : 1;
    longestStreak = Math.max(longestStreak, currentStreak);
    lastDateKey = dateKey;
  }

  run(
    `UPDATE daily_interaction_member_stats
     SET totalJoins = totalJoins + ?,
         totalResponses = totalResponses + ?,
         currentStreak = ?,
         longestStreak = ?,
         lastDateKey = ?,
         lastParticipatedAt = ?
     WHERE guildId = ?
     AND userId = ?`,
    [
      joined ? 1 : 0,
      responded ? 1 : 0,
      currentStreak,
      longestStreak,
      lastDateKey,
      now,
      guildId,
      userId
    ]
  );

  return getMemberEngagementStats(guildId, userId);
}

function getMemberEngagementStats(guildId, userId) {
  return get(
    `SELECT *
     FROM daily_interaction_member_stats
     WHERE guildId = ?
     AND userId = ?`,
    [guildId, userId]
  );
}

function getEngagementLeaderboard(guildId, limit = 10) {
  return all(
    `SELECT *, (totalJoins + (totalResponses * 2)) AS score
     FROM daily_interaction_member_stats
     WHERE guildId = ?
     ORDER BY score DESC, longestStreak DESC, lastParticipatedAt DESC
     LIMIT ?`,
    [guildId, Math.max(1, Math.min(20, Number(limit) || 10))]
  );
}

function getDailyInteractionAnalytics(guildId, now = Date.now()) {
  const since = now - (30 * DAY_MS);
  const posts = get(
    `SELECT COUNT(*) AS count
     FROM daily_interaction_posts
     WHERE guildId = ?
     AND sentAt >= ?`,
    [guildId, since]
  ).count;
  const participants = get(
    `SELECT COUNT(DISTINCT participant.userId) AS count
     FROM daily_interaction_participants AS participant
     INNER JOIN daily_interaction_posts AS post
       ON post.messageId = participant.messageId
     WHERE post.guildId = ?
     AND post.sentAt >= ?`,
    [guildId, since]
  ).count;
  const responses = get(
    `SELECT COUNT(*) AS count
     FROM daily_interaction_responses AS response
     INNER JOIN daily_interaction_posts AS post
       ON post.messageId = response.messageId
     WHERE post.guildId = ?
     AND post.sentAt >= ?`,
    [guildId, since]
  ).count;
  const types = all(
    `SELECT type, COUNT(*) AS count
     FROM daily_interaction_posts
     WHERE guildId = ?
     AND sentAt >= ?
     GROUP BY type
     ORDER BY count DESC, type ASC`,
    [guildId, since]
  );

  return { posts, participants, responses, types, since };
}

async function sendDailyInteraction({
  client,
  config,
  type = 'RANDOM',
  now = Date.now(),
  random = Math.random,
  trackHistory = true
}) {
  if (!config?.channelId) return { status: 'missing-channel' };

  const channel = await client.channels.fetch(config.channelId).catch(() => null);
  if (!channel?.isTextBased()) return { status: 'missing-channel' };

  const permissions = channel.permissionsFor(channel.guild.members.me);
  if (!permissions?.has([
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.EmbedLinks
  ])) {
    return { status: 'missing-permissions' };
  }

  const picked = chooseInteraction({ guildId: config.guildId, type, now, random });
  if (!picked) return { status: 'no-prompts' };

  const previous = trackHistory
    ? get(
      `SELECT deliveredAt
       FROM daily_interaction_history
       WHERE guildId = ?
       AND promptKey = ?`,
      [config.guildId, picked.key]
    )
    : null;

  if (trackHistory) {
    savePromptDelivery(config.guildId, picked.key, now);
  }

  const discussionEnabled = Number(config.discussionEnabled) === 1 &&
    permissions.has([
      PermissionFlagsBits.CreatePublicThreads,
      PermissionFlagsBits.SendMessagesInThreads
    ]);

  try {
    const message = await channel.send({
      content: config.pingRoleId ? `<@&${config.pingRoleId}>` : undefined,
      embeds: [buildInteractionEmbed(config, picked)],
      components: buildInteractionComponents({ discussionEnabled }),
      allowedMentions: config.pingRoleId
        ? { roles: [config.pingRoleId], parse: [] }
        : { parse: [] }
    });

    run(
      `INSERT OR REPLACE INTO daily_interaction_posts (
         messageId, guildId, channelId, type, promptKey, prompt, title, sentAt
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        message.id,
        config.guildId,
        channel.id,
        picked.type,
        picked.key,
        picked.prompt,
        picked.title || null,
        now
      ]
    );

    await logAudit(client, config.guildId, {
      action: 'DAILY_INTERACTION_POSTED',
      executorId: client.user?.id,
      type: 'COMMANDS',
      metadata: {
        messageId: message.id,
        channelId: channel.id,
        interactionType: picked.type,
        promptKey: picked.key,
        scheduled: trackHistory
      },
      embed: createAuditEmbed({
        action: 'Daily Interaction Posted',
        executor: client.user ? `${client.user.tag}\n<@${client.user.id}>` : 'Bot',
        channel: `<#${channel.id}>`,
        extra: `${interactionType(picked.type).label}: ${picked.prompt}`,
        color: Number(config.color) || 0x5865F2
      })
    });

    return { status: 'sent', message, interaction: picked };
  } catch (err) {
    if (trackHistory) {
      restorePromptDelivery(config.guildId, picked.key, previous);
    }
    throw err;
  }
}

class DailyInteractionService {
  static interval = null;
  static tickPromise = null;

  static start(client) {
    if (DailyInteractionService.interval) return DailyInteractionService.interval;

    DailyInteractionService.tick(client)
      .catch(err => console.error('Daily interaction service error:', err));

    DailyInteractionService.interval = setInterval(() => {
      DailyInteractionService.tick(client)
        .catch(err => console.error('Daily interaction service error:', err));
    }, 60 * 1000);

    DailyInteractionService.interval.unref?.();
    return DailyInteractionService.interval;
  }

  static async sendNow(client, guildId, type = 'RANDOM') {
    const config = ensureDailyInteractionConfig(guildId);
    return sendDailyInteraction({ client, config, type });
  }

  static async test(client, guildId, type = 'RANDOM') {
    const config = ensureDailyInteractionConfig(guildId);
    return sendDailyInteraction({ client, config, type, trackHistory: false });
  }

  static async tick(client) {
    if (DailyInteractionService.tickPromise) {
      return DailyInteractionService.tickPromise;
    }

    const work = DailyInteractionService.runTick(client);
    DailyInteractionService.tickPromise = work;

    try {
      return await work;
    } finally {
      if (DailyInteractionService.tickPromise === work) {
        DailyInteractionService.tickPromise = null;
      }
    }
  }

  static async runTick(client) {
    const configs = all(
      `SELECT *
       FROM daily_interaction_config
       WHERE enabled = 1
       AND channelId IS NOT NULL
       AND channelId <> ''`
    );

    const now = new Date();

    for (const config of configs) {
      const local = getDateParts(now, config.timezone);
      const scheduleReached = local.hour > Number(config.hour) ||
        (local.hour === Number(config.hour) && local.minute >= Number(config.minute));

      if (!scheduleReached || config.lastDateKey === local.dateKey) {
        continue;
      }

      const claim = run(
        `UPDATE daily_interaction_config
         SET lastDateKey = ?
         WHERE guildId = ?
         AND enabled = 1
         AND (lastDateKey IS NULL OR lastDateKey <> ?)`,
        [local.dateKey, config.guildId, local.dateKey]
      );

      if (!claim.changes) continue;

      try {
        const theme = getDayTheme(config.guildId, local.dayOfWeek);
        const themedTypeEnabled = theme && getInteractionTypes(config.guildId)
          .some(type => type.type === theme.type && Number(type.enabled) === 1);
        const result = await sendDailyInteraction({
          client,
          config,
          type: themedTypeEnabled ? theme.type : 'RANDOM',
          now: now.getTime()
        });

        if (result.status !== 'sent') {
          run(
            `UPDATE daily_interaction_config
             SET lastDateKey = NULL
             WHERE guildId = ?
             AND lastDateKey = ?`,
            [config.guildId, local.dateKey]
          );
        }
      } catch (err) {
        run(
          `UPDATE daily_interaction_config
           SET lastDateKey = NULL
           WHERE guildId = ?
           AND lastDateKey = ?`,
          [config.guildId, local.dateKey]
        );
        console.error(`Daily interaction send failed for ${config.guildId}:`, err);
      }
    }
  }
}

module.exports = {
  DAILY_INTERACTION_TYPES: INTERACTION_TYPES,
  DAY_NAMES,
  DEFAULT_TIMEZONE,
  DailyInteractionService,
  addCustomPrompt,
  buildInteractionEmbed,
  chooseInteraction,
  clearDayTheme,
  getDailyInteractionAnalytics,
  getDailyInteractionConfig,
  getDateParts,
  getDayTheme,
  getEngagementLeaderboard,
  getMemberEngagementStats,
  getInteractionTypes,
  getOrCreateDiscussionThread,
  interactionType,
  listCustomPrompts,
  listInteractionTypes,
  removeCustomPrompt,
  recordMemberEngagement,
  sendDailyInteraction,
  setDayTheme,
  setCustomPromptEnabled,
  listDayThemes,
  updateDailyInteractionConfig,
  updateInteractionType,
  validTimezone
};

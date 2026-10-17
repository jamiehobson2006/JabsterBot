const {
  all,
  run
} = require('../database');
const { startManagedLoop } = require('../utils/serviceRunner');
const { PermissionFlagsBits } = require('discord.js');
const { attemptDailyDelivery, dailyMetadata, getDailyDelivery, newDailyKey,
  pendingDailyKeys, queueDailyDelivery, recoverDailyDeliveries } = require('../utils/dailyDelivery');

const {
  categoryName,
  getFactsForCategory,
  normalizeFact
} = require('../utils/dailyFacts');

const DAY_MS =
  24 * 60 * 60 * 1000;

const DELIVERY_COOLDOWN_MS =
  30 * DAY_MS;

const DEFAULT_TIMEZONE =
  'Europe/London';

const COMMUNITY_PICK_CHANCE =
  0.6;

function validTimezone(timezone) {

  try {

    Intl.DateTimeFormat(
      'en-GB',
      { timeZone: timezone }
    );

    return true;

  } catch {

    return false;
  }
}

function getTimezone(config) {

  return validTimezone(config?.timezone)
    ? config.timezone
    : DEFAULT_TIMEZONE;
}

function getDateParts(
  date,
  timezone = DEFAULT_TIMEZONE
) {

  const parts =
    new Intl.DateTimeFormat(
      'en-GB',
      {
        timeZone: timezone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      }
    )
      .formatToParts(date)
      .reduce((result, part) => {

        if (part.type !== 'literal') {
          result[part.type] = part.value;
        }

        return result;
      }, {});

  return {
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    dateKey: `${parts.year}-${parts.month}-${parts.day}`
  };
}

function factKey(fact) {

  return fact.factKey ||
    `${fact.source || 'coded'}:${normalizeFact(fact.fact)}`;
}

function pickFact(
  facts,
  random = Math.random
) {

  const communityFacts =
    facts.filter(fact => fact.source === 'community');

  const codedFacts =
    facts.filter(fact => fact.source !== 'community');

  const pool =
    communityFacts.length && codedFacts.length &&
    random() < COMMUNITY_PICK_CHANCE
      ? communityFacts
      : communityFacts.length && !codedFacts.length
        ? communityFacts
        : codedFacts.length
          ? codedFacts
          : communityFacts;

  if (!pool.length) {

    return null;
  }

  return pool[
    Math.floor(random() * pool.length)
  ];
}

function eligibleFacts({
  guildId,
  category = 'random',
  onlyCommunity = false,
  now = Date.now()
}) {

  const cutoff =
    now - DELIVERY_COOLDOWN_MS;

  run(
    `DELETE FROM dailyfact_delivery_history
     WHERE deliveredAt <= ?`,
    [cutoff]
  );

  const recentlyDelivered =
    new Set(
      all(
        `SELECT factKey
         FROM dailyfact_delivery_history
         WHERE guildId = ?
         AND deliveredAt > ?`,
        [guildId, cutoff]
      ).map(row => row.factKey)
    );

  const pending = pendingDailyKeys(guildId, 'DAILY_FACT_POST');
  return getFactsForCategory(category)
    .filter(fact =>
      !onlyCommunity || fact.source === 'community'
    )
    .filter(fact => !pending.has(factKey(fact)))
    .filter(fact => ![factKey(fact), ...(fact.legacyFactKeys || [])]
      .some(key => recentlyDelivered.has(key)));
}

function dailyFactEmbed(fact) {

  return {
    color: 0x5865F2,
    title: 'Daily Fact',
    description: fact.fact,
    fields: [
      ...require('../utils/factSources').sourceFields(fact),
      ...(fact.id ? [{ name: 'Library ID', value: String(fact.id), inline: true }] : []),
      {
        name: 'Category',
        value: fact.category === 'random'
          ? 'Random / All Facts'
          : categoryName(fact.category),
        inline: true
      },
      {
        name: 'Source',
        value: fact.source === 'community'
          ? 'Community approved'
          : 'Jabster Studios facts',
        inline: true
      }
    ],
    footer: {
      text: 'Jabster Studios Daily Facts'
    },
    timestamp: new Date()
  };
}

async function sendFact({
  client,
  config,
  category = config.category || 'random',
  onlyCommunity = false,
  now = Date.now(),
  random = Math.random,
  deliveryKey = newDailyKey('daily-fact'),
  dateKey = null
}) {
  const existing = getDailyDelivery(deliveryKey);
  if (existing && existing.status !== 'CANCELLED') {
    const delivery = await attemptDailyDelivery(client, existing);
    if (delivery?.status !== 'CANCELLED') return { status: delivery?.status === 'SENT' ? 'sent' : 'pending',
      fact: dailyMetadata(existing).selection };
  }

  const channel =
    await client.channels.fetch(
      config.channelId
    ).catch(() => null);

  if (!channel || !channel.isTextBased()) {

    return {
      status: 'missing-channel'
    };
  }
  if (channel.guild?.id && channel.guild.id !== config.guildId) return { status: 'missing-channel' };
  const permissions = channel.permissionsFor?.(channel.guild?.members.me);
  if (permissions && !permissions.has([PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
    return { status: 'missing-permissions' };
  }

  const facts =
    eligibleFacts({
      guildId: config.guildId,
      category,
      onlyCommunity,
      now
    });

  const picked =
    pickFact(facts, random);

  if (!picked) {

    return {
      status: 'no-eligible-facts'
    };
  }

  const queued = queueDailyDelivery({
    deliveryKey, type: 'DAILY_FACT_POST', guildId: config.guildId, channelId: config.channelId,
    metadata: { contentKey: factKey(picked), selection: picked, dateKey },
    message: {
      embeds: [dailyFactEmbed(picked)],
      allowedMentions: {
        parse: []
      }
    }
  });
  const delivery = await attemptDailyDelivery(client, queued);
  return { status: delivery?.status === 'SENT' ? 'sent' : 'pending', fact: dailyMetadata(queued).selection };
}

class DailyFactService {

  static interval =
    null;

  static start(client) {

    if (DailyFactService.interval) {

      console.log(
        'Daily Fact Service already running'
      );

      return;
    }

    console.log(
      'Daily Fact Service Started'
    );

    DailyFactService.interval = startManagedLoop(
      'daily-facts', () => DailyFactService.tick(client), 60_000, { timeoutMs: 60_000 }
    );
  }

  static async forceCommunityFact(
    client,
    guildId
  ) {

    const config =
      all(
        `SELECT *
         FROM dailyfact_config
         WHERE guildId = ?`,
        [guildId]
      )[0];

    if (!config?.channelId) {

      return {
        status: 'missing-channel'
      };
    }

    return sendFact({
      client,
      config,
      category: 'random',
      onlyCommunity: true
    });
  }

  static async tick(client) {
    require('../utils/dailyFactReview').queueMissingFactReviews();
    await recoverDailyDeliveries(client, ['DAILY_FACT_POST', 'DAILY_FACT_REVIEW',
      'DAILY_FACT_DM', 'DAILY_FACT_REVIEW_UPDATE']);

    const configs =
      all(
        `SELECT *
         FROM dailyfact_config
         WHERE enabled = 1`
      );

    const now =
      new Date();

    for (const config of configs) {

      const timezone =
        getTimezone(config);

      const localTime =
        getDateParts(now, timezone);

      const scheduledHour =
        Number(config.hour ?? 12);

      const scheduledMinute =
        Number(config.minute ?? 0);

      const scheduleReached =
        localTime.hour > scheduledHour ||
        (
          localTime.hour === scheduledHour &&
          localTime.minute >= scheduledMinute
        );

      if (
        config.lastSent === localTime.dateKey ||
        !scheduleReached ||
        Number(config.nextAttemptAt || 0) > now.getTime()
      ) {

        continue;
      }

      try {

        const result =
          await sendFact({
            client,
            config,
            now: now.getTime(),
            deliveryKey: `daily-fact:${config.guildId}:${localTime.dateKey}`,
            dateKey: localTime.dateKey
          });

        if (result.status !== 'sent') {
          const retryDelay = result.status === 'no-eligible-facts'
            ? 6 * 60 * 60 * 1000
            : result.status === 'missing-channel'
              ? 24 * 60 * 60 * 1000
              : 60 * 60 * 1000;

          run(
            `UPDATE dailyfact_config
             SET lastSent = NULL,
                 nextAttemptAt = ?,
                 lastDeliveryError = ?
             WHERE guildId = ?`,
            [
              Date.now() + retryDelay,
              result.status,
              config.guildId
            ]
          );
        } else {
          run(
            `UPDATE dailyfact_config
             SET nextAttemptAt = NULL,
                 lastDeliveryError = NULL
             WHERE guildId = ?`,
            [config.guildId]
          );
        }

      } catch (err) {

        run(
          `UPDATE dailyfact_config
           SET lastSent = NULL,
               nextAttemptAt = ?,
               lastDeliveryError = ?
           WHERE guildId = ?`,
          [
            Date.now() + (15 * 60 * 1000),
            String(err?.message || err || 'delivery-error').slice(0, 500),
            config.guildId
          ]
        );

        console.error(
          `Daily Fact delivery failed for guild ${config.guildId}:`,
          err
        );
      }
    }
  }
}

module.exports =
  DailyFactService;

module.exports.DAY_MS =
  DAY_MS;

module.exports.DELIVERY_COOLDOWN_MS =
  DELIVERY_COOLDOWN_MS;

module.exports.DEFAULT_TIMEZONE =
  DEFAULT_TIMEZONE;

module.exports.COMMUNITY_PICK_CHANCE =
  COMMUNITY_PICK_CHANCE;

module.exports.getDateParts =
  getDateParts;

module.exports.pickFact =
  pickFact;

module.exports.eligibleFacts =
  eligibleFacts;

module.exports.sendFact =
  sendFact;

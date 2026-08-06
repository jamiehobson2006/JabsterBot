const {
  all,
  run
} = require('../database');

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
     WHERE deliveredAt < ?`,
    [cutoff]
  );

  const recentlyDelivered =
    new Set(
      all(
        `SELECT factKey
         FROM dailyfact_delivery_history
         WHERE guildId = ?
         AND deliveredAt >= ?`,
        [guildId, cutoff]
      ).map(row => row.factKey)
    );

  return getFactsForCategory(category)
    .filter(fact =>
      !onlyCommunity || fact.source === 'community'
    )
    .filter(fact => !recentlyDelivered.has(factKey(fact)));
}

function dailyFactEmbed(fact) {

  return {
    color: 0x5865F2,
    title: 'Daily Fact',
    description: fact.fact,
    fields: [
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
  random = Math.random
}) {

  const channel =
    await client.channels.fetch(
      config.channelId
    ).catch(() => null);

  if (!channel || !channel.isTextBased()) {

    return {
      status: 'missing-channel'
    };
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

  const deliveredAt =
    now;

  const claim =
    run(
      `INSERT OR IGNORE INTO dailyfact_delivery_history (
         guildId,
         factKey,
         deliveredAt
       )
       VALUES (?, ?, ?)`,
      [
        config.guildId,
        factKey(picked),
        deliveredAt
      ]
    );

  if (!claim.changes) {

    return {
      status: 'already-delivered'
    };
  }

  try {

    await channel.send({
      embeds: [dailyFactEmbed(picked)],
      allowedMentions: {
        parse: []
      }
    });

    return {
      status: 'sent',
      fact: picked
    };

  } catch (err) {

    run(
      `DELETE FROM dailyfact_delivery_history
       WHERE guildId = ?
       AND factKey = ?
       AND deliveredAt = ?`,
      [
        config.guildId,
        factKey(picked),
        deliveredAt
      ]
    );

    throw err;
  }
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

    DailyFactService.tick(client)
      .catch(err => {

        console.error(
          'Daily Fact Service Error:',
          err
        );
      });

    DailyFactService.interval =
      setInterval(
        () => {

          DailyFactService.tick(client)
            .catch(err => {

              console.error(
                'Daily Fact Service Error:',
                err
              );
            });
        },
        60000
      );

    DailyFactService.interval.unref?.();
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
        !scheduleReached
      ) {

        continue;
      }

      // Claim today's scheduled send before Discord is contacted. A process
      // restart therefore cannot send a second scheduled Daily Fact.
      const claim =
        run(
          `UPDATE dailyfact_config
           SET lastSent = ?
           WHERE guildId = ?
           AND COALESCE(lastSent, '') != ?`,
          [
            localTime.dateKey,
            config.guildId,
            localTime.dateKey
          ]
        );

      if (!claim.changes) {

        continue;
      }

      try {

        const result =
          await sendFact({
            client,
            config,
            now: now.getTime()
          });

        if (result.status !== 'sent') {

          run(
            `UPDATE dailyfact_config
             SET lastSent = NULL
             WHERE guildId = ?
             AND lastSent = ?`,
            [
              config.guildId,
              localTime.dateKey
            ]
          );
        }

      } catch (err) {

        run(
          `UPDATE dailyfact_config
           SET lastSent = NULL
           WHERE guildId = ?
           AND lastSent = ?`,
          [
            config.guildId,
            localTime.dateKey
          ]
        );

        throw err;
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

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

const {
  all,
  run,
  get
} = require('../database');

const {
  getLatestUpload,
  getVideoDetails,
  getUploadType
} = require('./youtube');

const {
  getStream
} = require('./twitch');

const CHECK_INTERVAL =
  5 * 60 * 1000;

let monitorInterval =
  null;

let monitorStartTimeout =
  null;

let monitorRun =
  null;

function feedColor(feed, fallback) {
  const color = Number(feed.embedColor);
  return Number.isInteger(color) && color >= 0 && color <= 0xFFFFFF
    ? color
    : fallback;
}

function isQuietHours(feed, now = new Date()) {
  if (feed.quietStartHour === null || feed.quietStartHour === undefined ||
      feed.quietEndHour === null || feed.quietEndHour === undefined) {
    return false;
  }

  const start = Number(feed.quietStartHour);
  const end = Number(feed.quietEndHour);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start === end) return false;

  try {
    const hour = Number(new Intl.DateTimeFormat('en-GB', {
      timeZone: feed.timezone || 'Europe/London',
      hour: '2-digit',
      hourCycle: 'h23'
    }).format(now));

    return start < end
      ? hour >= start && hour < end
      : hour >= start || hour < end;
  } catch {
    return false;
  }
}

function renderTemplate(template, values) {
  if (!template) return null;

  return String(template)
    .replace(/\{(creator|title|url|type)\}/gi, (_, key) => values[key.toLowerCase()] || '')
    .replace(/@everyone|@here/g, '[mention removed]')
    .trim()
    .slice(0, 1800) || null;
}

function socialAllowedMentions(feed) {
  return feed.pingRoleId
    ? { roles: [feed.pingRoleId], parse: [] }
    : { parse: [] };
}

// ====================================
// MESSAGES
// ====================================

const SHORT_MESSAGES = [

  "Surely you've got 30 seconds spare?",

  "Just one short won't hurt.",

  "Quick break time?",

  "You know you want to watch it.",

  "This'll only take a minute."
];

const VIDEO_MESSAGES = [

  "Fresh upload just dropped.",

  "Perfect timing for a new video.",

  "Looks like there's something new to watch.",

  "Grab a drink and enjoy.",

  "The wait is over."
];

async function checkEndedStreams(client) {

  const socials = all(

    `SELECT *
     FROM social_channels
     WHERE platform = 'youtube'
     AND lastLiveVideoId IS NOT NULL`
  );

  for (const social of socials) {

    try {

      const details =
        await getVideoDetails(
          social.lastLiveVideoId
        );

      if (!details) {
        continue;
      }

if (details.live) {

  if (
    details.viewers >
    (social.peakLiveViewers || 0)
  ) {

    run(

      `UPDATE social_channels

       SET peakLiveViewers = ?

       WHERE guildId = ?
       AND platform = ?
       AND creatorId = ?
       AND contentType = ?`,

      [

        details.viewers,

        social.guildId,

        social.platform,

        social.creatorId,

        social.contentType
      ]
    );
  }

  continue;
}

      const channel =
        await client.channels.fetch(
          social.lastLiveChannelId || social.targetChannelId
        ).catch(() => null);

      if (!channel) {
        continue;
      }

      const message =
        await channel.messages.fetch(
          social.lastLiveMessageId
        );

      if (!message) {
        continue;
      }

      let durationText =
        'Unknown';

      if (
        social.streamStartTime &&
        details.actualEndTime
      ) {

        const start =
          new Date(
            social.streamStartTime
          );

        const end =
          new Date(
            details.actualEndTime
          );

        const diff =
          Math.floor(
            (end - start) / 1000
          );

        const hours =
          Math.floor(
            diff / 3600
          );

        const minutes =
          Math.floor(
            (diff % 3600) / 60
          );

        durationText =
          `${hours}h ${minutes}m`;
      }

      const endedEmbed =
        new EmbedBuilder()

          .setColor(feedColor(social, 0x2F3136))

          .setAuthor({

            name:
              social.creatorName
          })

          .setTitle(
            '⚫ STREAM ENDED'
          )

          .setDescription(

            `**${details.title}**\n\n` +

            'Thanks for watching!'
          )

          .addFields(

            {
              name:
                '👥 Peak Viewers',

              value:
                (
                  social.peakLiveViewers || 0
                ).toLocaleString(),

              inline: true
            },

            {
              name:
                '⏱ Duration',

              value:
                durationText,

              inline: true
            }
          )

          .setThumbnail(
            details.thumbnail
          )

          .setImage(
            details.thumbnail
          )

          .setTimestamp();

      await message.edit({

        embeds: [endedEmbed]
      });

      run(

        `UPDATE social_channels

         SET lastLiveVideoId = NULL,
             lastLiveMessageId = NULL,
             lastLiveChannelId = NULL,
             peakLiveViewers = 0,
             streamStartTime = NULL

         WHERE guildId = ?
         AND platform = ?
         AND creatorId = ?
         AND contentType = ?`,

        [

          social.guildId,

          social.platform,

          social.creatorId,

          social.contentType
        ]
      );

      console.log(

        `⚫ Stream Ended: ${social.creatorName}`
      );

    } catch (err) {

      console.error(

        `Ended Stream Check Error (${social.creatorName})`,

        err
      );
    }
  }
}

async function checkEndedTwitchStreams(client) {

  const socials = all(

    `SELECT *
     FROM social_channels
     WHERE platform = 'twitch'
     AND contentType IN ('all', 'streams')
     AND lastTwitchStreamId IS NOT NULL
     AND lastLiveMessageId IS NOT NULL`
  );

  for (const social of socials) {

    try {

      const stream =
        await getStream(
          social.creatorId
        );

      // Still live
      if (stream) {

        if (
          stream.viewer_count >
          (social.peakTwitchViewers || 0)
        ) {

          run(

            `UPDATE social_channels

             SET peakTwitchViewers = ?

             WHERE guildId = ?
             AND platform = ?
             AND creatorId = ?
             AND contentType = ?`,

            [

              stream.viewer_count,

              social.guildId,

              social.platform,

              social.creatorId,

              social.contentType
            ]
          );
        }

        continue;
      }

      const channel =
        await client.channels.fetch(
          social.lastLiveChannelId || social.targetChannelId
        ).catch(() => null);

      if (!channel) {
        continue;
      }

      const message =
        await channel.messages.fetch(
          social.lastLiveMessageId
        );

      if (!message) {
        continue;
      }

      let durationText =
        'Unknown';

      if (social.twitchStartTime) {

        const start =
          new Date(
            social.twitchStartTime
          );

        const end =
          new Date();

        const diff =
          Math.floor(
            (end - start) / 1000
          );

        const hours =
          Math.floor(
            diff / 3600
          );

        const minutes =
          Math.floor(
            (diff % 3600) / 60
          );

        durationText =
          `${hours}h ${minutes}m`;
      }

      const endedEmbed =
        new EmbedBuilder()

          .setColor(feedColor(social, 0x2F3136))

          .setAuthor({

            name:
              social.creatorName
          })

          .setTitle(
            '⚫ STREAM ENDED'
          )

          .setDescription(
            'Thanks for watching!'
          )

          .addFields(

            {
              name:
                '👥 Peak Viewers',

              value:
                (
                  social.peakTwitchViewers || 0
                ).toLocaleString(),

              inline: true
            },

            {
              name:
                '⏱ Duration',

              value:
                durationText,

              inline: true
            }
          )

          .setTimestamp();

      await message.edit({

        embeds: [endedEmbed],

        components: []
      });

      run(

        `UPDATE social_channels

         SET lastTwitchStreamId = NULL,
             lastLiveMessageId = NULL,
             lastLiveChannelId = NULL,
             peakTwitchViewers = 0,
             twitchStartTime = NULL

         WHERE guildId = ?
         AND platform = ?
         AND creatorId = ?
         AND contentType = ?`,

        [

          social.guildId,

          social.platform,

          social.creatorId,

          social.contentType
        ]
      );

      console.log(
        `⚫ Twitch Ended: ${social.creatorName}`
      );

    } catch (err) {

      console.error(

        `Twitch Ended Error (${social.creatorName})`,

        err
      );
    }
  }
}

async function checkTwitch(client) {

  const socials = all(

    `SELECT *
     FROM social_channels
     WHERE platform = 'twitch'
     AND contentType IN ('all', 'streams')`
  );

  for (const social of socials) {

    try {

const stream =
  await getStream(
    social.creatorId
  );

if (!stream) {

  // Let the end-state pass edit the original live message first. Clearing this
  // here would make a temporary Discord API failure leave the announcement
  // looking live forever.
  if (social.lastTwitchStreamId && social.lastLiveMessageId) {
    continue;
  }

  if (social.lastTwitchStreamId) {

    run(

      `UPDATE social_channels

       SET lastTwitchStreamId = NULL,
           lastLiveMessageId = NULL,
           lastLiveChannelId = NULL,
           peakTwitchViewers = 0,
           twitchStartTime = NULL

       WHERE guildId = ?
       AND platform = ?
       AND creatorId = ?
       AND contentType = ?`,

      [

        social.guildId,

        social.platform,

        social.creatorId,

        social.contentType
      ]
    );
  }

  continue;
}

if (
  social.lastTwitchStreamId ===
  stream.id
) {

  continue;
}

      const channel =
        await client.channels.fetch(
          social.targetChannelId
        ).catch(() => null);

      if (!channel) {
        continue;
      }

      const embed =
        new EmbedBuilder()

          .setColor(feedColor(social, 0x9146FF))

          .setTitle(
            '🟣 LIVE ON TWITCH'
          )

          .setAuthor({

            name:
              social.creatorName
          })

          .setDescription(

            `**${stream.title}**`
          )

          .addFields(

            {
              name:
                '🎮 Category',

              value:
                stream.game_name ||
                'Unknown',

              inline: true
            },

            {
              name:
                '👥 Viewers',

              value:
                stream.viewer_count
                  .toLocaleString(),

              inline: true
            }
          )

          .setImage(

            stream.thumbnail_url

              .replace(
                '{width}',
                '1280'
              )

              .replace(
                '{height}',
                '720'
              )
          )

          .setTimestamp();

      const ping =
        social.pingRoleId
          ? `<@&${social.pingRoleId}>`
          : '';

      const watchButton =
        new ButtonBuilder()

          .setLabel(
            'Watch Stream'
          )

          .setStyle(
            ButtonStyle.Link
          )

          .setURL(

            `https://twitch.tv/${stream.user_login}`
          );

      const row =
        new ActionRowBuilder()

          .addComponents(
            watchButton
          );

if (isQuietHours(social)) {
  run(
    `UPDATE social_channels
     SET lastTwitchStreamId = ?
     WHERE guildId = ? AND platform = ? AND creatorId = ? AND contentType = ?`,
    [stream.id, social.guildId, social.platform, social.creatorId, social.contentType]
  );
  continue;
}

const message =
  await channel.send({

    content: [ping, renderTemplate(social.messageTemplate, {
      creator: social.creatorName,
      title: stream.title,
      url: `https://twitch.tv/${stream.user_login}`,
      type: 'stream'
    })].filter(Boolean).join('\n'),

    embeds: [embed],

    components: [row],

    allowedMentions: socialAllowedMentions(social)
  });

run(

  `UPDATE social_channels

   SET lastTwitchStreamId = ?,
       lastLiveMessageId = ?,
       lastLiveChannelId = ?,
       peakTwitchViewers = ?,
       twitchStartTime = ?

   WHERE guildId = ?
   AND platform = ?
   AND creatorId = ?
   AND contentType = ?`,

  [

    stream.id,

    message.id,

    channel.id,

    stream.viewer_count,

    stream.started_at,

    social.guildId,

    social.platform,

    social.creatorId,

    social.contentType
  ]
);

console.log(

  `🟣 Twitch Live: ${social.creatorName}`
);

    } catch (err) {

      console.error(

        `Twitch Monitor Error (${social.creatorName})`,

        err
      );
    }
  }
}

async function checkYouTube(client) {

  const socials = all(

    `SELECT *
     FROM social_channels
     WHERE platform = 'youtube'`
  );

  for (const social of socials) {

    try {

      const latestUpload =
        await getLatestUpload(
          social.creatorId
        );

      if (!latestUpload) {
        continue;
      }

      // ====================================
      // FIRST RUN PROTECTION
      // ====================================

      if (!social.initialized) {

        run(

          `UPDATE social_channels

           SET lastItemId = ?,
               initialized = 1

           WHERE guildId = ?
           AND platform = ?
           AND creatorId = ?
           AND contentType = ?`,

          [

            latestUpload.videoId,

            social.guildId,

            social.platform,

            social.creatorId,

            social.contentType
          ]
        );

        console.log(
          `📺 Initialized ${social.creatorName}`
        );

        continue;
      }

      // ====================================
      // DUPLICATE PROTECTION
      // ====================================

      if (
        social.lastItemId ===
        latestUpload.videoId
      ) {

        continue;
      }

      const uploadType =
        await getUploadType(
          latestUpload.videoId
        );

      let matches = false;

      switch (
        social.contentType
      ) {

        case 'all':
          matches = true;
          break;

        case 'videos':
          matches =
            uploadType === 'video';
          break;

        case 'shorts':
          matches =
            uploadType === 'short';
          break;

        case 'streams':
          matches =
            uploadType === 'stream';
          break;
      }

      if (!matches) {

        run(

          `UPDATE social_channels

           SET lastItemId = ?

           WHERE guildId = ?
           AND platform = ?
           AND creatorId = ?
           AND contentType = ?`,

          [

            latestUpload.videoId,

            social.guildId,

            social.platform,

            social.creatorId,

            social.contentType
          ]
        );

        continue;
      }

      const details =
        await getVideoDetails(
          latestUpload.videoId
        );

      const channel =
        await client.channels.fetch(
          social.targetChannelId
        ).catch(() => null);

      if (!channel) {
        continue;
      }

      let title =
        '📺 New Video Uploaded';

      let subtitle =
        VIDEO_MESSAGES[
          Math.floor(
            Math.random() *
            VIDEO_MESSAGES.length
          )
        ];

      if (
        uploadType === 'short'
      ) {

        title =
          '📱 New Short Posted';

        subtitle =
          SHORT_MESSAGES[
            Math.floor(
              Math.random() *
              SHORT_MESSAGES.length
            )
          ];
      }

      if (
        uploadType === 'stream'
      ) {

        title =
          '🔴 LIVE NOW';

        subtitle =
          `${social.creatorName} has gone live!`;
      }

      const embed =
        new EmbedBuilder()

          .setColor(feedColor(
            social,
            uploadType === 'stream' ? 0xFF0000 : 0x5865F2
          ))

          .setAuthor({

            name:
              social.creatorName
          })

          .setTitle(title)

          .setDescription(

            `${subtitle}\n\n` +

            `**${details.title}**`
          )

          .setURL(
            `https://youtube.com/watch?v=${latestUpload.videoId}`
          )

          .setThumbnail(
            details.thumbnail
          )

          .setImage(
            details.thumbnail
          );

      if (uploadType === 'stream') {

        embed.addFields(

          {
            name: '👥 Watching Now',
            value:
              details.viewers > 0
                ? details.viewers.toLocaleString()
                : 'Unknown',
            inline: true
          },

          {
            name: 'Status',
            value:
              '🔴 LIVE',
            inline: true
          }
        );

      } else {

        embed.addFields(

          {
            name: 'Views',
            value:
              details.views.toLocaleString(),
            inline: true
          },

          {
            name: 'Type',
            value:
              uploadType === 'short'
                ? '📱 Short'
                : '📺 Video',
            inline: true
          }
        );
      }

      embed.setTimestamp();

      const ping =
        social.pingRoleId
          ? `<@&${social.pingRoleId}>`
          : '';

const watchButton =
  new ButtonBuilder()

    .setLabel(

      uploadType === 'stream'
        ? 'Watch Live'
        : 'Watch Video'
    )

    .setStyle(
      ButtonStyle.Link
    )

    .setURL(
      `https://youtube.com/watch?v=${latestUpload.videoId}`
    );

const row =
  new ActionRowBuilder()

    .addComponents(
      watchButton
    );

if (isQuietHours(social)) {
  run(
    `UPDATE social_channels
     SET lastItemId = ?
     WHERE guildId = ? AND platform = ? AND creatorId = ? AND contentType = ?`,
    [latestUpload.videoId, social.guildId, social.platform, social.creatorId, social.contentType]
  );
  continue;
}

const message =
  await channel.send({

    content: [ping, renderTemplate(social.messageTemplate, {
      creator: social.creatorName,
      title: details.title,
      url: `https://youtube.com/watch?v=${latestUpload.videoId}`,
      type: uploadType
    })].filter(Boolean).join('\n'),

    embeds: [embed],

    components: [row],

    allowedMentions: socialAllowedMentions(social)
  });

if (uploadType === 'stream') {

  run(

    `UPDATE social_channels

SET lastLiveVideoId = ?,
    lastLiveMessageId = ?,
    lastLiveChannelId = ?,
    peakLiveViewers = ?,
    streamStartTime = ?

     WHERE guildId = ?
     AND platform = ?
     AND creatorId = ?
     AND contentType = ?`,

    [

      latestUpload.videoId,

      message.id,

      channel.id,

      details.viewers,

      details.actualStartTime,

      social.guildId,

      social.platform,

      social.creatorId,

      social.contentType
    ]
  );
}

run(

  `UPDATE social_channels

   SET lastItemId = ?,
       lastMessageId = ?

   WHERE guildId = ?
   AND platform = ?
   AND creatorId = ?
   AND contentType = ?`,

  [

    latestUpload.videoId,

    message.id,

    social.guildId,

    social.platform,

    social.creatorId,

    social.contentType
  ]
);

      console.log(
        `📢 Posted upload from ${social.creatorName}`
      );

    } catch (err) {

      console.error(
        `Social Monitor Error (${social.creatorName})`,
        err
      );
    }
  }
}

async function runMonitor(client) {
  if (monitorRun) return monitorRun;

  monitorRun = (async () => {
    try {
      // These share state, so run them in order rather than allowing a stream
      // to be marked ended while its live-state update is still in flight.
      await checkEndedStreams(client);
      await checkEndedTwitchStreams(client);
      await checkYouTube(client);
      await checkTwitch(client);
    } finally {
      monitorRun = null;
    }
  })();

  return monitorRun;
}

function start(client) {

  if (
    monitorInterval ||
    monitorStartTimeout
  ) {

    console.log(
      'Social Monitor already running'
    );

    return monitorInterval ||
      monitorStartTimeout;
  }

  console.log(
    '📱 Social Monitor Started'
  );

  monitorStartTimeout =
    setTimeout(() => {

runMonitor(client).catch(err => console.error('Social monitor cycle error:', err));

monitorStartTimeout = null;

monitorInterval =
  setInterval(() => {

runMonitor(client).catch(err => console.error('Social monitor cycle error:', err));

}, CHECK_INTERVAL);

monitorInterval.unref?.();

  }, 15000);

  monitorStartTimeout.unref?.();

  return monitorStartTimeout;
}

module.exports = {
  start,
  runMonitor
};

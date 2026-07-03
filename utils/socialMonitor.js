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
          social.targetChannelId
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

          .setColor(
            0x2F3136
          )

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
     AND lastTwitchStreamId IS NOT NULL`
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
          social.targetChannelId
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

          .setColor(
            0x2F3136
          )

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

  if (social.lastTwitchStreamId) {

    run(

      `UPDATE social_channels

       SET lastTwitchStreamId = NULL

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

          .setColor(0x9146FF)

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

const message =
  await channel.send({

    content: ping,

    embeds: [embed],

    components: [row]
  });

run(

  `UPDATE social_channels

   SET lastTwitchStreamId = ?,
       lastLiveMessageId = ?,
       peakTwitchViewers = ?,
       twitchStartTime = ?

   WHERE guildId = ?
   AND platform = ?
   AND creatorId = ?
   AND contentType = ?`,

  [

    stream.id,

    message.id,

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

          .setColor(
            uploadType === 'stream'
              ? 0xFF0000
              : 0x5865F2
          )

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

const message =
  await channel.send({

    content: ping,

    embeds: [embed],

    components: [row]
  });

if (uploadType === 'stream') {

  run(

    `UPDATE social_channels

SET lastLiveVideoId = ?,
    lastLiveMessageId = ?,
    peakLiveViewers = ?,
    streamStartTime = ?

     WHERE guildId = ?
     AND platform = ?
     AND creatorId = ?
     AND contentType = ?`,

    [

      latestUpload.videoId,

      message.id,

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

checkEndedStreams(client);
checkEndedTwitchStreams(client);
checkYouTube(client);
checkTwitch(client);

monitorStartTimeout = null;

monitorInterval =
  setInterval(() => {

checkEndedStreams(client);
checkEndedTwitchStreams(client);
checkYouTube(client);
checkTwitch(client);

}, CHECK_INTERVAL);

monitorInterval.unref?.();

  }, 15000);

  monitorStartTimeout.unref?.();

  return monitorStartTimeout;
}

module.exports = {
  start
};

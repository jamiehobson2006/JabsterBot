const {

  AttachmentBuilder,

  EmbedBuilder

} = require('discord.js');

const {

  createTranscript

} = require('discord-html-transcripts');

const {
  get
} = require('../../database');

// ==================================================
// 🧠 SAFE STRING
// ==================================================
function safeString(
  value,
  fallback = 'Unknown'
) {

  if (
    typeof value !== 'string'
  ) {

    return fallback;
  }

  return value.trim() ||
    fallback;
}

// ==================================================
// ⏱ FORMAT TIME
// ==================================================
function formatDuration(
  milliseconds
) {

  if (
    !milliseconds ||
    milliseconds <= 0
  ) {

    return '0m';
  }

  const totalSeconds =
    Math.floor(
      milliseconds / 1000
    );

  const days =
    Math.floor(
      totalSeconds / 86400
    );

  const hours =
    Math.floor(
      (totalSeconds % 86400) / 3600
    );

  const minutes =
    Math.floor(
      (totalSeconds % 3600) / 60
    );

  const parts = [];

  if (days) {

    parts.push(
      `${days}d`
    );
  }

  if (hours) {

    parts.push(
      `${hours}h`
    );
  }

  if (minutes) {

    parts.push(
      `${minutes}m`
    );
  }

  return parts.join(' ') ||
    '0m';
}

// ==================================================
// 📜 CREATE TRANSCRIPT
// ==================================================
async function generateTranscript({

  client,

  channel,

  ticket,

  closedBy
}) {

  try {

    // ==========================================
    // 🚫 VALIDATION
    // ==========================================
    if (

      !client ||

      !channel ||

      !ticket ||

      !closedBy
    ) {

      return null;
    }

    // ==========================================
    // 📂 FETCH SETTINGS
    // ==========================================
    const settings =
      get(

        `SELECT transcriptChannelId
         FROM guild_settings
         WHERE guildId = ?`,

        [

          channel.guild.id
        ]
      );

    // ==========================================
    // 🚫 NO TRANSCRIPT CHANNEL
    // ==========================================
    if (
      !settings?.transcriptChannelId
    ) {

      return null;
    }

    // ==========================================
    // 📥 FETCH TRANSCRIPT CHANNEL
    // ==========================================
    const transcriptChannel =
      await client.channels.fetch(
        settings.transcriptChannelId
      )

      .catch(() => null);

    if (
      !transcriptChannel ||
      !transcriptChannel.isTextBased()
    ) {

      return null;
    }

    // ==========================================
    // 📜 GENERATE HTML
    // ==========================================
    const attachment =
      await createTranscript(channel, {

        limit: -1,

        returnType:
          'attachment',

        filename:

          `ticket-${channel.name}.html`,

        saveImages: true,

        poweredBy: false,

        footerText:

          `Ticket Transcript • ${channel.guild.name}`,

        hydrated: true
      });

    // ==========================================
    // 🚫 FAILED GENERATION
    // ==========================================
    if (!attachment) {

      return null;
    }

    // ==========================================
    // 👤 FETCH USERS
    // ==========================================
    const creator =
      await client.users.fetch(
        ticket.userId
      )

      .catch(() => null);

    const claimer =
      ticket.claimedBy

        ? await client.users.fetch(
            ticket.claimedBy
          ).catch(() => null)

        : null;

    // ==========================================
    // ⏱ HANDLE TIME
    // ==========================================
    const createdAt =
      Number(
        ticket.createdAt || 0
      );

    const closedAt =
      Number(
        ticket.closedAt || Date.now()
      );

    const handleTime =
      Math.max(

        closedAt - createdAt,

        0
      );

    // ==========================================
    // 🎨 EMBED
    // ==========================================
    const embed =
      new EmbedBuilder()

        .setColor(0x5865F2)

        .setTitle(
          '📜 Ticket Transcript'
        )

        .setDescription(

          'A ticket transcript has been generated and archived.'
        )

        .addFields(

          {

            name:
              '🎫 Ticket',

            value:
              safeString(
                channel.name
              ),

            inline: true
          },

          {

            name:
              '📂 Type',

            value:

              `\`${safeString(ticket.type)}\``,

            inline: true
          },

          {

            name:
              '👤 Creator',

            value:

              creator

                ? `${creator.tag}`

                : `Unknown (${ticket.userId})`,

            inline: true
          },

          {

            name:
              '👮 Closed By',

            value:
              `${closedBy.tag}`,

            inline: true
          },

          {

            name:
              '🛡 Claimed By',

            value:

              claimer

                ? claimer.tag

                : 'Not claimed',

            inline: true
          },

          {

            name:
              '⏱ Handle Time',

            value:
              formatDuration(
                handleTime
              ),

            inline: true
          },

          {

            name:
              '📅 Created',

            value:

              createdAt

                ? `<t:${Math.floor(createdAt / 1000)}:F>`

                : 'Unknown',

            inline: false
          },

          {

            name:
              '🔒 Closed',

            value:

              closedAt

                ? `<t:${Math.floor(closedAt / 1000)}:F>`

                : 'Unknown',

            inline: false
          }
        )

        .setFooter({

          text:

            `Ticket ID: ${ticket.channelId || channel.id}`
        })

        .setTimestamp();

    // ==========================================
    // 📤 SEND TRANSCRIPT
    // ==========================================
    await transcriptChannel.send({

      embeds: [embed],

      files: [attachment]
    });

    // ==========================================
    // ✅ RETURN
    // ==========================================
    return attachment;

  } catch (err) {

    console.error(
      'Transcript Error:',
      err
    );

    return null;
  }
}

module.exports = {
  generateTranscript
};
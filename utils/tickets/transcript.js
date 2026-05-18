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
    // 📂 FETCH SETTINGS
    // ==========================================
    const settings = get(

      `SELECT transcriptChannelId
       FROM guild_settings
       WHERE guildId = ?`,

      [channel.guild.id]
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
    // 📥 FETCH CHANNEL
    // ==========================================
    const transcriptChannel =
      await client.channels.fetch(
        settings.transcriptChannelId
      )

      .catch(() => null);

    if (!transcriptChannel) {

      return null;
    }

    // ==========================================
    // 📜 GENERATE HTML
    // ==========================================
    const attachment =
      await createTranscript(channel, {

        limit: -1,

        returnType: 'attachment',

        filename:
          `ticket-${channel.name}.html`,

        saveImages: true,

        poweredBy: false
      });

    // ==========================================
    // 👤 USERS
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
    // 🎨 EMBED
    // ==========================================
    const embed =
      new EmbedBuilder()

        .setColor(0x5865F2)

        .setTitle(
          '📜 Ticket Transcript'
        )

        .addFields(

          {
            name: 'Ticket',

            value:
              channel.name,

            inline: true
          },

          {
            name: 'Creator',

            value:
              creator
                ? `${creator.tag}`
                : 'Unknown',

            inline: true
          },

          {
            name: 'Closed By',

            value:
              `${closedBy.tag}`,

            inline: true
          },

          {
            name: 'Claimed By',

            value:
              claimer
                ? claimer.tag
                : 'Not claimed',

            inline: true
          },

          {
            name: 'Ticket Type',

            value:
              ticket.type,

            inline: true
          },

          {
            name: 'Created',

            value:
              `<t:${Math.floor(ticket.createdAt / 1000)}:F>`,

            inline: false
          }
        )

        .setTimestamp();

    // ==========================================
    // 📤 SEND
    // ==========================================
    await transcriptChannel.send({

      embeds: [embed],

      files: [attachment]
    });

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
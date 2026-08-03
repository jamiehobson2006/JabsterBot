const {
  EmbedBuilder
} = require('discord.js');

const {
  createTranscript
} = require('discord-html-transcripts');

const {
  get
} = require('../../database');

function safeString(value, fallback = 'Unknown') {
  if (typeof value !== 'string') {
    return fallback;
  }

  return value.trim() || fallback;
}

function formatDuration(milliseconds) {
  const totalSeconds =
    Math.max(Math.floor(Number(milliseconds || 0) / 1000), 0);

  const days =
    Math.floor(totalSeconds / 86400);

  const hours =
    Math.floor((totalSeconds % 86400) / 3600);

  const minutes =
    Math.floor((totalSeconds % 3600) / 60);

  const parts = [];

  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);

  return parts.join(' ') || 'Under 1 minute';
}

async function generateTranscript({
  client,
  channel,
  ticket,
  closedBy
}) {
  try {
    if (!client || !channel || !ticket || !closedBy) {
      return null;
    }

    const settings =
      get(
        `SELECT transcriptChannelId
         FROM guild_settings
         WHERE guildId = ?`,
        [channel.guild.id]
      );

    const transcriptChannel =
      settings?.transcriptChannelId
        ? await client.channels.fetch(settings.transcriptChannelId)
            .catch(() => null)
        : null;

    const attachment =
      await createTranscript(channel, {
        limit: -1,
        returnType: 'attachment',
        filename: `ticket-${channel.name}.html`,
        saveImages: true,
        poweredBy: false,
        footerText: `Ticket Transcript - ${channel.guild.name}`,
        hydrated: true
      });

    if (!attachment) {
      return null;
    }

    const creator =
      await client.users.fetch(ticket.userId)
        .catch(() => null);

    const claimer =
      ticket.claimedBy
        ? await client.users.fetch(ticket.claimedBy)
            .catch(() => null)
        : null;

    const createdAt =
      Number(ticket.createdAt || 0);

    const closedAt =
      Number(ticket.closedAt || Date.now());

    const archiveEmbed =
      new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('Ticket Transcript')
        .setDescription('A ticket transcript has been generated and archived.')
        .addFields(
          {
            name: 'Ticket',
            value: safeString(channel.name),
            inline: true
          },
          {
            name: 'Type',
            value: safeString(ticket.type),
            inline: true
          },
          {
            name: 'Creator',
            value: creator?.tag || `Unknown (${ticket.userId})`,
            inline: true
          },
          {
            name: 'Closed By',
            value: closedBy.tag,
            inline: true
          },
          {
            name: 'Claimed By',
            value: claimer?.tag || 'Not claimed',
            inline: true
          },
          {
            name: 'Handle Time',
            value: formatDuration(closedAt - createdAt),
            inline: true
          },
          {
            name: 'Created',
            value: createdAt
              ? `<t:${Math.floor(createdAt / 1000)}:F>`
              : 'Unknown'
          },
          {
            name: 'Closed',
            value: closedAt
              ? `<t:${Math.floor(closedAt / 1000)}:F>`
              : 'Unknown'
          },
          {
            name: 'Close Reason',
            value: safeString(ticket.closeReason, 'No reason recorded').slice(0, 1024)
          }
        )
        .setFooter({
          text: `Ticket ID: ${ticket.channelId || channel.id}`
        })
        .setTimestamp();

    let archived =
      false;

    if (transcriptChannel?.isTextBased()) {
      try {
        await transcriptChannel.send({
          embeds: [archiveEmbed],
          files: [attachment]
        });

        archived =
          true;

      } catch (archiveError) {
        console.error('Transcript archive error:', archiveError.message);
      }
    }

    return {
      attachment,
      archived
    };

  } catch (err) {
    console.error('Transcript error:', err);
    return null;
  }
}

module.exports = {
  generateTranscript
};

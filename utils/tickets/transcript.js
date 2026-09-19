const {
  AttachmentBuilder,
  EmbedBuilder
} = require('discord.js');

const {
  buildTranscriptDocument
} = require('./transcriptDocument');

const { sendTranscriptMessage } = require('./transcriptDelivery');

const {
  get,
  run
} = require('../../database');

async function findExistingTranscript(channel, ticket, marker) {
  if (!channel?.messages?.fetch) return null;

  if (ticket.transcriptMessageId && ticket.transcriptArchiveChannelId === channel.id) {
    const saved = await channel.messages.fetch(ticket.transcriptMessageId).catch(() => null);
    if (saved) return saved;
  }

  let before;
  for (let page = 0; page < 10; page += 1) {
    const messages = await channel.messages.fetch({ limit: 100, before }).catch(() => null);
    if (!messages?.size) break;
    const match = messages.find(message =>
      String(message.content || '').includes(marker) ||
      message.embeds?.some(embed => embed.fields?.some(field =>
        String(field.name || '') === 'Ticket' &&
        String(field.value || '').includes(`ID: ${ticket.id || ticket.channelId}`)
      ))
    );
    if (match) return match;
    before = messages.last()?.id;
    if (!before || messages.size < 100) break;
  }

  return null;
}

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

function formatTicketType(type) {
  return safeString(type)
    .toLowerCase()
    .replace(/\b\w/g, letter => letter.toUpperCase());
}

function applicationDecisionFields(ticket, form) {
  const status = String(ticket.applicationStatus || 'PENDING').toUpperCase();
  const reviewedAt = Number(ticket.applicationReviewedAt || 0);

  return [
    {
      name: 'Application Form',
      value: form?.name || (ticket.applicationFormId ? `Form #${ticket.applicationFormId}` : 'Unknown'),
      inline: true
    },
    {
      name: 'Application Result',
      value: status.charAt(0) + status.slice(1).toLowerCase(),
      inline: true
    },
    {
      name: 'Reviewed By',
      value: ticket.applicationReviewedBy ? `<@${ticket.applicationReviewedBy}>` : 'Not reviewed',
      inline: true
    },
    {
      name: 'Reviewed',
      value: reviewedAt ? `<t:${Math.floor(reviewedAt / 1000)}:F>` : 'Not reviewed',
      inline: true
    },
    {
      name: 'Decision Reason',
      value: safeString(ticket.applicationDecisionReason, 'No decision recorded').slice(0, 1024)
    }
  ];
}

function getTranscriptChannelIds(settings, ticket) {
  if (String(ticket?.type || '').toLowerCase() === 'application') {
    return [
      settings?.applicationTranscriptChannelId,
      settings?.transcriptChannelId
    ].filter((value, index, values) => value && values.indexOf(value) === index);
  }

  return settings?.transcriptChannelId
    ? [settings.transcriptChannelId]
    : [];
}

function getTranscriptChannelId(settings, ticket) {
  return getTranscriptChannelIds(settings, ticket)[0] || null;
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
        `SELECT transcriptChannelId,
                applicationTranscriptChannelId
         FROM guild_settings
         WHERE guildId = ?`,
        [channel.guild.id]
      );

    let transcriptChannel = null;

    for (const channelId of getTranscriptChannelIds(settings, ticket)) {
      const candidate = await client.channels.fetch(channelId).catch(() => null);

      if (candidate?.isTextBased()) {
        transcriptChannel = candidate;
        break;
      }
    }

    const creator =
      await client.users.fetch(ticket.userId)
        .catch(() => null);

    const claimer =
      ticket.claimedBy
        ? await client.users.fetch(ticket.claimedBy)
            .catch(() => null)
        : null;

    const response = String(ticket.type || '').toLowerCase() === 'application'
      ? get(
        `SELECT answersJson FROM application_responses
         WHERE guildId = ? AND channelId = ? AND userId = ?
         ORDER BY submittedAt DESC LIMIT 1`,
        [channel.guild.id, channel.id, ticket.userId]
      )
      : null;
    const answers = response ? JSON.parse(response.answersJson) : [];
    const createdAt =
      Number(ticket.createdAt || 0);

    const closedAt =
      Number(ticket.closedAt || Date.now());

    const applicationForm =
      String(ticket.type || '').toLowerCase() === 'application' && ticket.applicationFormId
        ? get(
          `SELECT name
           FROM application_forms
           WHERE guildId = ?
           AND id = ?`,
          [channel.guild.id, ticket.applicationFormId]
        )
        : null;

    const document = await buildTranscriptDocument({
      channel, ticket, closedBy, applicationForm,
      answers: Array.isArray(answers) ? answers : []
    });
    const attachment = new AttachmentBuilder(Buffer.from(document.html, 'utf8'), {
      name: `ticket-${channel.id}.html`
    });

    const fields = [
      {
        name: 'Ticket',
        value: `${safeString(channel.name)}\nID: ${ticket.id || ticket.channelId || channel.id}`,
        inline: true
      },
      {
        name: 'Type',
        value: formatTicketType(ticket.type),
        inline: true
      },
      {
        name: 'Status',
        value: safeString(ticket.status, 'Closed'),
        inline: true
      },
      {
        name: 'Creator',
        value: creator ? `${creator.tag}\n<@${creator.id}>` : `Unknown (${ticket.userId})`,
        inline: true
      },
      {
        name: 'Closed By',
        value: closedBy ? `${closedBy.tag}\n<@${closedBy.id}>` : 'Unknown',
        inline: true
      },
      {
        name: 'Claimed By',
        value: claimer ? `${claimer.tag}\n<@${claimer.id}>` : 'Not claimed',
        inline: true
      },
      {
        name: 'Created',
        value: createdAt ? `<t:${Math.floor(createdAt / 1000)}:F>` : 'Unknown',
        inline: true
      },
      {
        name: 'Closed',
        value: closedAt ? `<t:${Math.floor(closedAt / 1000)}:F>` : 'Unknown',
        inline: true
      },
      {
        name: 'Handle Time',
        value: formatDuration(closedAt - createdAt),
        inline: true
      },
      {
        name: 'Close Reason',
        value: safeString(ticket.closeReason, 'No reason recorded').slice(0, 1024)
      },
      {
        name: 'Archive Contents',
        value: `${document.messageCount} messages | ${document.assets.saved} embedded media files${document.assets.linked ? ` | ${document.assets.linked} media links only` : ''}`
      }
    ];

    if (String(ticket.type || '').toLowerCase() === 'application') {
      fields.push(...applicationDecisionFields(ticket, applicationForm));
    }

    const archiveEmbed =
      new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`Transcript | ${formatTicketType(ticket.type)}`)
        .setDescription('HTML archive with ticket details, messages, embeds, and available media.')
        .addFields(fields)
        .setFooter({
          text: `Jabster Studios | ${String(ticket.type || 'ticket').toUpperCase()} archive`
        })
        .setTimestamp();

    let archived =
      false;

    if (transcriptChannel?.isTextBased()) {
      try {
        const savedTicket = get(`SELECT * FROM tickets WHERE channelId = ?`, [channel.id]) || ticket;
        const marker = `ticket-transcript:${channel.guild.id}:${ticket.id || channel.id}`;
        let archiveMessage = await findExistingTranscript(transcriptChannel, savedTicket, marker);

        if (!archiveMessage) {
          archiveMessage = await sendTranscriptMessage(transcriptChannel, {
            content: `-# ${marker}`,
            embeds: [archiveEmbed],
            files: [attachment]
          });
        }

        run(
          `UPDATE tickets
           SET transcriptMessageId = ?,
               transcriptArchiveChannelId = ?,
               transcriptSentAt = COALESCE(transcriptSentAt, ?)
           WHERE channelId = ?`,
          [archiveMessage.id, transcriptChannel.id, Date.now(), channel.id]
        );

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
  applicationDecisionFields,
  generateTranscript,
  getTranscriptChannelIds,
  getTranscriptChannelId,
  findExistingTranscript
};

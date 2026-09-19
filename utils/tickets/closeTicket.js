const {
  EmbedBuilder
} = require('discord.js');

const {
  db,
  get,
  run
} = require('../../database');

const {
  createAuditEmbed,
  logAudit
} = require('../logger');

const {
  canCloseTicket
} = require('./permissions');

const {
  addClose,
  addHandleTime
} = require('./stats');

const {
  generateTranscript
} = require('./transcript');

const {
  createFeedbackRecord,
  sendFeedbackPrompt
} = require('../ticketFeedback');

const {
  findOrRecoverOpenTicket
} = require('./recoverTicket');

const {
  deleteClosedTicketChannel
} = require('./closedTicketCleanup');

function cleanReason(reason) {
  return String(reason || '')
    .replace(/@everyone|@here/g, '[mention removed]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1000);
}

function formatDuration(milliseconds) {
  const seconds =
    Math.max(Math.floor(Number(milliseconds || 0) / 1000), 0);

  const minutes =
    Math.floor(seconds / 60);

  const hours =
    Math.floor(minutes / 60);

  const days =
    Math.floor(hours / 24);

  if (days) return `${days}d ${hours % 24}h`;
  if (hours) return `${hours}h ${minutes % 60}m`;
  if (minutes) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

async function disableTicketButtons(channel, client) {
  const messages =
    await channel.messages.fetch({ limit: 15 });

  const ticketMessage =
    messages.find(message =>
      message.author.id === client.user.id &&
      message.components?.length
    );

  if (!ticketMessage) {
    return;
  }

  const components =
    ticketMessage.components.map(row => {
      row.components.forEach(component => {
        component.data.disabled = true;

        if (component.customId === 'ticket_close') {
          component.data.label = 'Closed';
        }
      });

      return row;
    });

  await ticketMessage.edit({ components });
}

async function closeTicket({
  interaction,
  reason,
  starterMessageId = null
}) {
  if (!interaction?.guild || !interaction.channel) {
    throw new Error('Invalid ticket interaction.');
  }

  const closeReason =
    cleanReason(reason);

  if (closeReason.length < 3) {
    throw new Error('A close reason of at least 3 characters is required.');
  }

  const ticket = await findOrRecoverOpenTicket({
    guild: interaction.guild,
    channel: interaction.channel,
    client: interaction.client,
    starterMessageId
  });

  if (!ticket) {
    throw new Error('Invalid ticket.');
  }

  const allowed =
    canCloseTicket({
      member: interaction.member,
      guildId: interaction.guild.id,
      type: ticket.type,
      channelId: interaction.channel.id
    });

  if (!allowed) {
    throw new Error('You cannot close tickets.');
  }

  const transitionedAt = Date.now();
  const transitioned = String(ticket.status || '').toUpperCase() === 'OPEN';

  if (transitioned) {
    const result = run(
      `UPDATE tickets
       SET status = 'CLOSING',
           closedBy = ?,
           closedAt = ?,
           closeReason = ?,
           closeAttempts = COALESCE(closeAttempts, 0) + 1,
           closeLastError = NULL
       WHERE channelId = ? AND UPPER(status) = 'OPEN'`,
      [interaction.user.id, transitionedAt, closeReason, interaction.channel.id]
    );

    if (!result.changes) {
      throw new Error('This ticket is already being closed. Please try again.');
    }
  } else {
    run(
      `UPDATE tickets
       SET closeAttempts = COALESCE(closeAttempts, 0) + 1,
           closeLastError = NULL
       WHERE channelId = ? AND UPPER(status) = 'CLOSING'`,
      [interaction.channel.id]
    );
  }

  const closingTicket = get(
    `SELECT * FROM tickets WHERE channelId = ?`,
    [interaction.channel.id]
  );
  const effectiveReason = closingTicket.closeReason || closeReason;
  const closedAt = Number(closingTicket.closedAt || transitionedAt);
  const closerId = closingTicket.closedBy || interaction.user.id;
  const handleTime = Math.max(closedAt - Number(closingTicket.createdAt || 0), 0);

  const closeEmbed =
    new EmbedBuilder()
      .setColor(0xED4245)
      .setTitle('Ticket Closed')
      .setDescription(`This ticket is being closed by <@${closerId}>.`)
      .addFields(
        {
          name: 'Ticket Type',
          value: closingTicket.type,
          inline: true
        },
        {
          name: 'Handle Time',
          value: formatDuration(handleTime),
          inline: true
        },
        {
          name: 'Close Reason',
          value: effectiveReason
        }
      )
      .setFooter({
        text: 'Preparing transcript and feedback delivery'
      })
      .setTimestamp(closedAt);

  try {
    if (!closingTicket.closeNoticeSentAt) {
      await interaction.channel.send({ embeds: [closeEmbed] });

      await logAudit(
        interaction.client,
        interaction.guild.id,
        {
          action: 'TICKET_CLOSED',
          targetId: closingTicket.userId,
          executorId: closerId,
          type: 'TICKETS',
          metadata: {
            ticketId: closingTicket.id,
            channelId: interaction.channel.id,
            type: closingTicket.type,
            reason: effectiveReason,
            handleTime
          },
          embed: createAuditEmbed({
            action: 'Ticket Closed',
            target: `<@${closingTicket.userId}>`,
            executor: `<@${closerId}>`,
            channel: `${interaction.channel}`,
            reason: effectiveReason,
            extra: `Type: ${closingTicket.type}\nHandle time: ${formatDuration(handleTime)}`,
            color: 0xED4245
          })
        }
      ).catch(err => console.error('Ticket close log error:', err));

      run(
        `UPDATE tickets SET closeNoticeSentAt = ? WHERE channelId = ?`,
        [Date.now(), interaction.channel.id]
      );
    }

    const feedback = createFeedbackRecord({
      ticket: closingTicket,
      closedBy: { id: closerId },
      closeReason: effectiveReason
    });

    const transcript = await generateTranscript({
      client: interaction.client,
      channel: interaction.channel,
      ticket: closingTicket,
      closedBy: interaction.user
    });

    const feedbackSent = Boolean(feedback.dmSent) || await sendFeedbackPrompt({
      client: interaction.client,
      feedback,
      transcriptAttachment: transcript?.attachment || null
    });

    if (!transcript?.attachment || (!transcript.archived && !feedbackSent)) {
      throw new Error(
        'Transcript delivery is still pending. The channel was kept; use Close again to retry.'
      );
    }

    const deleteAfter = Date.now() + 5000;
    const finalize = db.transaction(() => {
      const current = get(
        `SELECT * FROM tickets WHERE channelId = ?`,
        [interaction.channel.id]
      );

      if (!current || String(current.status).toUpperCase() !== 'CLOSING') {
        throw new Error('This ticket is no longer awaiting closure.');
      }

      if (!current.closeStatsRecordedAt) {
        addClose(interaction.guild.id, closerId);
        addHandleTime(interaction.guild.id, closerId, handleTime);
      }

      run(`DELETE FROM ticket_staff WHERE channelId = ?`, [interaction.channel.id]);
      run(`DELETE FROM ticket_guests WHERE channelId = ?`, [interaction.channel.id]);
      run(
        `UPDATE tickets
         SET status = 'CLOSED',
             closeStatsRecordedAt = COALESCE(closeStatsRecordedAt, ?),
             closeLastError = NULL,
             deleteAfter = ?
         WHERE channelId = ? AND UPPER(status) = 'CLOSING'`,
        [Date.now(), deleteAfter, interaction.channel.id]
      );
    });

    finalize();

    await disableTicketButtons(interaction.channel, interaction.client)
      .catch(err => console.error('Ticket button disable error:', err));

    setTimeout(
    () => {

      deleteClosedTicketChannel(
        interaction.client,
        interaction.channel.id
      ).catch(err => console.error('Ticket channel delete error:', err));
    },
    5000
  );

    return {
      success: true,
      channelDeleted: true,
      feedbackSent,
      handleTime
    };
  } catch (error) {
    run(
      `UPDATE tickets
       SET closeLastError = ?
       WHERE channelId = ? AND UPPER(status) = 'CLOSING'`,
      [String(error.message || error).slice(0, 1000), interaction.channel.id]
    );
    throw error;
  }
}

module.exports = {
  closeTicket
};

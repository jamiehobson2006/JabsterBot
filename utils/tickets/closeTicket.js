const {
  EmbedBuilder
} = require('discord.js');

const {
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

  const closedAt =
    Date.now();

  const result =
    run(
      `UPDATE tickets
       SET status = 'CLOSED',
           closedBy = ?,
           closedAt = ?,
           closeReason = ?
       WHERE channelId = ?
       AND UPPER(status) = 'OPEN'`,
      [
        interaction.user.id,
        closedAt,
        closeReason,
        interaction.channel.id
      ]
    );

  if (!result.changes) {
    throw new Error('This ticket is already closed.');
  }

  run(
    `DELETE FROM ticket_staff
     WHERE channelId = ?`,
    [interaction.channel.id]
  );

  run(
    `DELETE FROM ticket_guests
     WHERE channelId = ?`,
    [interaction.channel.id]
  );

  const handleTime =
    Math.max(closedAt - Number(ticket.createdAt || 0), 0);

  try {
    addClose(interaction.guild.id, interaction.user.id);
    addHandleTime(interaction.guild.id, interaction.user.id, handleTime);
  } catch (err) {
    console.error('Ticket stats error:', err);
  }

  const closedTicket = {
    ...ticket,
    status: 'CLOSED',
    closedBy: interaction.user.id,
    closedAt,
    closeReason
  };

  const closeEmbed =
    new EmbedBuilder()
      .setColor(0xED4245)
      .setTitle('Ticket Closed')
      .setDescription(`This ticket was closed by ${interaction.user}.`)
      .addFields(
        {
          name: 'Ticket Type',
          value: ticket.type,
          inline: true
        },
        {
          name: 'Handle Time',
          value: formatDuration(handleTime),
          inline: true
        },
        {
          name: 'Close Reason',
          value: closeReason
        }
      )
      .setFooter({
        text: 'Channel will be deleted shortly'
      })
      .setTimestamp(closedAt);

  await disableTicketButtons(interaction.channel, interaction.client)
    .catch(err => console.error('Ticket button disable error:', err));

  await interaction.channel.send({
    embeds: [closeEmbed]
  });

  await logAudit(
    interaction.client,
    interaction.guild.id,
    {
      action: 'TICKET_CLOSED',
      targetId: ticket.userId,
      executorId: interaction.user.id,
      type: 'TICKETS',
      metadata: {
        ticketId: ticket.id,
        channelId: interaction.channel.id,
        type: ticket.type,
        reason: closeReason,
        handleTime
      },
      embed: createAuditEmbed({
        action: 'Ticket Closed',
        target: `<@${ticket.userId}>`,
        executor: `${interaction.user.tag}\n<@${interaction.user.id}>`,
        channel: `${interaction.channel}`,
        reason: closeReason,
        extra:
          `Type: ${ticket.type}\n` +
          `Handle time: ${formatDuration(handleTime)}`,
        color: 0xED4245
      })
    }
  ).catch(err => console.error('Ticket close log error:', err));

  const feedback =
    createFeedbackRecord({
      ticket: closedTicket,
      closedBy: interaction.user,
      closeReason
    });

  const transcript =
    await generateTranscript({
      client: interaction.client,
      channel: interaction.channel,
      ticket: closedTicket,
      closedBy: interaction.user
    });

  const feedbackSent =
    await sendFeedbackPrompt({
      client: interaction.client,
      feedback,
      transcriptAttachment: transcript?.attachment || null
    });

  if (!transcript?.attachment) {
    await interaction.channel.send({
      content:
        'The ticket was closed, but its transcript could not be generated. The channel was kept for safety.'
    }).catch(() => null);

    return {
      success: true,
      channelDeleted: false,
      feedbackSent,
      handleTime
    };
  }

  const deleteAfter =
    Date.now() + 5000;

  run(
    `UPDATE tickets
     SET deleteAfter = ?
     WHERE channelId = ?
     AND UPPER(status) = 'CLOSED'`,
    [deleteAfter, interaction.channel.id]
  );

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
}

module.exports = {
  closeTicket
};

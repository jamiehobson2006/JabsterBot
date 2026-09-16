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
  closeTicket
} = require('./closeTicket');

const {
  hasTicketAccess
} = require('./permissions');

const {
  findOrRecoverOpenTicket
} = require('./recoverTicket');

function cleanDecisionReason(reason) {
  return String(reason || '')
    .replace(/@everyone|@here/g, '[mention removed]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1000);
}

function decisionLabel(decision) {
  return decision === 'ACCEPTED' ? 'Accepted' : 'Denied';
}

function decisionColor(decision) {
  return decision === 'ACCEPTED' ? 0x57F287 : 0xED4245;
}

async function notifyApplicant(interaction, ticket, decision, reason) {
  const applicant = await interaction.client.users.fetch(ticket.userId).catch(() => null);
  if (!applicant) return false;

  try {
    await applicant.send({
      embeds: [new EmbedBuilder()
        .setColor(decisionColor(decision))
        .setTitle(`Application ${decisionLabel(decision)}`)
        .setDescription(`Your application in **${interaction.guild.name}** has been ${decision.toLowerCase()}.`)
        .addFields(
          { name: 'Reviewed By', value: interaction.user.tag, inline: true },
          { name: 'Reason', value: reason }
        )
        .setFooter({ text: 'Jabster Studios Applications' })
        .setTimestamp()]
    });

    return true;
  } catch {
    return false;
  }
}

async function reviewApplication({
  interaction,
  decision,
  reason
}) {
  const normalizedDecision = String(decision || '').toUpperCase();
  const cleanedReason = cleanDecisionReason(reason);

  if (!['ACCEPTED', 'DENIED'].includes(normalizedDecision)) {
    throw new Error('Application decisions must be Accepted or Denied.');
  }

  if (cleanedReason.length < 3) {
    throw new Error('Provide a decision reason of at least 3 characters.');
  }

  const ticket = await findOrRecoverOpenTicket({
    guild: interaction.guild,
    channel: interaction.channel,
    client: interaction.client
  });

  if (!ticket || String(ticket.type || '').toLowerCase() !== 'application') {
    throw new Error('Use this command inside an open application ticket.');
  }

  if (!hasTicketAccess({
    member: interaction.member,
    guildId: interaction.guild.id,
    type: ticket.type,
    channelId: interaction.channel.id
  })) {
    throw new Error('You do not have permission to review this application.');
  }

  const reviewedAt = Date.now();
  const updated = run(
    `UPDATE tickets
     SET applicationStatus = ?,
         applicationReviewedBy = ?,
         applicationReviewedAt = ?,
         applicationDecisionReason = ?
     WHERE channelId = ?
     AND UPPER(status) = 'OPEN'
     AND COALESCE(UPPER(applicationStatus), 'PENDING') = 'PENDING'`,
    [
      normalizedDecision,
      interaction.user.id,
      reviewedAt,
      cleanedReason,
      interaction.channel.id
    ]
  );

  if (!updated.changes) {
    throw new Error('This application has already been reviewed or closed.');
  }

  const label = decisionLabel(normalizedDecision);
  const decisionEmbed = new EmbedBuilder()
    .setColor(decisionColor(normalizedDecision))
    .setTitle(`Application ${label}`)
    .setDescription(`This application was ${normalizedDecision.toLowerCase()} by ${interaction.user}.`)
    .addFields(
      { name: 'Applicant', value: `<@${ticket.userId}>`, inline: true },
      { name: 'Reviewer', value: `${interaction.user}`, inline: true },
      { name: 'Reason', value: cleanedReason }
    )
    .setFooter({ text: 'The ticket will now be closed and archived.' })
    .setTimestamp(reviewedAt);

  await interaction.channel.send({ embeds: [decisionEmbed] });

  const applicantNotified = await notifyApplicant(
    interaction,
    ticket,
    normalizedDecision,
    cleanedReason
  );

  await logAudit(interaction.client, interaction.guild.id, {
    action: `APPLICATION_${normalizedDecision}`,
    targetId: ticket.userId,
    executorId: interaction.user.id,
    type: 'TICKETS',
    metadata: {
      ticketId: ticket.id,
      channelId: interaction.channel.id,
      formId: ticket.applicationFormId,
      decision: normalizedDecision,
      reason: cleanedReason
    },
    embed: createAuditEmbed({
      action: `Application ${label}`,
      target: `<@${ticket.userId}>`,
      executor: `${interaction.user.tag}\n<@${interaction.user.id}>`,
      channel: `${interaction.channel}`,
      reason: cleanedReason,
      extra: `Ticket: #${ticket.id || 'unknown'}\nResult: ${label}`,
      color: decisionColor(normalizedDecision)
    })
  }).catch(error => console.error('Application review log error:', error));

  const closeResult = await closeTicket({
    interaction,
    reason: `Application ${normalizedDecision.toLowerCase()}: ${cleanedReason}`
  });

  return {
    ...closeResult,
    applicantNotified,
    decision: normalizedDecision
  };
}

module.exports = {
  cleanDecisionReason,
  reviewApplication
};

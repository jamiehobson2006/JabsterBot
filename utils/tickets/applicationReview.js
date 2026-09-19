const {
  EmbedBuilder
} = require('discord.js');

const {
  get,
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

const REVIEW_TIMEOUT_MS = 10 * 60 * 1000;

function recoverStaleApplicationReviews(now = Date.now()) {
  const cutoff = now - REVIEW_TIMEOUT_MS;

  run(
    `UPDATE tickets
     SET applicationStatus = CASE
           WHEN UPPER(applicationStatus) = 'REVIEWING_ACCEPTED' THEN 'ACCEPTED'
           ELSE 'DENIED'
         END
     WHERE UPPER(applicationStatus) IN ('REVIEWING_ACCEPTED', 'REVIEWING_DENIED')
       AND applicationReviewedAt <= ?
       AND (applicationDecisionMessageId IS NOT NULL OR applicationApplicantNotifiedAt IS NOT NULL)`,
    [cutoff]
  );

  return run(
    `UPDATE tickets
     SET applicationStatus = 'PENDING',
         applicationReviewedBy = NULL,
         applicationReviewedAt = NULL,
         applicationDecisionReason = NULL
     WHERE UPPER(status) = 'OPEN'
       AND UPPER(applicationStatus) IN ('REVIEWING_ACCEPTED', 'REVIEWING_DENIED')
       AND applicationReviewedAt <= ?
       AND applicationDecisionMessageId IS NULL
       AND applicationApplicantNotifiedAt IS NULL`,
    [cutoff]
  ).changes;
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
  const reviewingStatus = `REVIEWING_${normalizedDecision}`;
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
      reviewingStatus,
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

  try {
    let decisionMessage = ticket.applicationDecisionMessageId
      ? await interaction.channel.messages.fetch(ticket.applicationDecisionMessageId).catch(() => null)
      : null;

    if (decisionMessage) {
      await decisionMessage.edit({ embeds: [decisionEmbed] });
    } else {
      decisionMessage = await interaction.channel.send({ embeds: [decisionEmbed] });
      run(
        `UPDATE tickets SET applicationDecisionMessageId = ? WHERE channelId = ?`,
        [decisionMessage.id, interaction.channel.id]
      );
    }

    const applicantNotified = Boolean(ticket.applicationApplicantNotifiedAt) || await notifyApplicant(
      interaction,
      ticket,
      normalizedDecision,
      cleanedReason
    );
    if (applicantNotified && !ticket.applicationApplicantNotifiedAt) {
      run(
        `UPDATE tickets SET applicationApplicantNotifiedAt = ? WHERE channelId = ?`,
        [Date.now(), interaction.channel.id]
      );
    }

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

    const finalized = run(
      `UPDATE tickets
       SET applicationStatus = ?
       WHERE channelId = ? AND applicationStatus = ?`,
      [normalizedDecision, interaction.channel.id, reviewingStatus]
    );
    if (!finalized.changes) {
      throw new Error('The application review state changed before it could be finalized.');
    }

    const closeResult = await closeTicket({
      interaction,
      reason: `Application ${normalizedDecision.toLowerCase()}: ${cleanedReason}`
    });

    return {
      ...closeResult,
      applicantNotified,
      decision: normalizedDecision
    };
  } catch (error) {
    const current = get(`SELECT * FROM tickets WHERE channelId = ?`, [interaction.channel.id]);
    const sideEffectDelivered = Boolean(
      current?.applicationDecisionMessageId || current?.applicationApplicantNotifiedAt
    );

    if (String(current?.applicationStatus || '').toUpperCase() === reviewingStatus) {
      if (sideEffectDelivered) {
        run(
          `UPDATE tickets SET applicationStatus = ? WHERE channelId = ? AND applicationStatus = ?`,
          [normalizedDecision, interaction.channel.id, reviewingStatus]
        );
      } else {
        run(
          `UPDATE tickets
           SET applicationStatus = 'PENDING',
               applicationReviewedBy = NULL,
               applicationReviewedAt = NULL,
               applicationDecisionReason = NULL
           WHERE channelId = ? AND applicationStatus = ?`,
          [interaction.channel.id, reviewingStatus]
        );
      }
    }
    throw error;
  }
}

module.exports = {
  cleanDecisionReason,
  recoverStaleApplicationReviews,
  reviewApplication
};

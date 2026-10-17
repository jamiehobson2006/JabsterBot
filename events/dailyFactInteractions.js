const {
  ActionRowBuilder,
  EmbedBuilder,
  InteractionType,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');

const {
  db,
  get,
  run
} = require('../database');

const {
  categoryName,
  cleanFact,
  findDuplicateFact,
  normalizeFact,
  saveApprovedFact
} = require('../utils/dailyFacts');
const { notifyFactSubmitter, reviewChannelId, updateFactReview } = require('../utils/dailyFactReview');
const { sourceFields, validateSourceUrl } = require('../utils/factSources');

function duplicateLabel(
  duplicate
) {

  if (duplicate.source === 'coded') {
    return 'coded fact';
  }

  if (duplicate.source === 'community') {
    return 'approved community fact';
  }

  return `submission #${duplicate.id}`;
}

function submissionIdFromCustomId(customId) {

  return Number(
    customId.split('_').at(-1)
  );
}

const REVIEW_TIMEOUT_MS = 10 * 60 * 1000;

function recoverStaleDailyFactReviews(now = Date.now()) {
  return run(
    `UPDATE dailyfact_submissions
     SET status = 'PENDING', reviewerId = NULL, decisionAt = NULL
     WHERE status = 'REVIEWING' AND COALESCE(decisionAt, 0) <= ?`,
    [now - REVIEW_TIMEOUT_MS]
  ).changes;
}

function claimSubmission(submissionId, reviewerId) {
  return run(
    `UPDATE dailyfact_submissions
     SET status = 'REVIEWING', reviewerId = ?, decisionAt = ?
     WHERE id = ? AND status = 'PENDING'`,
    [reviewerId, Date.now(), submissionId]
  ).changes === 1;
}

async function replyAlreadyReviewed(interaction, submissionId) {
  const current = get(`SELECT status FROM dailyfact_submissions WHERE id = ?`, [submissionId]);
  return interaction.followUp({
    content: `This submission is already ${String(current?.status || 'being reviewed').toLowerCase()}.`,
    flags: MessageFlags.Ephemeral
  });
}

async function sendSubmissionDm(
  client,
  submission,
  {
    color,
    title,
    description,
    fact = submission.fact
  }
) {

  return notifyFactSubmitter(client, submission, { color, title, description, fact });
}

function updateReviewEmbed(
  message,
  {
    color,
    footer,
    fact,
    statusField
  }
) {

  const embed =
    EmbedBuilder.from(
      message.embeds[0] ||
      new EmbedBuilder()
    );

  embed.setColor(color);

  if (footer) {

    embed.setFooter({
      text: footer
    });
  }

  const fields =
    embed.data.fields || [];

  const factIndex =
    fields.findIndex(field =>
      String(field.name || '')
        .toLowerCase()
        .includes('fact')
    );

  if (
    fact &&
    factIndex >= 0
  ) {

    fields[factIndex] = {
      ...fields[factIndex],
      value: fact
    };

    embed.setFields(fields);

  } else if (fact) {

    embed.addFields({
      name: 'Fact',
      value: fact
    });
  }

  if (statusField) {

    embed.addFields({
      name: 'Review Status',
      value: statusField
    });
  }

  return embed;
}

function approvedSourceEmbed(embed, submission) {
  const replaced = new Set(['Source Link', 'Source Verification', 'Verification Checklist']);
  return embed.setFields((embed.data.fields || []).filter(field => !replaced.has(field.name)))
    .addFields(...sourceFields(submission));
}

async function markDuplicate({
  interaction,
  submission,
  duplicate,
  fact = submission.fact
}) {

  run(

    `UPDATE dailyfact_submissions
     SET status = ?,
         reviewerId = ?,
         decisionAt = ?,
         duplicateOf = ?
     WHERE id = ? AND status = 'REVIEWING' AND reviewerId = ?`,

    [
      'DUPLICATE',
      interaction.user.id,
      Date.now(),
      duplicate.source === 'submission'
        ? `submission:${duplicate.id}`
        : duplicate.source === 'community'
          ? `approved:${duplicate.id}`
          : `coded:${duplicate.category}`,
      submission.id,
      interaction.user.id
    ]
  );

  await sendSubmissionDm(
    interaction.client,
    submission,
    {
      color: 0xFEE75C,
      title: 'Daily Fact Duplicate',
      description:
        'Your Daily Fact submission was marked as a duplicate because this fact has already been submitted or added.',
      fact
    }
  );

  return updateFactReview(interaction, {

    embeds: [
      updateReviewEmbed(
        interaction.message,
        {
          color: 0xFEE75C,
          footer: `Duplicate marked by ${interaction.user.tag}`,
          fact,
          statusField:
            `Matched: ${duplicateLabel(duplicate)}`
        }
      )
    ],

    components: []
  });
}

async function approveSubmission({
  interaction,
  submission,
  fact = submission.fact
}) {

  if (!claimSubmission(submission.id, interaction.user.id)) {
    return replyAlreadyReviewed(interaction, submission.id);
  }

  const duplicate =
    findDuplicateFact(
      fact,
      {
        excludeSubmissionId: submission.id
      }
    );

  if (duplicate) {

    return markDuplicate({
      interaction,
      submission,
      duplicate,
      fact
    });
  }

  const approve = db.transaction(() => {
    const approvedAt = Date.now();
    const updated = run(
      `UPDATE dailyfact_submissions
       SET fact = ?, normalizedFact = ?, status = 'APPROVED', approvedAt = ?, decisionAt = ?
       WHERE id = ? AND status = 'REVIEWING' AND reviewerId = ?`,
      [fact, normalizeFact(fact), approvedAt, approvedAt, submission.id, interaction.user.id]
    );
    if (!updated.changes) throw new Error('The submission review claim was lost.');
    run(`UPDATE dailyfact_submissions SET sourceUrl = ?, verifiedAt = ?, verifiedBy = ?, verificationNote = ? WHERE id = ?`,
      [submission.sourceUrl || null, submission.verifiedAt || null, submission.verifiedBy || null,
        submission.verificationNote || null, submission.id]);

    return saveApprovedFact({
      submissionId: submission.id,
      userId: submission.userId,
      reviewerId: interaction.user.id,
      fact,
      category: submission.category || 'random',
      approvedAt, sourceUrl: submission.sourceUrl, verifiedAt: submission.verifiedAt,
      verifiedBy: submission.verifiedBy, verificationNote: submission.verificationNote
    });
  });
  const approvedFact = approve();

  await sendSubmissionDm(
    interaction.client,
    submission,
    {
      color: 0x57F287,
      title: 'Daily Fact Approved',
      description:
        'Your Daily Fact submission has been approved and added to Jabster Studios daily facts.',
      fact
    }
  );

  return updateFactReview(interaction, {

    embeds: [
      approvedSourceEmbed(updateReviewEmbed(
        interaction.message,
        {
          color: 0x57F287,
          footer: `Approved by ${interaction.user.tag}`,
          fact
        }
      ), submission).addFields({ name: 'Library ID', value: String(approvedFact.id), inline: true })
    ],

    components: []
  });
}

async function denySubmission(
  interaction,
  submission
) {

  if (!claimSubmission(submission.id, interaction.user.id)) {
    return replyAlreadyReviewed(interaction, submission.id);
  }

  run(

    `UPDATE dailyfact_submissions
     SET status = ?,
         reviewerId = ?,
         decisionAt = ?
     WHERE id = ? AND status = 'REVIEWING' AND reviewerId = ?`,

    [
      'DENIED',
      interaction.user.id,
      Date.now(),
      submission.id,
      interaction.user.id
    ]
  );

  await sendSubmissionDm(
    interaction.client,
    submission,
    {
      color: 0xED4245,
      title: 'Daily Fact Denied',
      description:
        'Your Daily Fact submission was reviewed and denied. You can submit a different fact any time.'
    }
  );

  return updateFactReview(interaction, {

    embeds: [
      updateReviewEmbed(
        interaction.message,
        {
          color: 0xED4245,
          footer: `Denied by ${interaction.user.tag}`
        }
      )
    ],

    components: []
  });
}

module.exports = {

  name: 'interactionCreate',

  async execute(interaction) {
    const relevantButton = interaction.isButton?.() && /^dailyfact_(approve|edit|verify|deny)_[1-9]\d*$/.test(interaction.customId);
    const relevantModal = interaction.type === InteractionType.ModalSubmit && /^dailyfact_(editmodal|verifymodal)_[1-9]\d*$/.test(interaction.customId);
    if (!relevantButton && !relevantModal) return;

    try {
      if (interaction.channelId !== reviewChannelId() ||
          interaction.message?.author?.id !== interaction.client.user.id) {
        return await interaction.reply({ content: 'Daily Facts can only be reviewed on their original message in the review channel.',
          flags: MessageFlags.Ephemeral });
      }
      const bound = get('SELECT reviewMessageId FROM dailyfact_submissions WHERE id = ?',
        [submissionIdFromCustomId(interaction.customId)]);
      if (bound?.reviewMessageId && bound.reviewMessageId !== interaction.message.id) {
        return await interaction.reply({ content: 'This is not the original review message for that submission.',
          flags: MessageFlags.Ephemeral });
      }

      recoverStaleDailyFactReviews();

      if (
        interaction.isButton() &&
        interaction.customId.startsWith('dailyfact_')
      ) {

        const customId =
          interaction.customId;

        const submissionId =
          submissionIdFromCustomId(customId);

        const action =
          customId.split('_')[1];

        const submission =
          get(

            `SELECT *
             FROM dailyfact_submissions
             WHERE id = ?`,

            [submissionId]
          );

        if (!submission) {

          return interaction.reply({
            content: 'Submission not found.',
            flags: MessageFlags.Ephemeral
          });
        }

        if (submission.status !== 'PENDING') {

          return interaction.reply({
            content: `Already ${submission.status}.`,
            flags: MessageFlags.Ephemeral
          });
        }

        if (action === 'edit' || action === 'verify') {

          const modal =
            new ModalBuilder()

              .setCustomId(
                `dailyfact_${action === 'verify' ? 'verifymodal' : 'editmodal'}_${submissionId}`
              )

              .setTitle(
                'Edit & Approve Daily Fact'
              );

          const input =
            new TextInputBuilder()

              .setCustomId('fact')

              .setLabel('Daily Fact')

              .setStyle(TextInputStyle.Paragraph)

              .setRequired(true)

              .setMinLength(20)

              .setMaxLength(500)

              .setValue(submission.fact);

          modal.addComponents(

            new ActionRowBuilder()
              .addComponents(input)
          );
          const sourceInput = new TextInputBuilder().setCustomId('source').setLabel('Authoritative HTTPS source')
            .setStyle(TextInputStyle.Short).setRequired(action === 'verify').setMaxLength(800);
          if (submission.sourceUrl) sourceInput.setValue(submission.sourceUrl);
          modal.addComponents(new ActionRowBuilder().addComponents(sourceInput));
          if (action === 'verify') {
            modal.setTitle('Verify & Approve Fact').addComponents(new ActionRowBuilder().addComponents(
              new TextInputBuilder().setCustomId('checklist').setLabel('Type CHECKED after completing the checklist')
                .setPlaceholder('Claim, context, date, and authoritative publisher checked')
                .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(7)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('note')
              .setLabel('Private verification note').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500)));
          }

          return await interaction.showModal(modal);
        }

        await interaction.deferUpdate();

        if (action === 'approve') {

          return await approveSubmission({
            interaction,
            submission
          });
        }

        if (action === 'deny') {

          return await denySubmission(
            interaction,
            submission
          );
        }

        return null;
      }

      if (
        interaction.type === InteractionType.ModalSubmit &&
        /^dailyfact_(editmodal|verifymodal)_/.test(interaction.customId)
      ) {

        await interaction.deferUpdate();

        const submissionId =
          submissionIdFromCustomId(
            interaction.customId
          );

        const editedFact =
          cleanFact(
            interaction.fields.getTextInputValue(
              'fact'
            )
          );
        if (editedFact.length < 20 || editedFact.length > 500 || !normalizeFact(editedFact)) {
          return await interaction.followUp({ content: 'Enter a fact between 20 and 500 characters.',
            flags: MessageFlags.Ephemeral });
        }

        const submission =
          get(

            `SELECT *
             FROM dailyfact_submissions
             WHERE id = ?`,

            [submissionId]
          );

        if (!submission) {

          return interaction.followUp({
            content: 'Submission not found.',
            flags: MessageFlags.Ephemeral
          });
        }

        if (submission.status !== 'PENDING') {

          return interaction.followUp({
            content: `Already ${submission.status}.`,
            flags: MessageFlags.Ephemeral
          });
        }

        const verifying = interaction.customId.startsWith('dailyfact_verifymodal_');
        const sourceUrl = validateSourceUrl(interaction.fields.getTextInputValue('source'));
        if (verifying && (!sourceUrl || interaction.fields.getTextInputValue('checklist').trim().toUpperCase() !== 'CHECKED')) {
          return interaction.followUp({ content: 'Provide a source and complete the review checklist before verifying.', flags: MessageFlags.Ephemeral });
        }
        Object.assign(submission, { sourceUrl, verifiedAt: verifying ? Date.now() : null,
          verifiedBy: verifying ? interaction.user.id : null,
          verificationNote: verifying ? interaction.fields.getTextInputValue('note').trim() || null : null });

        return await approveSubmission({
          interaction,
          submission,
          fact: editedFact
        });
      }

      return null;

    } catch (err) {

      console.error(
        'DailyFactInteraction Error:',
        err
      );

      const submissionId = submissionIdFromCustomId(interaction.customId || '');
      if (Number.isSafeInteger(submissionId)) {
        run(
          `UPDATE dailyfact_submissions
           SET status = 'PENDING', reviewerId = NULL, decisionAt = NULL
           WHERE id = ? AND status = 'REVIEWING' AND reviewerId = ?`,
          [submissionId, interaction.user?.id]
        );
      }

      if (
        interaction.deferred ||
        interaction.replied
      ) {

        return interaction.followUp({
          content:
            'Something went wrong while reviewing that daily fact.',
          flags: MessageFlags.Ephemeral
        }).catch(() => null);
      }

      return interaction.reply({
        content:
          'Something went wrong while reviewing that daily fact.',
        flags: MessageFlags.Ephemeral
      }).catch(() => null);
    }
  },

  recoverStaleDailyFactReviews
};

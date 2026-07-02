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
  get,
  run
} = require('../database');

const {
  categoryName,
  cleanFact,
  findDuplicateFact,
  normalizeFact
} = require('../utils/dailyFacts');

function submissionIdFromCustomId(customId) {

  return Number(
    customId.split('_').at(-1)
  );
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

  const user =
    await client.users.fetch(
      submission.userId
    ).catch(() => null);

  if (!user) {
    return;
  }

  await user.send({

    embeds: [

      new EmbedBuilder()

        .setColor(color)

        .setTitle(title)

        .setDescription(description)

        .addFields(

          {
            name: 'Category',
            value: categoryName(submission.category),
            inline: true
          },

          {
            name: 'Submission ID',
            value: `#${submission.id}`,
            inline: true
          },

          {
            name: 'Fact',
            value: fact
          }
        )

        .setTimestamp()
    ]
  }).catch(() => {});
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
     WHERE id = ?`,

    [
      'DUPLICATE',
      interaction.user.id,
      Date.now(),
      duplicate.source === 'submission'
        ? `submission:${duplicate.id}`
        : `coded:${duplicate.category}`,
      submission.id
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

  return interaction.message.edit({

    embeds: [
      updateReviewEmbed(
        interaction.message,
        {
          color: 0xFEE75C,
          footer: `Duplicate marked by ${interaction.user.tag}`,
          fact,
          statusField:
            `Matched: ${duplicate.source === 'coded' ? 'coded fact' : `submission #${duplicate.id}`}`
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

  run(

    `UPDATE dailyfact_submissions
     SET fact = ?,
         normalizedFact = ?,
         status = ?,
         reviewerId = ?,
         approvedAt = ?,
         decisionAt = ?
     WHERE id = ?`,

    [
      fact,
      normalizeFact(fact),
      'APPROVED',
      interaction.user.id,
      Date.now(),
      Date.now(),
      submission.id
    ]
  );

  await sendSubmissionDm(
    interaction.client,
    submission,
    {
      color: 0x57F287,
      title: 'Daily Fact Approved',
      description:
        'Your Daily Fact submission has been approved and added to JabsterBot daily facts.',
      fact
    }
  );

  return interaction.message.edit({

    embeds: [
      updateReviewEmbed(
        interaction.message,
        {
          color: 0x57F287,
          footer: `Approved by ${interaction.user.tag}`,
          fact
        }
      )
    ],

    components: []
  });
}

async function denySubmission(
  interaction,
  submission
) {

  run(

    `UPDATE dailyfact_submissions
     SET status = ?,
         reviewerId = ?,
         decisionAt = ?
     WHERE id = ?`,

    [
      'DENIED',
      interaction.user.id,
      Date.now(),
      submission.id
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

  return interaction.message.edit({

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

    try {

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

        if (action === 'edit') {

          const modal =
            new ModalBuilder()

              .setCustomId(
                `dailyfact_editmodal_${submissionId}`
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

          return interaction.showModal(modal);
        }

        await interaction.deferUpdate();

        if (action === 'approve') {

          return approveSubmission({
            interaction,
            submission
          });
        }

        if (action === 'deny') {

          return denySubmission(
            interaction,
            submission
          );
        }

        return null;
      }

      if (
        interaction.type === InteractionType.ModalSubmit &&
        interaction.customId.startsWith('dailyfact_editmodal_')
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

        return approveSubmission({
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
  }
};

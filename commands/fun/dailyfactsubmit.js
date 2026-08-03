const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  SlashCommandBuilder
} = require('discord.js');

const {
  run
} = require('../../database');

const {
  FACT_CATEGORIES,
  categoryName,
  cleanFact,
  findDuplicateFact,
  normalizeFact
} = require('../../utils/dailyFacts');

const REVIEW_CHANNEL_ID =
  process.env.DAILYFACT_REVIEW_CHANNEL_ID ||
  '1517165828556980295';

module.exports = {

  cooldown: 30000,

  ephemeral: true,

  data:
    new SlashCommandBuilder()

      .setName('dailyfactsubmit')

      .setDescription(
        'Submit a daily fact for review'
      )

      .addStringOption(option =>

        option

          .setName('category')

          .setDescription('Fact category')

          .setRequired(true)

          .addChoices(
            {
              name: 'Random',
              value: 'random'
            },
            ...FACT_CATEGORIES.map(category => ({
              name: category.name,
              value: category.value
            }))
          )
      )

      .addStringOption(option =>

        option

          .setName('fact')

          .setDescription(
            'The fact to submit'
          )

          .setRequired(true)

          .setMinLength(20)

          .setMaxLength(500)
      ),

  async execute(interaction) {

    const category =
      interaction.options.getString(
        'category',
        true
      );

    const fact =
      cleanFact(
        interaction.options.getString(
          'fact',
          true
        )
      );

    const duplicate =
      findDuplicateFact(fact);

    if (duplicate) {

      const duplicateText =
        duplicate.source === 'coded'
          ? 'That fact is already built into Jabster Studios.'
          : duplicate.source === 'community'
            ? 'That fact has already been approved and added to Jabster Studios.'
          : `That fact has already been submitted and is currently ${duplicate.status}.`;

      await interaction.user.send({

        embeds: [

          new EmbedBuilder()

            .setColor(0xFEE75C)

            .setTitle('Daily Fact Duplicate')

            .setDescription(
              `${duplicateText}\n\nThanks for helping grow the fact database.`
            )

            .addFields(

              {
                name: 'Your Fact',
                value: fact
              },

              {
                name: 'Matched Category',
                value: categoryName(duplicate.category),
                inline: true
              }
            )

            .setTimestamp()
        ]
      }).catch(() => {});

      return interaction.editReply({

        content:
          'That fact has already been submitted or added, so I did not send it for review. I tried to DM you the duplicate notice too.'
      });
    }

    const reviewChannel =
      await interaction.client.channels.fetch(
        REVIEW_CHANNEL_ID
      ).catch(() => null);

    if (
      !reviewChannel ||
      !reviewChannel.isTextBased()
    ) {

      return interaction.editReply({

        content:
          'Daily Fact review channel is not available right now. Please try again later.'
      });
    }

    const result =
      run(

        `INSERT INTO dailyfact_submissions (
          guildId,
          userId,
          fact,
          normalizedFact,
          category,
          submittedAt
        )
        VALUES (?, ?, ?, ?, ?, ?)`,

        [
          interaction.guild.id,
          interaction.user.id,
          fact,
          normalizeFact(fact),
          category,
          Date.now()
        ]
      );

    const submissionId =
      result.lastInsertRowid;

    const embed =
      new EmbedBuilder()

        .setColor(0x5865F2)

        .setTitle('Daily Fact Submission')

        .addFields(

          {
            name: 'Submission ID',
            value: `#${submissionId}`,
            inline: true
          },

          {
            name: 'Category',
            value: categoryName(category),
            inline: true
          },

          {
            name: 'Submitted By',
            value: `${interaction.user}`,
            inline: true
          },

          {
            name: 'Fact',
            value: fact
          }
        )

        .setFooter({
          text: `User ID: ${interaction.user.id}`
        })

        .setTimestamp();

    const row =
      new ActionRowBuilder()

        .addComponents(

          new ButtonBuilder()

            .setCustomId(
              `dailyfact_approve_${submissionId}`
            )

            .setLabel('Approve')

            .setStyle(ButtonStyle.Success),

          new ButtonBuilder()

            .setCustomId(
              `dailyfact_edit_${submissionId}`
            )

            .setLabel('Edit & Approve')

            .setStyle(ButtonStyle.Primary),

          new ButtonBuilder()

            .setCustomId(
              `dailyfact_deny_${submissionId}`
            )

            .setLabel('Deny')

            .setStyle(ButtonStyle.Danger)
        );

    const reviewMessage =
      await reviewChannel.send({
        embeds: [embed],
        components: [row]
      });

    run(

      `UPDATE dailyfact_submissions
       SET reviewMessageId = ?
       WHERE id = ?`,

      [
        reviewMessage.id,
        submissionId
      ]
    );

    return interaction.editReply({

      content:
        `Daily Fact #${submissionId} submitted for review.`
    });
  }
};

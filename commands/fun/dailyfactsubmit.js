const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

const {
  get,
  run
} = require('../../database');

const REVIEW_CHANNEL_ID =
  '1517165828556980295';

module.exports = {

  cooldown: 30000,

  data:
    new SlashCommandBuilder()

      .setName(
        'dailyfactsubmit'
      )

      .setDescription(
        'Submit a daily fact for review'
      )

      .addStringOption(option =>

        option

          .setName(
            'category'
          )

          .setDescription(
            'Fact category'
          )

          .setRequired(true)

          .addChoices(

            {
              name: 'Animals',
              value: 'animals'
            },

            {
              name: 'Science',
              value: 'science'
            },

            {
              name: 'Space',
              value: 'space'
            },

            {
              name: 'History',
              value: 'history'
            },

            {
              name: 'Technology',
              value: 'technology'
            },

            {
              name: 'Geography',
              value: 'geography'
            },

            {
              name: 'Nature',
              value: 'nature'
            },

            {
              name: 'Human Body',
              value: 'humanbody'
            },

            {
              name: 'Ocean',
              value: 'ocean'
            },

            {
              name: 'Random',
              value: 'random'
            }
          )
      )

      .addStringOption(option =>

        option

          .setName(
            'fact'
          )

          .setDescription(
            'The fact to submit'
          )

          .setRequired(true)

          .setMaxLength(500)
      ),

  async execute(
    interaction
  ) {

    const category =
      interaction.options.getString(
        'category'
      );

    const fact =
      interaction.options.getString(
        'fact'
      );

    const result =
      run(

        `INSERT INTO dailyfact_submissions (

          guildId,
          userId,
          fact,
          category,
          submittedAt

        )

        VALUES (?, ?, ?, ?, ?)`,

        [

          interaction.guild.id,

          interaction.user.id,

          fact,

          category,

          Date.now()
        ]
      );

    const submissionId =
      result.lastInsertRowid;

    const reviewChannel =
      interaction.client.channels.cache.get(
        REVIEW_CHANNEL_ID
      );

    if (reviewChannel) {

      const embed =
        new EmbedBuilder()

          .setColor(
            0x5865F2
          )

          .setTitle(
            '🧠 Daily Fact Submission'
          )

          .addFields(

            {

              name: '🆔 Submission ID',

              value:
                `#${submissionId}`,

              inline: true
            },

            {

              name: '📂 Category',

              value:
                category,

              inline: true
            },

            {

              name: '👤 Submitted By',

              value:
                `${interaction.user}`,

              inline: true
            },

            {

              name: '📖 Fact',

              value:
                fact
            }
          )

          .setFooter({

            text:
              `User ID: ${interaction.user.id}`
          })

          .setTimestamp();

      const row =
        new ActionRowBuilder()

          .addComponents(

            new ButtonBuilder()

              .setCustomId(
                `dailyfact_approve_${submissionId}`
              )

              .setLabel(
                'Approve'
              )

              .setEmoji(
                '✅'
              )

              .setStyle(
                ButtonStyle.Success
              ),

            new ButtonBuilder()

              .setCustomId(
                `dailyfact_deny_${submissionId}`
              )

              .setLabel(
                'Deny'
              )

              .setEmoji(
                '❌'
              )

              .setStyle(
                ButtonStyle.Danger
              )
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
    }

    return interaction.editReply({

      content:
        `✅ Daily Fact #${submissionId} submitted for review.`
    });
  }
};
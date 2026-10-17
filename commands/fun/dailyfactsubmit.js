const { SlashCommandBuilder } = require('discord.js');
const { get, run, transaction } = require('../../database');
const { FACT_CATEGORIES, cleanFact, findDuplicateFact, isRealCategory, normalizeFact } = require('../../utils/dailyFacts');
const { notifyFactSubmitter, queueFactReview, tryDailyDelivery } = require('../../utils/dailyFactReview');
const { validateSourceUrl } = require('../../utils/factSources');

module.exports = {
  cooldown: 30000,
  ephemeral: true,
  data: new SlashCommandBuilder().setName('dailyfactsubmit').setDescription('Submit a daily fact for review')
    .addStringOption(option => option.setName('category').setDescription('Fact category').setRequired(true)
      .addChoices({ name: 'Random', value: 'random' }, ...FACT_CATEGORIES))
    .addStringOption(option => option.setName('fact').setDescription('The fact to submit')
      .setRequired(true).setMinLength(20).setMaxLength(500))
    .addStringOption(option => option.setName('source').setDescription('Authoritative HTTPS page supporting this fact')
      .setMaxLength(800)),

  async execute(interaction) {
    const category = interaction.options.getString('category', true);
    const fact = cleanFact(interaction.options.getString('fact', true));
    let sourceUrl;
    try { sourceUrl = validateSourceUrl(interaction.options.getString('source')); }
    catch (error) { return interaction.editReply({ content: error.message }); }
    if ((category !== 'random' && !isRealCategory(category)) || fact.length < 20 || fact.length > 500 || !normalizeFact(fact)) {
      return interaction.editReply({ content: 'Choose a valid category and enter a fact between 20 and 500 characters.' });
    }

    const result = transaction(() => {
      const duplicate = findDuplicateFact(fact);
      if (duplicate) return { duplicate };
      const inserted = run(`INSERT INTO dailyfact_submissions
        (guildId, userId, fact, normalizedFact, category, submittedAt, sourceUrl) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [interaction.guild.id, interaction.user.id, fact, normalizeFact(fact), category, Date.now(), sourceUrl]);
      const submission = get('SELECT * FROM dailyfact_submissions WHERE id = ?', [inserted.lastInsertRowid]);
      return { submission, queued: queueFactReview(submission) };
    });

    if (result.duplicate) {
      await notifyFactSubmitter(interaction.client,
        { guildId: interaction.guild.id, userId: interaction.user.id, category, fact }, {
          color: 0xFEE75C, title: 'Daily Fact Duplicate',
          description: 'That fact has already been submitted or added to Jabster Studios. Thanks for helping grow the fact database.'
        });
      return interaction.editReply({ content: 'That fact has already been submitted or added. I tried to DM you a duplicate notice too.' });
    }

    const delivered = await tryDailyDelivery(interaction.client, result.queued);
    return interaction.editReply({ content: delivered?.status === 'SENT'
      ? `Daily Fact #${result.submission.id} submitted for review.`
      : `Daily Fact #${result.submission.id} saved. Delivery to the review channel is queued for retry.` });
  }
};

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { categoryName } = require('./dailyFacts');
const { attemptDailyDelivery, newDailyKey, queueDailyDelivery } = require('./dailyDelivery');

function reviewChannelId() {
  return process.env.DAILYFACT_REVIEW_CHANNEL_ID || '1517165828556980295';
}

function queueFactReview(submission, { recoverExisting = false } = {}) {
  const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('Daily Fact Submission')
    .addFields(
      { name: 'Submission ID', value: `#${submission.id}`, inline: true },
      { name: 'Category', value: categoryName(submission.category), inline: true },
      { name: 'Submitted By', value: `<@${submission.userId}>`, inline: true },
      { name: 'Fact', value: String(submission.fact || 'No fact content').slice(0, 1024) }
    ).addFields(...require('./factSources').sourceFields(submission), {
      name: 'Verification Checklist', value: 'Open the source; confirm it supports the exact claim; check context and date; check the publisher is authoritative. Use Verify & Approve to record completion.'
    }).setFooter({ text: `User ID: ${submission.userId}` }).setTimestamp();
  const buttons = [
    ['approve', 'Approve', ButtonStyle.Success],
    ['edit', 'Edit & Approve', ButtonStyle.Primary],
    ['verify', 'Verify & Approve', ButtonStyle.Primary],
    ['deny', 'Deny', ButtonStyle.Danger]
  ].map(([action, label, style]) => new ButtonBuilder()
    .setCustomId(`dailyfact_${action}_${submission.id}`).setLabel(label).setStyle(style));
  return queueDailyDelivery({ deliveryKey: `daily-fact-review:${submission.id}`,
    type: 'DAILY_FACT_REVIEW', guildId: submission.guildId, channelId: reviewChannelId(),
    message: { embeds: [embed], components: [new ActionRowBuilder().addComponents(buttons)],
      allowedMentions: { parse: [] } }, metadata: { submissionId: submission.id, recoverExisting } });
}

function queueMissingFactReviews() {
  const { all } = require('../database');
  const rows = all(`SELECT * FROM dailyfact_submissions submission
    WHERE status = 'PENDING' AND reviewMessageId IS NULL AND NOT EXISTS (
      SELECT 1 FROM delivery_outbox WHERE deliveryKey = 'daily-fact-review:' || submission.id)
    ORDER BY submittedAt ASC LIMIT 100`);
  for (const row of rows) queueFactReview(row, { recoverExisting: true });
}

async function tryDailyDelivery(client, row) {
  try { return await attemptDailyDelivery(client, row); }
  catch (error) {
    console.error(`Daily fact notification queued for retry (${row.deliveryKey}):`, error.message);
    return null;
  }
}

async function notifyFactSubmitter(client, submission, { color, title, description, fact = submission.fact }) {
  const status = title.toLowerCase().replace(/\s+/g, '-');
  const embed = new EmbedBuilder().setColor(color).setTitle(title).setDescription(description)
    .addFields({ name: 'Category', value: categoryName(submission.category), inline: true },
      { name: 'Fact', value: fact }).setTimestamp();
  if (submission.id) embed.addFields({ name: 'Submission ID', value: `#${submission.id}`, inline: true });
  const row = queueDailyDelivery({
    deliveryKey: submission.id ? `daily-fact-notice:${submission.id}:${status}` : newDailyKey('daily-fact-duplicate'),
    type: 'DAILY_FACT_DM', guildId: submission.guildId,
    message: { embeds: [embed], allowedMentions: { parse: [] } }, metadata: { userId: submission.userId }
  });
  return tryDailyDelivery(client, row);
}

async function updateFactReview(interaction, message) {
  const row = queueDailyDelivery({ deliveryKey: `daily-fact-review-update:${interaction.message.id}`,
    type: 'DAILY_FACT_REVIEW_UPDATE', guildId: interaction.guildId || interaction.guild.id,
    channelId: reviewChannelId(), message: { ...message, allowedMentions: { parse: [] } },
    metadata: { editMessageId: interaction.message.id } });
  return tryDailyDelivery(interaction.client, row);
}

module.exports = { notifyFactSubmitter, queueFactReview, queueMissingFactReviews, reviewChannelId, tryDailyDelivery, updateFactReview };

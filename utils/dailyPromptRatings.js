const { EmbedBuilder } = require('discord.js');
const { get, run, transaction } = require('../database');
const { queueDailyDelivery, attemptDailyDelivery } = require('./dailyDelivery');
const { reviewChannelId } = require('./dailyFactReview');

function savePromptRating(post, userId, rating, now = Date.now()) {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new Error('Choose a rating from 1 to 5.');
  if (!post || now < post.sentAt || now >= post.sentAt + 86_400_000) throw new Error('This activity has closed.');
  return transaction(() => {
    const saved = run(`INSERT OR IGNORE INTO daily_prompt_ratings (messageId, userId, guildId, rating, createdAt)
      VALUES (?, ?, ?, ?, ?)`, [post.messageId, userId, post.guildId, rating, now]);
    if (!saved.changes) return null;
    const totals = get('SELECT COUNT(*) AS count, AVG(rating) AS average FROM daily_prompt_ratings WHERE messageId = ?', [post.messageId]);
    return queueDailyDelivery({ deliveryKey: `daily-prompt-rating:${post.messageId}:${userId}`,
      type: 'DAILY_PROMPT_RATING', guildId: post.guildId, channelId: reviewChannelId(),
      metadata: { postId: post.messageId, userId }, message: {
        embeds: [new EmbedBuilder().setTitle('Daily Interaction Feedback').setColor(0x57F287)
          .setDescription(post.prompt).addFields(
            { name: 'Rating', value: `${rating}/5`, inline: true },
            { name: 'Activity Average At Submission', value: `${totals.average.toFixed(2)}/5 (${totals.count} ratings)`, inline: true },
            { name: 'Member', value: `<@${userId}> (${userId})` },
            { name: 'Activity', value: `[View original](https://discord.com/channels/${post.guildId}/${post.channelId}/${post.messageId})\nType: ${post.type}\nServer: ${post.guildId}` })
          .setFooter({ text: 'Jabster Studios | Private prompt feedback' }).setTimestamp(now)], allowedMentions: { parse: [] } } });
  });
}

async function handlePromptRating(interaction, post) {
  await interaction.deferReply({ flags: require('discord.js').MessageFlags.Ephemeral });
  if (interaction.channelId !== post.channelId || interaction.message.author?.id !== interaction.client.user.id) {
    return interaction.editReply({ content: 'Use the rating menu on the original activity.' });
  }
  const member = await interaction.guild.members.fetch(interaction.user.id);
  if (!interaction.channel.permissionsFor(member)?.has(['ViewChannel', 'ReadMessageHistory'])) {
    return interaction.editReply({ content: 'You cannot access this activity.' });
  }
  const row = savePromptRating(post, interaction.user.id, Number(interaction.values[0]));
  if (!row) return interaction.editReply({ content: 'You have already rated this activity. Thank you.' });
  await attemptDailyDelivery(interaction.client, row).catch(error => console.error('Daily feedback queued:', error.message));
  return interaction.editReply({ content: 'Thank you. Your rating has been saved for the bot owner to review.' });
}

module.exports = { handlePromptRating, savePromptRating };

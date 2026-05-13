const {
  EmbedBuilder,
  SlashCommandBuilder
} = require('discord.js');

// 🎯 Rating reactions
function getReaction(score) {
  if (score >= 90) return '🔥 God Tier';
  if (score >= 75) return '💎 Amazing';
  if (score >= 60) return '👍 Pretty Good';
  if (score >= 40) return '😐 Mid';
  if (score >= 20) return '💀 Bad';
  return '🚮 Terrible';
}

// 🎨 Color logic
function getColor(score) {
  if (score >= 75) return 0x57F287; // green
  if (score >= 40) return 0xF1C40F; // yellow
  return 0xED4245; // red
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rate')
    .setDescription('Rate anything out of 100')
    .addStringOption(option =>
      option
        .setName('thing')
        .setDescription('What do you want rated?')
        .setRequired(true)
        .setMaxLength(100)
    ),

  async execute(interaction) {
    try {
      const thing = interaction.options.getString('thing', true);

      // ⚡ Optional "thinking" effect (feels nicer)
      await interaction.editReply({ content: '🤔 Calculating rating...' });

      await new Promise(res => setTimeout(res, 800));

      // 🎲 Slightly weighted randomness (feels less fake)
      const score = Math.floor(
        Math.random() * 60 + // base range
        Math.random() * 40   // adds variation
      );

      const reaction = getReaction(score);
      const color = getColor(score);

      const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle('⭐ Rating Machine')
        .setDescription(`**${thing}**`)
        .addFields(
          {
            name: '📊 Score',
            value: `\`${score}/100\``,
            inline: true
          },
          {
            name: '🏆 Verdict',
            value: reaction,
            inline: true
          }
        )
        .setFooter({ text: 'Totally accurate rating system...' })
        .setTimestamp();

      return interaction.editReply({
        content: null,
        embeds: [embed]
      });

    } catch (err) {
      console.error('Rate Command Error:', err);

      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({
          content: '❌ Failed to rate.'
        });
      } else {
        return interaction.reply({
          content: '❌ Failed to rate.',
          flags: 64
        });
      }
    }
  }
};
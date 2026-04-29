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
      // ✅ Ensure reply exists
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply();
      }

      const thing = interaction.options.getString('thing', true);

      const score = Math.floor(Math.random() * 101);
      const reaction = getReaction(score);

      // 🎨 Color based on score
      let color = 0x5865F2; // default
      if (score >= 75) color = 0x57F287;
      else if (score >= 40) color = 0xF1C40F;
      else color = 0xED4245;

      const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle('⭐ Rating Machine')
        .addFields(
          {
            name: 'Item',
            value: thing
          },
          {
            name: 'Score',
            value: `\`${score}/100\``,
            inline: true
          },
          {
            name: 'Verdict',
            value: reaction,
            inline: true
          }
        )
        .setFooter({ text: 'Totally accurate rating system...' })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });

    } catch (err) {
      console.error('Rate Command Error:', err);

      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({
          content: '❌ Failed to rate.'
        });
      } else {
        return interaction.reply({
          content: '❌ Failed to rate.',
          ephemeral: true
        });
      }
    }
  }
};
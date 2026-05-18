const {
  EmbedBuilder,
  SlashCommandBuilder
} = require('discord.js');

// 🎯 Rating reactions
function getReaction(score) {

  if (score === 100) return '👑 PERFECT';
  if (score >= 90) return '🔥 God Tier';
  if (score >= 75) return '💎 Amazing';
  if (score >= 60) return '👍 Pretty Good';
  if (score >= 40) return '😐 Mid';
  if (score >= 20) return '💀 Bad';

  return '🚮 Terrible';
}

// 🎨 Color logic
function getColor(score) {

  if (score >= 75) return 0x57F287;
  if (score >= 40) return 0xF1C40F;

  return 0xED4245;
}

module.exports = {

  cooldown: 2500,

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

      const thing = interaction.options
        .getString('thing', true)
        .replace(/@/g, '@\u200b');

      // ⚡ UX
      await interaction.editReply({
        content: '🤔 Calculating rating...'
      });

      await new Promise(res => setTimeout(res, 800));

      // 🎲 Better weighted randomness
      const score = Math.floor(
        Math.pow(Math.random(), 0.7) * 101
      );

      const reaction = getReaction(score);
      const color = getColor(score);

      const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle('⭐ Rating Machine')
        .setDescription(`## ${thing}`)
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
        .setFooter({
          text: 'Totally accurate rating system...'
        })
        .setTimestamp();

      return interaction.editReply({
        content: '',
        embeds: [embed]
      });

    } catch (err) {

      console.error('Rate Command Error:', err);

      if (interaction.deferred || interaction.replied) {

        return interaction.editReply({
          content: '❌ Failed to rate.'
        });
      }

      return interaction.reply({
        content: '❌ Failed to rate.',
        ephemeral: true
      });
    }
  }
};
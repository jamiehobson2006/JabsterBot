const {
  EmbedBuilder,
  SlashCommandBuilder
} = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('coinflip')
    .setDescription('Flip a coin')
    .addStringOption(option =>
      option
        .setName('guess')
        .setDescription('Choose heads or tails (optional)')
        .setRequired(false)
        .addChoices(
          { name: 'Heads', value: 'heads' },
          { name: 'Tails', value: 'tails' }
        )
    ),

  async execute(interaction) {
    try {
      // ✅ Ensure reply exists
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply();
      }

      const guess = interaction.options.getString('guess');

      // 🎲 Flip
      const result = Math.random() < 0.5 ? 'heads' : 'tails';

      let outcomeText = '';
      let color = 0xF1C40F; // gold default

      if (guess) {
        const win = guess === result;

        if (win) {
          outcomeText = `🎉 You guessed **${guess}** and got it right!`;
          color = 0x57F287; // green
        } else {
          outcomeText = `💀 You guessed **${guess}** but it landed on **${result}**.`;
          color = 0xED4245; // red
        }
      } else {
        outcomeText = `The coin landed on **${result.toUpperCase()}**.`;
      }

      // 🎨 Embed
      const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle('🪙 Coin Flip')
        .setDescription(
          `🪙 Result: **${result.toUpperCase()}**\n\n${outcomeText}`
        )
        .setFooter({ text: 'Heads or tails?' })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });

    } catch (err) {
      console.error('Coinflip Error:', err);

      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({
          content: '❌ Coinflip failed.'
        });
      } else {
        return interaction.reply({
          content: '❌ Coinflip failed.',
          ephemeral: true
        });
      }
    }
  }
};
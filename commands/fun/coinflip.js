const {
  EmbedBuilder,
  SlashCommandBuilder
} = require('discord.js');

module.exports = {

  cooldown: 2000,

  data: new SlashCommandBuilder()
    .setName('coinflip')
    .setDescription('Flip a coin')

    .addStringOption(option =>
      option
        .setName('guess')
        .setDescription('Choose heads or tails (optional)')
        .addChoices(
          { name: 'Heads', value: 'heads' },
          { name: 'Tails', value: 'tails' }
        )
    ),

  async execute(interaction) {

    try {

      const guess =
        interaction.options.getString('guess');

      // 🎲 Flip
      const result =
        Math.random() < 0.5
          ? 'heads'
          : 'tails';

      // 🎭 Emoji
      const coinEmoji =
        result === 'heads'
          ? '🪙'
          : '💿';

      let outcomeText;
      let color = 0xF1C40F;

      // ========================
      // 🎯 GUESS CHECK
      // ========================

      if (guess) {

        const win = guess === result;

        if (win) {

          outcomeText =
            `🎉 You guessed **${guess}** and got it right!`;

          color = 0x57F287;

        } else {

          outcomeText =
            `💀 You guessed **${guess}** but it landed on **${result}**.`;

          color = 0xED4245;
        }

      } else {

        outcomeText =
          `The coin landed on **${result.toUpperCase()}**.`;
      }

      // ========================
      // 🎨 EMBED
      // ========================

      const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle('🪙 Coin Flip')
        .setThumbnail(
          interaction.user.displayAvatarURL()
        )
        .setDescription(
          `${coinEmoji} **Result:** ${result.toUpperCase()}\n\n${outcomeText}`
        )
        .setFooter({
          text: 'Heads or tails?'
        })
        .setTimestamp();

      return interaction.editReply({
        embeds: [embed]
      });

    } catch (err) {

      console.error('Coinflip Error:', err);

      if (interaction.deferred || interaction.replied) {

        return interaction.editReply({
          content: '❌ Coinflip failed.'
        });
      }

      return interaction.reply({
        content: '❌ Coinflip failed.',
        ephemeral: true
      });
    }
  }
};
const {

  EmbedBuilder,

  SlashCommandBuilder

} = require('discord.js');

module.exports = {

  cooldown: 2000,

  data:
    new SlashCommandBuilder()

      .setName('coinflip')

      .setDescription(
        'Flip a coin'
      )

      .addStringOption(option =>

        option

          .setName('guess')

          .setDescription(
            'Choose heads or tails (optional)'
          )

          .addChoices(

            {

              name: 'Heads',

              value: 'heads'
            },

            {

              name: 'Tails',

              value: 'tails'
            }
          )
      ),

  async execute(interaction) {

    try {

      // ==========================================
      // 🎯 USER GUESS
      // ==========================================
      const guess =
        interaction.options.getString(
          'guess'
        );

      // ==========================================
      // ⏳ FLIP DELAY
      // ==========================================
      await new Promise(res =>
        setTimeout(res, 1000)
      );

      // ==========================================
      // 🎲 RESULT
      // ==========================================
      const result =

        Math.random() < 0.5

          ? 'heads'

          : 'tails';

      // ==========================================
      // 🎨 RESULT DATA
      // ==========================================
      const resultEmoji =

        result === 'heads'

          ? '🪙'

          : '🎯';

      let color = 0xFEE75C;

      let statusText;

      // ==========================================
      // 🎯 GUESS CHECK
      // ==========================================
      if (guess) {

        const won =
          guess === result;

        if (won) {

          color = 0x57F287;

          statusText =

            `🎉 You guessed **${guess}** and got it right!`;

        } else {

          color = 0xED4245;

          statusText =

            `💀 You guessed **${guess}** but it landed on **${result}**.`;
        }

      } else {

        statusText =

          `The coin landed on **${result.toUpperCase()}**.`;
      }

      // ==========================================
      // 🎨 EMBED
      // ==========================================
      const embed =
        new EmbedBuilder()

          .setColor(color)

          .setTitle(
            '🪙 Coin Flip'
          )

          .setDescription(

            `# ${resultEmoji} ${result.toUpperCase()}\n\n` +

            `${statusText}`
          )

          .addFields({

            name: '🎲 Result',

            value:
              result.toUpperCase(),

            inline: true
          })

          .setThumbnail(
            interaction.user.displayAvatarURL({

              size: 256
            })
          )

          .setFooter({

            text:
              'Heads or tails?'
          })

          .setTimestamp();

      // ==========================================
      // 📤 RESPONSE
      // ==========================================
      return interaction.editReply({

        embeds: [embed]
      });

    } catch (err) {

      console.error(
        'Coinflip Error:',
        err
      );

      if (

        interaction.deferred ||

        interaction.replied
      ) {

        return interaction.editReply({

          content:
            '❌ Coinflip failed.'
        });
      }

      return interaction.reply({

        content:
          '❌ Coinflip failed.',

        ephemeral: true
      });
    }
  }
};
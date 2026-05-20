const {

  EmbedBuilder,

  SlashCommandBuilder

} = require('discord.js');

// ==================================================
// 🎯 REACTIONS
// ==================================================
function getReaction(score) {

  if (score === 100) {

    return '👑 PERFECT';
  }

  if (score >= 90) {

    return '🔥 Legendary';
  }

  if (score >= 75) {

    return '💎 Amazing';
  }

  if (score >= 60) {

    return '👍 Pretty Good';
  }

  if (score >= 40) {

    return '😐 Average';
  }

  if (score >= 20) {

    return '💀 Rough';
  }

  return '🚮 Terrible';
}

// ==================================================
// 🎨 COLORS
// ==================================================
function getColor(score) {

  if (score >= 75) {

    return 0x57F287;
  }

  if (score >= 40) {

    return 0xFEE75C;
  }

  return 0xED4245;
}

// ==================================================
// 🎲 SCORE GENERATOR
// ==================================================
function generateScore() {

  // ==============================================
  // 🌟 RARE PERFECT
  // ==============================================
  if (Math.random() < 0.01) {

    return 100;
  }

  // ==============================================
  // 💀 RARE ZERO
  // ==============================================
  if (Math.random() < 0.01) {

    return 0;
  }

  // ==============================================
  // 🎯 WEIGHTED SCORE
  // ==============================================
  return Math.floor(

    (Math.random() + Math.random()) *

    50
  );
}

module.exports = {

  cooldown: 2500,

  data:
    new SlashCommandBuilder()

      .setName('rate')

      .setDescription(
        'Rate anything out of 100'
      )

      .addStringOption(option =>

        option

          .setName('thing')

          .setDescription(
            'What do you want rated?'
          )

          .setRequired(true)

          .setMaxLength(100)
      ),

  async execute(interaction) {

    try {

      // ==========================================
      // 📥 INPUT
      // ==========================================
      const thing =
        interaction.options

          .getString(
            'thing',
            true
          )

          .replace(/@/g, '@\u200b');

      // ==========================================
      // ⚡ UX
      // ==========================================
      await interaction.editReply({

        content:
          '🤔 Calculating rating...'
      });

      await new Promise(res =>
        setTimeout(res, 900)
      );

      // ==========================================
      // 🎲 SCORE
      // ==========================================
      const score =
        generateScore();

      const reaction =
        getReaction(score);

      const color =
        getColor(score);

      // ==========================================
      // 🎨 EMBED
      // ==========================================
      const embed =
        new EmbedBuilder()

          .setColor(color)

          .setTitle(
            '⭐ Rating Machine'
          )

          .setDescription(

            `## ${thing}\n\n` +

            `### 📊 ${score}/100\n` +

            `${reaction}`
          )

          .addFields({

            name: '📈 Verdict',

            value:
              reaction,

            inline: true
          })

          .setFooter({

            text:
              'Totally scientific rating system.'
          })

          .setTimestamp();

      // ==========================================
      // 📤 RESPONSE
      // ==========================================
      return interaction.editReply({

        content: '',

        embeds: [embed]
      });

    } catch (err) {

      console.error(
        'Rate Command Error:',
        err
      );

      if (

        interaction.deferred ||

        interaction.replied
      ) {

        return interaction.editReply({

          content:
            '❌ Failed to rate.'
        });
      }

      return interaction.reply({

        content:
          '❌ Failed to rate.',

        ephemeral: true
      });
    }
  }
};
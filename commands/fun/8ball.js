const {

  EmbedBuilder,

  SlashCommandBuilder

} = require('discord.js');

// ==================================================
// 🎱 RESPONSES
// ==================================================
const responses = {

  positive: [

    'Yes.',
    'Definitely!',
    'Without a doubt.',
    'Signs point to yes.',
    'It is certain.',
    'Outlook good.',
    'Absolutely.',
    'You can count on it.',
    'The odds are in your favor.'
  ],

  neutral: [

    'Maybe...',
    'Ask again later.',
    'Better not tell you now.',
    'Possibly.',
    'The future is unclear.',
    'I cannot predict that yet.',
    'Concentrate and ask again.',
    'The answer is hidden.'
  ],

  negative: [

    'No.',
    'I doubt it.',
    'Very unlikely.',
    'Don’t count on it.',
    'My sources say no.',
    'No chance.',
    'Outlook not so good.',
    'Highly doubtful.'
  ]
};

// ==================================================
// 🎲 WEIGHTED RESPONSE
// ==================================================
function getRandomResponse() {

  const roll =
    Math.random();

  let category;

  // ==============================================
  // 🎯 WEIGHTS
  // ==============================================
  if (roll < 0.50) {

    category = 'neutral';

  } else if (roll < 0.80) {

    category = 'positive';

  } else {

    category = 'negative';
  }

  const pool =
    responses[category];

  const response =
    pool[
      Math.floor(
        Math.random() * pool.length
      )
    ];

  return {

    category,

    response
  };
}

// ==================================================
// 🎨 CATEGORY COLORS
// ==================================================
function getColor(category) {

  switch (category) {

    case 'positive':
      return 0x57F287;

    case 'negative':
      return 0xED4245;

    default:
      return 0xFEE75C;
  }
}

module.exports = {

  cooldown: 3000,

  data:
    new SlashCommandBuilder()

      .setName('8ball')

      .setDescription(
        'Ask the magic 8-ball a question'
      )

      .addStringOption(option =>

        option

          .setName('question')

          .setDescription(
            'Your question'
          )

          .setRequired(true)

          .setMaxLength(200)
      ),

  async execute(interaction) {

    try {

      // ==========================================
      // ❓ QUESTION
      // ==========================================
      const question =
        interaction.options.getString(

          'question',

          true
        );

      // ==========================================
      // 🎲 RESPONSE
      // ==========================================
      const result =
        getRandomResponse();

      // ==========================================
      // ⏳ SMALL DELAY
      // ==========================================
      await new Promise(res =>
        setTimeout(res, 1200)
      );

      // ==========================================
      // 🎨 EMBED
      // ==========================================
      const embed =
        new EmbedBuilder()

          .setColor(
            getColor(
              result.category
            )
          )

          .setTitle(
            '🎱 Magic 8-Ball'
          )

          .setDescription(

            `## ❓ Question\n` +

            `${question}\n\n` +

            `## 🔮 Answer\n` +

            `*${result.response}*`
          )

          .setThumbnail(
            interaction.user.displayAvatarURL({

              size: 256
            })
          )

          .setFooter({

            text:
              'The 8-ball sees all... maybe.'
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
        '8Ball Error:',
        err
      );

      if (

        interaction.deferred ||

        interaction.replied
      ) {

        return interaction.editReply({

          content:
            '❌ The 8-ball broke... try again.'
        });
      }

      return interaction.reply({

        content:
          '❌ The 8-ball broke... try again.',

        ephemeral: true
      });
    }
  }
};
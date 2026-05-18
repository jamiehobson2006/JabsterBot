const {
  EmbedBuilder,
  SlashCommandBuilder
} = require('discord.js');

// 🎱 Responses
const responses = {
  positive: [
    'Yes.',
    'Definitely!',
    'Without a doubt.',
    'Signs point to yes.',
    'It is certain.',
    'Outlook good.',
    'Absolutely.'
  ],

  neutral: [
    'Maybe...',
    'Ask again later.',
    'Better not tell you now.',
    'Possibly.',
    'The future is unclear.'
  ],

  negative: [
    'No.',
    'I doubt it.',
    'Very unlikely.',
    'Don’t count on it.',
    'My sources say no.',
    'No chance.'
  ]
};

function getRandomResponse() {

  const categories = Object.values(responses);

  const pool =
    categories[Math.floor(Math.random() * categories.length)];

  return pool[Math.floor(Math.random() * pool.length)];
}

module.exports = {

  cooldown: 3000,

  data: new SlashCommandBuilder()
    .setName('8ball')
    .setDescription('Ask the magic 8-ball a question')

    .addStringOption(option =>
      option
        .setName('question')
        .setDescription('Your question')
        .setRequired(true)
        .setMaxLength(200)
    ),

  async execute(interaction) {

    try {

      const question = interaction.options.getString(
        'question',
        true
      );

      const answer = getRandomResponse();

      const embed = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle('🎱 Magic 8-Ball')
        .setThumbnail(
          interaction.user.displayAvatarURL()
        )
        .addFields(
          {
            name: '❓ Question',
            value: question
          },
          {
            name: '🔮 Answer',
            value: `*${answer}*`
          }
        )
        .setFooter({
          text: 'The 8-ball never lies... probably.'
        })
        .setTimestamp();

      return interaction.editReply({
        embeds: [embed]
      });

    } catch (err) {

      console.error('8Ball Error:', err);

      if (interaction.deferred || interaction.replied) {

        return interaction.editReply({
          content: '❌ The 8-ball broke... try again.'
        });
      }

      return interaction.reply({
        content: '❌ The 8-ball broke... try again.',
        ephemeral: true
      });
    }
  }
};
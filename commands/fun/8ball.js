const {
  EmbedBuilder,
  SlashCommandBuilder
} = require('discord.js');

// 🎱 Responses
const responses = [
  'Yes.',
  'No.',
  'Maybe...',
  'Definitely!',
  'I doubt it.',
  'Ask again later.',
  'Without a doubt.',
  'Very unlikely.',
  'Signs point to yes.',
  'Don’t count on it.',
  'It is certain.',
  'My sources say no.',
  'Outlook good.',
  'Better not tell you now.',
  'Absolutely.',
  'No chance.'
];

module.exports = {
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
      // ✅ Ensure reply exists
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply();
      }

      const question = interaction.options.getString('question', true);

      const answer = responses[Math.floor(Math.random() * responses.length)];

      const embed = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle('Magic 8-Ball')
        .addFields(
          {
            name: 'Question',
            value: question
          },
          {
            name: 'Answer',
            value: `*${answer}*`
          }
        )
        .setFooter({ text: 'The 8-ball never lies... probably.' })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });

    } catch (err) {
      console.error('8Ball Error:', err);

      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({
          content: '❌ The 8-ball broke... try again.'
        });
      } else {
        return interaction.reply({
          content: '❌ The 8-ball broke... try again.',
          ephemeral: true
        });
      }
    }
  }
};
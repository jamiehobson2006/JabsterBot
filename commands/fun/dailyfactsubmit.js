const {
  SlashCommandBuilder
} = require('discord.js');

module.exports = {

  cooldown: 30000,

  data:
    new SlashCommandBuilder()

      .setName(
        'dailyfactsubmit'
      )

      .setDescription(
        'Submit a daily fact for review'
      )

      .addStringOption(option =>

        option

          .setName(
            'category'
          )

          .setDescription(
            'Fact category'
          )

          .setRequired(true)

          .addChoices(

            {
              name: 'Animals',
              value: 'animals'
            },

            {
              name: 'Science',
              value: 'science'
            },

            {
              name: 'Space',
              value: 'space'
            },

            {
              name: 'History',
              value: 'history'
            },

            {
              name: 'Technology',
              value: 'technology'
            },

            {
              name: 'Geography',
              value: 'geography'
            },

            {
              name: 'Nature',
              value: 'nature'
            },

            {
              name: 'Human Body',
              value: 'humanbody'
            },

            {
              name: 'Ocean',
              value: 'ocean'
            },

            {
              name: 'Random',
              value: 'random'
            }
          )
      )

      .addStringOption(option =>

        option

          .setName(
            'fact'
          )

          .setDescription(
            'The fact to submit'
          )

          .setRequired(true)

          .setMaxLength(500)
      ),

  async execute(
    interaction
  ) {

    return interaction.editReply({

      content:
        '✅ Command created successfully. Submission system coming next.'
    });
  }
};
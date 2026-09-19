const { MessageFlags } = require('discord.js');
const {
  REFRESH_TRANSCRIPT_ID,
  findTranscriptAttachment,
  transcriptButtons
} = require('../utils/tickets/transcriptDelivery');

module.exports = {
  name: 'interactionCreate',
  async execute(interaction) {
    if (!interaction.isButton() || interaction.customId !== REFRESH_TRANSCRIPT_ID) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      // Fetching the original message renews Discord's expiring attachment URL.
      const message = await interaction.message.fetch(true);
      const attachment = findTranscriptAttachment(message);
      if (!attachment) return interaction.editReply({ content: 'The transcript attachment is no longer available.' });
      const rows = message.components.filter(row => !row.components.some(button => button.customId === REFRESH_TRANSCRIPT_ID));
      await message.edit({ components: [...rows, transcriptButtons(attachment.url)] }).catch(() => null);
      const linkRow = transcriptButtons(attachment.url);
      linkRow.setComponents(linkRow.components[0]);
      return interaction.editReply({
        content: 'Your transcript link is ready.',
        components: [linkRow]
      });
    } catch (error) {
      console.error('Transcript link refresh failed:', error.message);
      return interaction.editReply({ content: 'I could not refresh the transcript link. Try again shortly.' });
    }
  }
};

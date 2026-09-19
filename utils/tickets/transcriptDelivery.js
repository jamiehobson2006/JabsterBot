const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const REFRESH_TRANSCRIPT_ID = 'ticket_transcript_refresh';

function transcriptUrl(attachmentUrl) {
  const viewer = process.env.TRANSCRIPT_VIEWER_URL;
  if (!viewer) return attachmentUrl;
  const url = new URL(viewer);
  if (url.protocol !== 'https:') throw new Error('TRANSCRIPT_VIEWER_URL must use HTTPS.');
  url.searchParams.set('url', attachmentUrl);
  return url.href;
}

function transcriptButtons(attachmentUrl) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('Open Transcript')
      .setStyle(ButtonStyle.Link)
      .setURL(transcriptUrl(attachmentUrl)),
    new ButtonBuilder()
      .setCustomId(REFRESH_TRANSCRIPT_ID)
      .setLabel('Refresh Link')
      .setStyle(ButtonStyle.Secondary)
  );
}

function findTranscriptAttachment(message) {
  return message?.attachments?.find(attachment => /\.html$/i.test(attachment.name || '')) || null;
}

async function sendTranscriptMessage(destination, payload) {
  const message = await destination.send({ ...payload, allowedMentions: { parse: [] } });
  const attachment = findTranscriptAttachment(message);
  if (attachment) {
    try {
      await message.edit({
        components: [...(payload.components || []), transcriptButtons(attachment.url)]
      });
    } catch (error) {
      // Delivery has succeeded even if Discord temporarily rejects the button edit.
      console.error('Transcript button error:', error.message);
    }
  }
  return message;
}

module.exports = { REFRESH_TRANSCRIPT_ID, findTranscriptAttachment, sendTranscriptMessage, transcriptButtons, transcriptUrl };

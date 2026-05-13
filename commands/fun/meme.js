const {
  EmbedBuilder,
  SlashCommandBuilder
} = require('discord.js');

// 🔁 Fetch with retry + timeout
async function fetchMeme(retries = 3) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch('https://meme-api.com/gimme', {
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!res.ok) throw new Error('Bad response');

    const data = await res.json();

    // ❌ Filter bad memes
    if (
      !data ||
      !data.url ||
      data.nsfw ||
      !data.url.match(/\.(jpg|jpeg|png|gif)$/i)
    ) {
      if (retries > 0) return fetchMeme(retries - 1);
      return null;
    }

    return data;

  } catch {
    if (retries > 0) return fetchMeme(retries - 1);
    return null;
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('meme')
    .setDescription('Get a random meme'),

  async execute(interaction) {
    try {
      // ❌ REMOVED deferReply (handled globally)

      // Optional: quick feedback (feels faster UX)
      await interaction.editReply({ content: '📡 Fetching a meme...' });

      const data = await fetchMeme();

      if (!data) {
        return interaction.editReply({
          content: '❌ Could not fetch a meme. Try again.'
        });
      }

      const embed = new EmbedBuilder()
        .setColor(Math.floor(Math.random() * 0xFFFFFF))
        .setTitle(data.title || '😂 Meme')
        .setImage(data.url)
        .addFields({
          name: '👍 Stats',
          value: `⬆️ ${data.ups || 0} upvotes`,
          inline: true
        })
        .setFooter({
          text: `From r/${data.subreddit} • Powered by meme-api`
        })
        .setTimestamp();

      if (data.postLink) {
        embed.setURL(data.postLink);
      }

      return interaction.editReply({
        content: null,
        embeds: [embed]
      });

    } catch (err) {
      console.error('Meme Command Error:', err);

      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({
          content: '❌ Error fetching meme.'
        });
      } else {
        return interaction.reply({
          content: '❌ Error fetching meme.',
          flags: 64
        });
      }
    }
  }
};
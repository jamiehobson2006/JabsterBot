const {
  EmbedBuilder,
  SlashCommandBuilder
} = require('discord.js');

// 🔁 Fetch with retry + timeout
async function fetchMeme(retries = 3) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000); // 5s timeout

    const res = await fetch('https://meme-api.com/gimme', {
      signal: controller.signal
    });

    clearTimeout(timeout);

    const data = await res.json();

    // ❌ Invalid / NSFW / missing image
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
      // ✅ Ensure reply exists
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply();
      }

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

      // Only set URL if valid
      if (data.postLink) {
        embed.setURL(data.postLink);
      }

      return interaction.editReply({ embeds: [embed] });

    } catch (err) {
      console.error('Meme Command Error:', err);

      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({
          content: '❌ Error fetching meme.'
        });
      } else {
        return interaction.reply({
          content: '❌ Error fetching meme.',
          ephemeral: true
        });
      }
    }
  }
};
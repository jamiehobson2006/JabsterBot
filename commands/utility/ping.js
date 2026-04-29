const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check bot latency'),

  async execute(interaction) {
    try {
      const start = Date.now();

      // ✅ Defer first
      await interaction.deferReply();

      const botLatency = Date.now() - start;
      const apiLatency = Math.round(interaction.client.ws.ping);

      // 🔥 Optional status indicator
      function getStatus(ms) {
        if (ms < 100) return '🟢 Excellent';
        if (ms < 200) return '🟡 Good';
        return '🔴 Slow';
      }

      await interaction.editReply(
        `🏓 **Pong!**\n\n` +
        `📡 Bot Latency: \`${botLatency}ms\` (${getStatus(botLatency)})\n` +
        `🌐 API Latency: \`${apiLatency}ms\` (${getStatus(apiLatency)})`
      );

    } catch (err) {
      console.error('Ping Error:', err);

      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({
          content: '❌ Ping failed.'
        });
      } else {
        return interaction.reply({
          content: '❌ Ping failed.',
          ephemeral: true
        });
      }
    }
  }
};
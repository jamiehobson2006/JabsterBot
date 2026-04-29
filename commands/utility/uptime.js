const {
  EmbedBuilder,
  SlashCommandBuilder
} = require('discord.js');

function formatUptime(ms) {
  const totalSeconds = Math.floor(ms / 1000);

  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `${days}d ${hours}h ${minutes}m ${seconds}s`;
}

function getStatus(ping) {
  if (ping < 120) return { text: '🟢 Excellent', color: 0x57F287 };
  if (ping < 250) return { text: '🟡 Good', color: 0xFEE75C };
  return { text: '🔴 Slow', color: 0xED4245 };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('uptime')
    .setDescription('Check bot uptime and performance'),

  async execute(interaction) {
    try {
      // ✅ Ensure reply exists
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply();
      }

      const uptimeMs = interaction.client.uptime;
      const uptime = formatUptime(uptimeMs);

      const apiPing = Math.round(interaction.client.ws.ping);
      const memoryMB = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);

      const status = getStatus(apiPing);

      const embed = new EmbedBuilder()
        .setTitle('⏱️ Bot Uptime')
        .setColor(status.color)
        .setDescription(`I have been online for:\n\n**${uptime}**`)
        .addFields(
          {
            name: '📡 API Latency',
            value: `**${apiPing}ms**`,
            inline: true
          },
          {
            name: '🧠 Memory Usage',
            value: `**${memoryMB} MB**`,
            inline: true
          },
          {
            name: '⚙️ Status',
            value: status.text,
            inline: true
          }
        )
        .setFooter({ text: 'JabsterBot Performance Monitor' })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

    } catch (err) {
      console.error('Uptime Error:', err);

      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({
          content: '❌ Failed to fetch uptime.'
        });
      } else {
        return interaction.reply({
          content: '❌ Failed to fetch uptime.',
          ephemeral: true
        });
      }
    }
  }
};
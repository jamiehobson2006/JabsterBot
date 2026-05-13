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
  

      const client = interaction.client;

      // ⏱️ Uptime
      const uptimeMs = client.uptime;
      const uptime = formatUptime(uptimeMs);

      // 📡 Latency
      const apiPing = Math.round(client.ws.ping);

      // 🧠 Memory
      const memoryMB = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);

      // ⚙️ CPU (basic)
      const cpuUsage = process.cpuUsage();
      const cpuPercent = ((cpuUsage.user + cpuUsage.system) / 1000000).toFixed(2);

      // 🌐 Stats
      const guilds = client.guilds.cache.size;
      const users = client.users.cache.size;

      const status = getStatus(apiPing);

      const embed = new EmbedBuilder()
        .setTitle('⏱️ Bot Uptime & Performance')
        .setColor(status.color)
        .setDescription(`**Uptime:**\n${uptime}`)
        .addFields(
          {
            name: '📡 API Latency',
            value: `\`${apiPing}ms\``,
            inline: true
          },
          {
            name: '🧠 Memory',
            value: `\`${memoryMB} MB\``,
            inline: true
          },
          {
            name: '⚙️ CPU',
            value: `\`${cpuPercent}%\``,
            inline: true
          },
          {
            name: '🌐 Servers',
            value: `\`${guilds}\``,
            inline: true
          },
          {
            name: '👥 Users',
            value: `\`${users}\``,
            inline: true
          },
          {
            name: '💡 Status',
            value: status.text,
            inline: true
          }
        )
        .setFooter({ text: 'JabsterBot • Performance Monitor' })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });

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
const {
  EmbedBuilder,
  SlashCommandBuilder
} = require('discord.js');

function formatUptime(ms) {

  const totalSeconds =
    Math.floor(ms / 1000);

  const days =
    Math.floor(totalSeconds / 86400);

  const hours =
    Math.floor(
      (totalSeconds % 86400) / 3600
    );

  const minutes =
    Math.floor(
      (totalSeconds % 3600) / 60
    );

  const seconds =
    totalSeconds % 60;

  return (
    `${days}d ` +
    `${hours}h ` +
    `${minutes}m ` +
    `${seconds}s`
  );
}

// ========================
// 🎯 STATUS SYSTEM
// ========================
function getStatus(ping, memoryMB) {

  if (
    ping < 80 &&
    memoryMB < 250
  ) {

    return {
      text: '🟢 Ultra Fast',
      color: 0x57F287,
      message:
        '⚡ Systems operating at maximum efficiency.'
    };
  }

  if (
    ping < 150 &&
    memoryMB < 500
  ) {

    return {
      text: '🟡 Stable',
      color: 0xFEE75C,
      message:
        '🛰️ All systems operational.'
    };
  }

  if (
    ping < 250
  ) {

    return {
      text: '🟠 Moderate Load',
      color: 0xFAA61A,
      message:
        '📡 Handling increased traffic.'
    };
  }

  return {

    text: '🔴 Under Load',

    color: 0xED4245,

    message:
      '🔥 Experiencing heavy activity.'
  };
}

module.exports = {

  cooldown: 5000,

  data: new SlashCommandBuilder()

    .setName('uptime')

    .setDescription(
      'Check bot uptime and performance'
    ),

  async execute(interaction) {

    try {

      const client =
        interaction.client;

      // ========================
      // ⏱️ UPTIME
      // ========================
      const uptimeMs =
        client.uptime;

      const uptime =
        formatUptime(
          uptimeMs
        );

      // ========================
      // 📡 LATENCY
      // ========================
      const apiPing =
        Math.round(
          client.ws.ping
        );

      // ========================
      // 🧠 MEMORY
      // ========================
      const memoryMB =
        (
          process.memoryUsage().heapUsed /
          1024 /
          1024
        ).toFixed(2);

      // ========================
      // 🌐 GLOBAL STATS
      // ========================
      const guilds =
        client.guilds.cache.size;

      const users =
        client.users.cache.size;

      const channels =
        client.channels.cache.size;

      // ========================
      // 🕒 STARTED TIME
      // ========================
      const startedTimestamp =
        Math.floor(
          (
            Date.now() -
            uptimeMs
          ) / 1000
        );

      // ========================
      // 🎯 STATUS
      // ========================
      const status =
        getStatus(
          apiPing,
          Number(memoryMB)
        );

      // ========================
      // 😂 RANDOM MESSAGE
      // ========================
      const messages = [

        '🤖 The hamsters are spinning smoothly.',

        '🚀 Running faster than Discord can complain.',

        '🌴 JabsterBot is fully operational.',

        '🛰️ Monitoring all systems.',

        '⚡ Everything is running beautifully.',

        '🔥 No crashes detected today... yet.'
      ];

      const randomMessage =
        messages[
          Math.floor(
            Math.random() *
            messages.length
          )
        ];

      // ========================
      // 🎨 EMBED
      // ========================
      const embed =
        new EmbedBuilder()

          .setTitle(
            '⏱️ Bot Uptime & Status'
          )

          .setColor(
            status.color
          )

          .setDescription(

            `${status.message}\n\n` +

            `${randomMessage}`
          )

          .addFields(

            {
              name: '⏱️ Uptime',

              value:
                `\`${uptime}\``,

              inline: true
            },

            {
              name: '📡 API Latency',

              value:
                `\`${apiPing}ms\``,

              inline: true
            },

            {
              name: '💡 Status',

              value:
                status.text,

              inline: true
            },

            {
              name: '🧠 Memory Usage',

              value:
                `\`${memoryMB} MB\``,

              inline: true
            },

            {
              name: '🌐 Servers',

              value:
                `\`${guilds.toLocaleString()}\``,

              inline: true
            },

            {
              name: '👥 Users',

              value:
                `\`${users.toLocaleString()}\``,

              inline: true
            },

            {
              name: '💬 Channels',

              value:
                `\`${channels.toLocaleString()}\``,

              inline: true
            },

            {
              name: '🕒 Started',

              value:
                `<t:${startedTimestamp}:R>`,

              inline: true
            }
          )

          .setFooter({
            text:
              'JabsterBot • Live Performance Monitor'
          })

          .setTimestamp();

      return interaction.editReply({
        embeds: [embed]
      });

    } catch (err) {

      console.error(
        'Uptime Error:',
        err
      );

      if (
        interaction.deferred ||
        interaction.replied
      ) {

        return interaction.editReply({
          content:
            '❌ Failed to fetch uptime.'
        });
      }

      return interaction.reply({

        content:
          '❌ Failed to fetch uptime.',

        ephemeral: true
      });
    }
  }
};
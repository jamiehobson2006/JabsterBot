const {
  SlashCommandBuilder,
  EmbedBuilder
} = require('discord.js');

module.exports = {

  cooldown: 3000,

  data: new SlashCommandBuilder()

    .setName('ping')

    .setDescription('Check bot latency'),

  async execute(interaction) {

    try {

      const botLatency =
        Date.now() - interaction.createdTimestamp;

      const apiLatency =
        Math.round(
          interaction.client.ws.ping
        );

      // ========================
      // 🎯 LATENCY STATUS
      // ========================
      function getStatus(ms) {

        if (ms < 100) {
          return {
            emoji: '🟢',
            text: 'Lightning Fast'
          };
        }

        if (ms < 200) {
          return {
            emoji: '🟡',
            text: 'Stable'
          };
        }

        return {
          emoji: '🔴',
          text: 'Potato Servers'
        };
      }

      // ========================
      // 😂 RANDOM FUNNY LINE
      // ========================
      const funnyLines = [

        '⚡ Speeding through the internet...',

        '📡 Definitely not using McDonald\'s WiFi.',

        '🚀 Packets delivered successfully.',

        '🌴 Running smoothly in paradise.',

        '🤖 The hamsters are spinning fast today.',

        '💨 Faster than your loading screen.',

        '🛰️ Contacting the Discord mothership...',

        '🔥 Zero lag detected... probably.'
      ];

      const funny =
        funnyLines[
          Math.floor(
            Math.random() *
            funnyLines.length
          )
        ];

      const botStatus =
        getStatus(botLatency);

      const apiStatus =
        getStatus(apiLatency);

      // ========================
      // 🎨 EMBED
      // ========================
      const embed =
        new EmbedBuilder()

          .setColor(0x5865F2)

          .setTitle('🏓 Pong!')

          .setDescription(funny)

          .addFields(

            {
              name: '📡 Bot Latency',

              value:
                `${botStatus.emoji} \`${botLatency}ms\`\n${botStatus.text}`,

              inline: true
            },

            {
              name: '🌐 API Latency',

              value:
                `${apiStatus.emoji} \`${apiLatency}ms\`\n${apiStatus.text}`,

              inline: true
            }
          )

          .setFooter({
            text:
              `Requested by ${interaction.user.tag}`
          })

          .setTimestamp();

      await interaction.editReply({
        embeds: [embed]
      });

      // ========================
      // 🗑 AUTO DELETE
      // ========================
      setTimeout(() => {

        interaction
          .deleteReply()
          .catch(() => {});

      }, 5000);

    } catch (err) {

      console.error(
        'Ping Error:',
        err
      );

      if (
        interaction.deferred ||
        interaction.replied
      ) {

        return interaction.editReply({
          content:
            '❌ Ping failed.'
        });
      }

      return interaction.reply({

        content:
          '❌ Ping failed.',

        ephemeral: true
      });
    }
  }
};
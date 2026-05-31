const {

  SlashCommandBuilder,

  EmbedBuilder

} = require('discord.js');

module.exports = {

  cooldown: 3000,

  data:
    new SlashCommandBuilder()

      .setName('ping')

      .setDescription(
        'Check bot latency'
      ),

  async execute(interaction) {

    try {

      // ========================
      // ⏱ START TIMER
      // ========================
      const start =
        Date.now();

      // ========================
      // 📡 INITIAL RESPONSE
      // ========================
      await interaction.editReply({

        content:
          '🏓 Measuring latency...'
      });

      // ========================
      // ⏱ LATENCY VALUES
      // ========================
      const botLatency =
        Date.now() - start;

      const apiLatency =
        Math.round(

          interaction.client.ws.ping
        );

      const uptime =
        interaction.client.uptime || 0;

      // ========================
      // ⏱ FORMAT UPTIME
      // ========================
      const days =
        Math.floor(
          uptime / 86400000
        );

      const hours =
        Math.floor(
          uptime / 3600000
        ) % 24;

      const minutes =
        Math.floor(
          uptime / 60000
        ) % 60;

      // ========================
      // 🎯 STATUS HELPER
      // ========================
      function getStatus(ms) {

        if (ms < 80) {

          return {

            emoji: '🟢',

            text: 'Excellent'
          };
        }

        if (ms < 150) {

          return {

            emoji: '🟡',

            text: 'Stable'
          };
        }

        if (ms < 300) {

          return {

            emoji: '🟠',

            text: 'Slow'
          };
        }

        return {

          emoji: '🔴',

          text: 'High Latency'
        };
      }

      // ========================
      // 😂 FUNNY LINES
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

      // ========================
      // 📊 STATUS
      // ========================
      const botStatus =
        getStatus(botLatency);

      const apiStatus =
        getStatus(apiLatency);

      // ========================
      // 🎨 EMBED
      // ========================
      const embed =
        new EmbedBuilder()

          .setColor(
            0x5865F2
          )

          .setTitle(
            '🏓 Pong!'
          )

          .setDescription(
            funny
          )

          .addFields(

            {

              name:
                '📡 Bot Latency',

              value:

                `${botStatus.emoji} \`${botLatency}ms\`\n${botStatus.text}`,

              inline: true
            },

            {

              name:
                '🌐 API Latency',

              value:

                `${apiStatus.emoji} \`${apiLatency}ms\`\n${apiStatus.text}`,

              inline: true
            },

            {

              name:
                '⏱ Uptime',

              value:

                `\`${days}d ${hours}h ${minutes}m\``,

              inline: true
            },

            {

              name:
                '📦 Server Count',

              value:

                `\`${interaction.client.guilds.cache.size}\``,

              inline: true
            },

            {

              name:
                '👥 Cached Users',

              value:

                `\`${interaction.client.users.cache.size}\``,

              inline: true
            },

            {

              name:
                '🧠 Memory Usage',

              value:

                `\`${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB\``,

              inline: true
            }
          )

          .setThumbnail(

            interaction.client.user.displayAvatarURL({

              dynamic: true
            })
          )

          .setFooter({

            text:
              `Requested by ${interaction.user.tag}`
          })

          .setTimestamp();

      // ========================
      // ✅ RESPONSE
      // ========================
      await interaction.editReply({

        content: '',

        embeds: [embed]
      });
      
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
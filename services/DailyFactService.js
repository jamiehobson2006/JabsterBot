const fs = require('fs');
const path = require('path');

const {
  all,
  run
} = require('../database');

const facts = require(
  '../data/dailyFacts.json'
);

class DailyFactService {

  static start(client) {

    console.log(
      '🧠 Daily Fact Service Started'
    );

    setInterval(async () => {

      const configs =
        all(

          `SELECT *
           FROM dailyfact_config
           WHERE enabled = 1`
        );

      const now =
        new Date();

      const today =
        now.toISOString()
          .split('T')[0];

      for (
        const config of configs
      ) {

        if (
          config.lastSent === today
        ) {
          continue;
        }

        if (
          now.getHours() !==
          config.hour
        ) {
          continue;
        }

        if (
          now.getMinutes() !==
          config.minute
        ) {
          continue;
        }

        const guild =
          client.guilds.cache.get(
            config.guildId
          );

        if (!guild) {
          continue;
        }

        const channel =
          guild.channels.cache.get(
            config.channelId
          );

        if (!channel) {
          continue;
        }

        const category =
          facts[
            config.category
          ] || facts.random;

        const fact =
          category[
            Math.floor(
              Math.random() *
              category.length
            )
          ];

        await channel.send({

          embeds: [

            {
              color: 0x5865F2,

              title:
                '🧠 Daily Fact',

              description:
                fact,

              footer: {

                text:
                  'JabsterBot Daily Facts'
              },

              timestamp:
                new Date()
            }
          ]
        });

        run(

          `UPDATE dailyfact_config

           SET lastSent = ?

           WHERE guildId = ?`,

          [

            today,
            config.guildId
          ]
        );
      }

    }, 60000);

  }
}

module.exports =
  DailyFactService;
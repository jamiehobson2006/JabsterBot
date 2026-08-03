const {
  all,
  run
} = require('../database');

const {
  categoryName,
  getFactsForCategory
} = require('../utils/dailyFacts');

class DailyFactService {

  static interval =
    null;

  static start(client) {

    if (DailyFactService.interval) {

      console.log(
        'Daily Fact Service already running'
      );

      return;
    }

    console.log(
      'Daily Fact Service Started'
    );

    DailyFactService.interval =
      setInterval(
        () => {
          DailyFactService.tick(client)
            .catch(err => {
              console.error(
                'Daily Fact Service Error:',
                err
              );
            });
        },
        60000
      );

    DailyFactService.interval.unref?.();
  }

  static async tick(client) {

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

    for (const config of configs) {

      if (
        config.lastSent === today ||
        now.getHours() !== Number(config.hour ?? 12) ||
        now.getMinutes() !== Number(config.minute ?? 0)
      ) {

        continue;
      }

      const channel =
        await client.channels.fetch(
          config.channelId
        ).catch(() => null);

      if (
        !channel ||
        !channel.isTextBased()
      ) {

        continue;
      }

      const category =
        config.category || 'random';

      const categoryFacts =
        getFactsForCategory(category);

      if (!categoryFacts.length) {

        continue;
      }

      const picked =
        categoryFacts[
          Math.floor(
            Math.random() * categoryFacts.length
          )
        ];

      await channel.send({

        embeds: [

          {
            color: 0x5865F2,
            title: 'Daily Fact',
            description: picked.fact,
            fields: [
              {
                name: 'Category',
                value: category === 'random'
                  ? 'Random / All Facts'
                  : categoryName(picked.category),
                inline: true
              },
              {
                name: 'Source',
                value: picked.source === 'community'
                  ? 'Community approved'
                  : 'Jabster Studios facts',
                inline: true
              }
            ],
            footer: {
              text: 'Jabster Studios Daily Facts'
            },
            timestamp: new Date()
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
  }
}

module.exports =
  DailyFactService;

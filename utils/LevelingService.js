const {
  get,
  run,
  all
} = require('../database');

const {
  calculateLevel
} = require('./leveling');

class LevelingService {

  static async handleMessage(
    message
  ) {

    const guildId =
      message.guild.id;

    const userId =
      message.author.id;

    const now =
      Date.now();

    let config =
      get(

        `SELECT *
         FROM leveling_config
         WHERE guildId = ?`,

        [guildId]
      );

    if (!config) {

      run(

        `INSERT INTO leveling_config (

          guildId

        )

        VALUES (?)`,

        [guildId]
      );

      config = {

        enabled: 1,

        xpMin: 15,
        xpMax: 25,

        cooldown: 60
      };
    }

    if (
      config.enabled !== 1
    ) {

      return;
    }

    let user =
      get(

        `SELECT *
         FROM leveling_users
         WHERE guildId = ?
         AND userId = ?`,

        [

          guildId,
          userId
        ]
      );

    if (!user) {

      run(

        `INSERT INTO leveling_users (

          guildId,
          userId,

          xp,
          level,

          messages,

          lastXpTime

        )

        VALUES (?, ?, ?, ?, ?, ?)`,

        [

          guildId,
          userId,

          0,
          0,

          0,

          0
        ]
      );

      user = {

        xp: 0,
        level: 0,

        lastXpTime: 0
      };
    }

    const cooldown =
      (config.cooldown || 60) * 1000;

    if (
      now -
      (user.lastXpTime || 0)
      <
      cooldown
    ) {

      return;
    }

    const xpGain =

      Math.floor(

        Math.random() *

        (
          (config.xpMax || 25) -

          (config.xpMin || 15) + 1
        )

      ) +

      (config.xpMin || 15);

    const newXP =
      user.xp + xpGain;

    const newLevel =
      calculateLevel(
        newXP
      );

    run(

      `UPDATE leveling_users

       SET

       xp = ?,
       level = ?,

       messages =
       messages + 1,

       lastXpTime = ?

       WHERE guildId = ?
       AND userId = ?`,

      [

        newXP,

        newLevel,

        now,

        guildId,
        userId
      ]
    );

    if (
      newLevel >
      user.level
    ) {

      const member =
        await message.guild.members
          .fetch(userId)
          .catch(() => null);

      if (member) {

        const rewards =
          all(

            `SELECT *
             FROM leveling_rewards
             WHERE guildId = ?
             AND level > ?
             AND level <= ?
             ORDER BY level ASC`,

            [

              guildId,

              user.level,

              newLevel
            ]
          );

        for (
          const reward
          of rewards
        ) {

          const role =
            message.guild.roles.cache.get(
              reward.roleId
            );

          if (
            role &&
            !member.roles.cache.has(
              role.id
            )
          ) {

            await member.roles
              .add(role)
              .catch(() => null);
          }
        }
      }

      const levelChannel =

        config.levelChannelId

          ? await message.guild.channels.fetch(
              config.levelChannelId
            ).catch(() => null)

          : message.channel;

      if (levelChannel) {

        const levelMessage =

          (
            config.levelMessage ||

            '🎉 {user} reached level **{level}**!'
          )

            .replace(
              '{user}',
              `<@${userId}>`
            )

            .replace(
              '{level}',
              newLevel
            );

        await levelChannel.send({

          content:
            levelMessage
        });
      }
    }
  }
}

module.exports =
  LevelingService;
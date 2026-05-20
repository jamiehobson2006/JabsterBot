const {
  EmbedBuilder
} = require('discord.js');

const {
  get,
  all,
  run
} = require('../../database');

const {
  checkRequirements
} = require('./checkRequirements');

// ==================================================
// 🎲 RANDOM PICK
// ==================================================
function pickRandom(array) {

  return array[
    Math.floor(
      Math.random() *
      array.length
    )
  ];
}

// ==================================================
// 🧠 SAFE JSON
// ==================================================
function parseRequirements(data) {

  try {

    return JSON.parse(
      data || '{}'
    );

  } catch {

    return {};
  }
}

// ==================================================
// 🎉 END GIVEAWAY
// ==================================================
async function endGiveaway(

  client,
  giveaway

) {

  try {

    // ==========================================
    // 🚫 INVALID GIVEAWAY
    // ==========================================
    if (
      !giveaway ||
      giveaway.ended
    ) {

      return;
    }

    // ==========================================
    // 📺 FETCH CHANNEL
    // ==========================================
    const channel =
      await client.channels
        .fetch(giveaway.channelId)
        .catch(() => null);

    if (
      !channel ||
      !channel.isTextBased()
    ) {

      return;
    }

    // ==========================================
    // 💬 FETCH MESSAGE
    // ==========================================
    const message =
      await channel.messages
        .fetch(giveaway.messageId)
        .catch(() => null);

    if (!message) {

      return;
    }

    // ==========================================
    // 📜 REQUIREMENTS
    // ==========================================
    const requirements =
      parseRequirements(
        giveaway.requirements
      );

    // ==========================================
    // 🎟 FETCH ENTRIES
    // ==========================================
    const entries =
      all(

        `SELECT *
         FROM giveaway_entries
         WHERE messageId = ?`,

        [

          giveaway.messageId
        ]
      );

    // ==========================================
    // ❌ NO ENTRIES
    // ==========================================
    if (!entries.length) {

      await finishGiveaway({

        giveaway,
        message,

        winners: []
      });

      return channel.send({

        content:

          `❌ Giveaway ended with no entries.\n\n` +

          `🎁 Prize: **${giveaway.prize}**`
      });
    }

    // ==========================================
    // ✅ VALID ENTRIES
    // ==========================================
    const validEntries = [];

    const processedUsers =
      new Set();

    for (const entry of entries) {

      // ======================================
      // 🚫 DUPLICATE USER CHECK
      // ======================================
      if (
        processedUsers.has(
          entry.userId
        )
      ) {

        continue;
      }

      processedUsers.add(
        entry.userId
      );

      // ======================================
      // 👤 FETCH MEMBER
      // ======================================
      const member =
        await message.guild.members
          .fetch(entry.userId)
          .catch(() => null);

      if (!member) {

        continue;
      }

      // ======================================
      // 🚫 BLACKLIST CHECK
      // ======================================
      const blacklisted =
        get(

          `SELECT *
           FROM giveaway_blacklist
           WHERE guildId = ?
           AND userId = ?`,

          [

            giveaway.guildId,

            member.id
          ]
        );

      if (blacklisted) {

        continue;
      }

      // ======================================
      // 🔍 REQUIREMENT CHECK
      // ======================================
      const validation =
        await checkRequirements(

          member,
          requirements
        );

      if (
        !validation.success
      ) {

        continue;
      }

      // ======================================
      // 🎁 BONUS ENTRIES
      // ======================================
      const bonusEntries =
        Math.max(

          Number(
            entry.bonus || 0
          ),

          0
        );

      const totalEntries =
        Math.min(

          1 + bonusEntries,

          100
        );

      // ======================================
      // 📦 ADD TO POOL
      // ======================================
      for (
        let i = 0;
        i < totalEntries;
        i++
      ) {

        validEntries.push(
          member.id
        );
      }
    }

    // ==========================================
    // ❌ NO VALID ENTRIES
    // ==========================================
    if (!validEntries.length) {

      await finishGiveaway({

        giveaway,
        message,

        winners: []
      });

      return channel.send({

        content:

          `❌ Giveaway ended with no valid entries.\n\n` +

          `🎁 Prize: **${giveaway.prize}**`
      });
    }

    // ==========================================
    // 🏆 PICK WINNERS
    // ==========================================
    const winners = [];

    const used =
      new Set();

    const winnerCount =
      Math.max(

        Number(
          giveaway.winners || 1
        ),

        1
      );

    let safety = 0;

    while (

      winners.length <
      winnerCount &&

      safety < 5000
    ) {

      safety++;

      const winnerId =
        pickRandom(
          validEntries
        );

      if (
        used.has(winnerId)
      ) {

        continue;
      }

      used.add(
        winnerId
      );

      winners.push(
        winnerId
      );

      // ======================================
      // 💾 SAVE WINNER
      // ======================================
      run(

        `INSERT INTO giveaway_winners (

          messageId,
          guildId,
          userId,
          wonAt

        )

        VALUES (?, ?, ?, ?)`,

        [

          giveaway.messageId,

          giveaway.guildId,

          winnerId,

          Date.now()
        ]
      );
    }

    // ==========================================
    // 🏁 FINISH GIVEAWAY
    // ==========================================
    await finishGiveaway({

      giveaway,
      message,

      winners
    });

    // ==========================================
    // 🎉 WINNER ANNOUNCEMENT
    // ==========================================
    await channel.send({

      content:

        `🎉 Congratulations ` +

        `${winners.map(id => `<@${id}>`).join(', ')}!\n\n` +

        `You won **${giveaway.prize}**`
    });

  } catch (err) {

    console.error(
      'End Giveaway Error:',
      err
    );
  }
}

// ==================================================
// 🏁 FINISH GIVEAWAY
// ==================================================
async function finishGiveaway({

  giveaway,
  message,
  winners

}) {

  try {

    // ==========================================
    // 💾 MARK ENDED
    // ==========================================
    run(

      `UPDATE giveaways

       SET ended = 1

       WHERE messageId = ?`,

      [

        giveaway.messageId
      ]
    );

    // ==========================================
    // 🚫 NO EMBED
    // ==========================================
    if (
      !message.embeds?.length
    ) {

      return;
    }

    // ==========================================
    // 🎨 UPDATE EMBED
    // ==========================================
    const embed =
      EmbedBuilder.from(
        message.embeds[0]
      );

    // ==========================================
    // 🧹 REMOVE OLD WINNER FIELD
    // ==========================================
    const filteredFields =
      (
        embed.data.fields || []
      ).filter(

        field =>

          field.name !==
          '🏆 Winners'
      );

    embed.setFields(
      filteredFields
    );

    // ==========================================
    // 🏆 WINNER TEXT
    // ==========================================
    const winnerText =

      winners.length

        ? winners
            .map(
              id => `<@${id}>`
            )
            .join(', ')

        : 'No valid winners';

    embed

      .setColor(0xED4245)

      .setFooter({

        text:
          'Giveaway Ended'
      })

      .addFields({

        name:
          '🏆 Winners',

        value:
          winnerText
      });

    // ==========================================
    // ✏ UPDATE MESSAGE
    // ==========================================
    await message.edit({

      embeds: [embed],

      components: []
    });

  } catch (err) {

    console.error(
      'Finish Giveaway Error:',
      err
    );
  }
}

module.exports = {

  endGiveaway
};
const {

  SlashCommandBuilder,

  PermissionsBitField,

  EmbedBuilder

} = require('discord.js');

const {

  get,

  all,

  run

} = require('../../database');

const {

  checkRequirements

} = require('../../utils/giveaways/checkRequirements');

module.exports = {

  cooldown: 5000,

  data:
    new SlashCommandBuilder()

      .setName('greroll')

      .setDescription(
        'Reroll a giveaway'
      )

      .addStringOption(option =>

        option

          .setName('message_id')

          .setDescription(
            'Giveaway message ID'
          )

          .setRequired(true)
      )

      .addIntegerOption(option =>

        option

          .setName('winners')

          .setDescription(
            'Number of new winners'
          )

          .setMinValue(1)

          .setMaxValue(20)

          .setRequired(false)
      ),

  async execute(interaction) {

    try {

      // ==========================================
      // 🔐 PERMISSIONS
      // ==========================================
      if (

        !interaction.memberPermissions.has(

          PermissionsBitField.Flags.ManageGuild
        )
      ) {

        return interaction.editReply({

          content:
            '❌ You need Manage Server permission.'
        });
      }

      // ==========================================
      // 📨 OPTIONS
      // ==========================================
      const messageId =
        interaction.options.getString(

          'message_id',

          true
        );

      const winnerCount =
        interaction.options.getInteger(

          'winners'
        ) || 1;

      // ==========================================
      // 📊 GIVEAWAY
      // ==========================================
      const giveaway =
        get(

          `SELECT *
           FROM giveaways

           WHERE messageId = ?
           AND guildId = ?`,

          [

            messageId,

            interaction.guild.id
          ]
        );

      if (!giveaway) {

        return interaction.editReply({

          content:
            '❌ Giveaway not found in this server.'
        });
      }

      // ==========================================
      // ⛔ NOT ENDED
      // ==========================================
      if (!giveaway.ended) {

        return interaction.editReply({

          content:
            '❌ Giveaway has not ended yet.'
        });
      }

      // ==========================================
      // 📺 CHANNEL
      // ==========================================
      const channel =
        await interaction.client.channels

          .fetch(
            giveaway.channelId
          )

          .catch(() => null);

      if (!channel) {

        return interaction.editReply({

          content:
            '❌ Giveaway channel not found.'
        });
      }

      // ==========================================
      // 💬 MESSAGE
      // ==========================================
      const message =
        await channel.messages

          .fetch(
            giveaway.messageId
          )

          .catch(() => null);

      if (!message) {

        return interaction.editReply({

          content:
            '❌ Giveaway message not found.'
        });
      }

      // ==========================================
      // 📜 REQUIREMENTS
      // ==========================================
      let requirements = {};

      try {

        requirements =
          JSON.parse(

            giveaway.requirements || '{}'
          );

      } catch {

        requirements = {};
      }

      // ==========================================
      // 🏆 PREVIOUS WINNERS
      // ==========================================
      const previousWinners =
        all(

          `SELECT *
           FROM giveaway_winners

           WHERE messageId = ?`,

          [messageId]
        );

      const previousIds =
        previousWinners.map(
          w => w.userId
        );

      // ==========================================
      // 🎟 ENTRIES
      // ==========================================
      const entries =
        all(

          `SELECT *
           FROM giveaway_entries

           WHERE messageId = ?`,

          [messageId]
        );

      const validEntries = [];

      // ==========================================
      // 🔍 RECHECK REQUIREMENTS
      // ==========================================
      for (const entry of entries) {

        // ========================================
        // 🚫 SKIP PREVIOUS WINNERS
        // ========================================
        if (

          previousIds.includes(
            entry.userId
          )
        ) {

          continue;
        }

        // ========================================
        // 👤 FETCH MEMBER
        // ========================================
        const member =
          await message.guild.members

            .fetch(
              entry.userId
            )

            .catch(() => null);

        if (!member) {

          continue;
        }

        // ========================================
        // ✅ VALIDATE REQUIREMENTS
        // ========================================
        const validation =
          await checkRequirements(

            member,

            requirements
          );

        if (!validation.success) {

          continue;
        }

        // ========================================
        // 🎁 BONUS ENTRIES
        // ========================================
        const total =
          1 + (entry.bonus || 0);

        for (
          let i = 0;
          i < total;
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

        return interaction.editReply({

          content:
            '❌ No valid reroll entries found.'
        });
      }

      // ==========================================
      // 🎉 PICK WINNERS
      // ==========================================
      const winners = [];

      const used =
        new Set();

      const uniquePool =
        new Set(validEntries);

      while (

        winners.length <
        winnerCount &&

        used.size <
        uniquePool.size
      ) {

        const id =

          validEntries[
            Math.floor(

              Math.random() *

              validEntries.length
            )
          ];

        if (
          used.has(id)
        ) {

          continue;
        }

        used.add(id);

        winners.push(id);
      }

      // ==========================================
      // ❌ FAILED TO PICK
      // ==========================================
      if (!winners.length) {

        return interaction.editReply({

          content:
            '❌ Failed to pick winners.'
        });
      }

      // ==========================================
      // 💾 SAVE WINNERS
      // ==========================================
      for (const userId of winners) {

        run(

          `INSERT INTO giveaway_winners (

            messageId,
            guildId,
            userId,

            rerolled,

            wonAt

          )

          VALUES (?, ?, ?, ?, ?)`,

          [

            giveaway.messageId,

            giveaway.guildId,

            userId,

            1,

            Date.now()
          ]
        );
      }

      // ==========================================
      // 🎨 EMBED
      // ==========================================
      const embed =
        new EmbedBuilder()

          .setColor(0x57F287)

          .setTitle(
            '🎉 Giveaway Rerolled'
          )

          .setDescription(

            `🎁 Prize: **${giveaway.prize}**\n\n` +

            `🏆 New Winner(s):\n` +

            winners

              .map(id => `<@${id}>`)

              .join('\n')
          )

          .addFields(

            {

              name: '📊 Reroll Statistics',

              value:

                `• ${entries.length} original entries\n` +

                `• ${validEntries.length} weighted entries\n` +

                `• ${previousWinners.length} previous winner(s)\n` +

                `• ${winners.length} new winner(s)`,

              inline: false
            },

            {

              name: '👤 Rerolled By',

              value:
                `${interaction.user}`,

              inline: true
            },

            {

              name: '🆔 Message ID',

              value:
                `\`${messageId}\``,

              inline: true
            }
          )

          .setFooter({

            text:
              'Giveaway rerolled successfully'
          })

          .setTimestamp();

      // ==========================================
      // 📤 SEND
      // ==========================================
      await channel.send({

        embeds: [embed]
      });

      await interaction.editReply({

        embeds: [embed]
      });

    } catch (err) {

      console.error(
        'Giveaway Reroll Error:',
        err
      );

      return interaction.editReply({

        content:
          '❌ Failed to reroll giveaway.'
      });
    }
  }
};
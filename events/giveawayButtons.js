const {
  EmbedBuilder
} = require('discord.js');

const {
  get,
  run
} = require('../database');

const {
  checkRequirements
} = require('../utils/giveaways/checkRequirements');

// ==========================
// ⏱ JOIN COOLDOWN CACHE
// ==========================
const joinCooldowns =
  new Map();

module.exports = {

  name: 'interactionCreate',

  async execute(interaction) {

    try {

      // ==========================================
      // 🎟 BUTTON ONLY
      // ==========================================
      if (
        !interaction.isButton()
      ) {

        return;
      }

      // ==========================================
      // 🎉 GIVEAWAY BUTTON
      // ==========================================
      if (
        interaction.customId !==
        'giveaway_join'
      ) {

        return;
      }

      // ==========================================
      // ⏱ SPAM COOLDOWN
      // ==========================================
      const cooldownKey =
        `${interaction.message.id}:${interaction.user.id}`;

      const lastClick =
        joinCooldowns.get(
          cooldownKey
        );

      if (
        lastClick &&
        Date.now() - lastClick < 2000
      ) {

        return interaction.reply({

          content:
            '⏳ Please wait before clicking again.',

          ephemeral: true
        });
      }

      joinCooldowns.set(
        cooldownKey,
        Date.now()
      );

      setTimeout(() => {

        joinCooldowns.delete(
          cooldownKey
        );

      }, 5000);

      // ==========================================
      // 📊 FETCH GIVEAWAY
      // ==========================================
      const giveaway =
        get(

          `SELECT *
           FROM giveaways
           WHERE messageId = ?`,

          [

            interaction.message.id
          ]
        );

      if (!giveaway) {

        return interaction.reply({

          content:
            '❌ Giveaway not found.',

          ephemeral: true
        });
      }

      // ==========================================
      // ⛔ ENDED
      // ==========================================
      if (giveaway.ended) {

        return interaction.reply({

          content:
            '❌ This giveaway has ended.',

          ephemeral: true
        });
      }

      // ==========================================
      // ⏸ PAUSED
      // ==========================================
      if (giveaway.paused) {

        return interaction.reply({

          content:
            '❌ This giveaway is paused.',

          ephemeral: true
        });
      }

      // ==========================================
      // 🚫 BLACKLIST CHECK
      // ==========================================
      const blacklisted =
        get(

          `SELECT *
           FROM giveaway_blacklist
           WHERE guildId = ?
           AND userId = ?`,

          [

            interaction.guild.id,

            interaction.user.id
          ]
        );

      if (blacklisted) {

        return interaction.reply({

          content:
            '❌ You are blacklisted from giveaways.',

          ephemeral: true
        });
      }

      // ==========================================
      // 👤 MEMBER
      // ==========================================
      const member =
        await interaction.guild.members
          .fetch(interaction.user.id)
          .catch(() => null);

      if (!member) {

        return interaction.reply({

          content:
            '❌ Failed to fetch member.',

          ephemeral: true
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
      // 🎯 VALIDATE
      // ==========================================
      const validation =
        await checkRequirements(

          member,
          requirements
        );

      if (!validation.success) {

        return interaction.reply({

          content:
            `❌ ${validation.reason}`,

          ephemeral: true
        });
      }

      // ==========================================
      // 🚫 ALREADY ENTERED
      // ==========================================
      const existing =
        get(

          `SELECT 1
           FROM giveaway_entries
           WHERE messageId = ?
           AND userId = ?`,

          [

            giveaway.messageId,

            interaction.user.id
          ]
        );

      if (existing) {

        return interaction.reply({

          content:
            '❌ You are already entered.',

          ephemeral: true
        });
      }

      // ==========================================
      // 🎁 BONUS ENTRIES
      // ==========================================
      const bonus =
        validation.bonusEntries || 0;

      // ==========================================
      // 💾 SAVE ENTRY
      // ==========================================
      try {

        run(

          `INSERT INTO giveaway_entries (

            messageId,
            guildId,
            userId,

            bonus,

            joinedAt

          )

          VALUES (?, ?, ?, ?, ?)`,
          
          [

            giveaway.messageId,

            interaction.guild.id,

            interaction.user.id,

            bonus,

            Date.now()
          ]
        );

      } catch (dbErr) {

        // ======================================
        // 🚫 DUPLICATE RACE CONDITION
        // ======================================
        if (
          String(dbErr.message)
            .toLowerCase()
            .includes('unique')
        ) {

          return interaction.reply({

            content:
              '❌ You are already entered.',

            ephemeral: true
          });
        }

        throw dbErr;
      }

      // ==========================================
      // 📊 REAL ENTRY COUNT
      // ==========================================
      const totalData =
        get(

          `SELECT COUNT(*) as total
           FROM giveaway_entries
           WHERE messageId = ?`,

          [

            giveaway.messageId
          ]
        );

      const totalEntries =
        totalData?.total || 0;

      // ==========================================
      // 💾 SYNC GIVEAWAY TABLE
      // ==========================================
      run(

        `UPDATE giveaways

         SET totalEntries = ?

         WHERE messageId = ?`,

        [

          totalEntries,

          giveaway.messageId
        ]
      );

      // ==========================================
      // ✏ SAFE EMBED UPDATE
      // ==========================================
      if (
        interaction.message.embeds.length
      ) {

        try {

          const oldEmbed =
            interaction.message.embeds[0];

          const embed =
            EmbedBuilder.from(
              oldEmbed
            );

          // ======================================
          // 📄 CLEAN DESCRIPTION
          // ======================================
          const description =
            embed.data.description || '';

          const cleaned =
            description

              .replace(
                /\n\n👥 Entries: \*\*.*?\*\*/g,
                ''
              )

              .trim();

          embed.setDescription(

            cleaned +

            `\n\n👥 Entries: **${totalEntries}**`
          );

          await interaction.message.edit({

            embeds: [embed]
          });

        } catch (editErr) {

          console.error(
            'Giveaway embed update failed:',
            editErr
          );
        }
      }

      // ==========================================
      // ✅ SUCCESS
      // ==========================================
      return interaction.reply({

        content:

          bonus > 0

            ? `✅ You entered the giveaway with **${bonus}** bonus entries.`

            : '✅ You entered the giveaway.',

        ephemeral: true
      });

    } catch (err) {

      console.error(
        'Giveaway Join Error:',
        err
      );

      if (

        interaction.deferred ||

        interaction.replied
      ) {

        return;
      }

      return interaction.reply({

        content:
          '❌ Failed to join giveaway.',

        ephemeral: true
      });
    }
  }
};
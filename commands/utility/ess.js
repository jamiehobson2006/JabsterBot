const {

  EmbedBuilder,

  ActionRowBuilder,

  ButtonBuilder,

  ButtonStyle,

  SlashCommandBuilder

} = require('discord.js');

module.exports = {

  cooldown: 5000,

  data:
    new SlashCommandBuilder()

      .setName('ess')

      .setDescription(
        'Show Endless Summer Simulator info'
      ),

  async execute(interaction) {

    try {

      // ========================
      // 🎨 MAIN EMBED
      // ========================
      const embed =
        new EmbedBuilder()

          .setColor(
            0xE67E22
          )

          .setTitle(
            '🌴 Endless Summer Simulator'
          )

          .setDescription(

            '⚡ **Build insane combo streaks, unlock powerful upgrades, and become the richest player in paradise.**\n\n' +

            '🌊 Collect glowing orbs across vibrant islands\n' +
            '🔥 Trigger powerful world events\n' +
            '💰 Upgrade your stats and multiply your earnings\n' +
            '🏝️ Compete on global leaderboards\n' +
            '✨ Discover rare orb types and massive combo chains\n\n' +

            '**Start small → grind massive multipliers → become unstoppable.**'
          )

          .addFields(

            {

              name:
                '🚀 Why Players Love It',

              value:

                '• Addictive progression\n' +
                '• Constant rewards\n' +
                '• Satisfying combo system\n' +
                '• Rare collectibles\n' +
                '• Fast-paced gameplay',

              inline: true
            },

            {

              name:
                '🔥 Live Features',

              value:

                '• Orb Rarities\n' +
                '• World Events\n' +
                '• Upgrade System\n' +
                '• Combo Multipliers\n' +
                '• Global Leaderboards',

              inline: true
            },

            {

              name:
                '🛠 Current Development',

              value:

                '• Prestige System\n' +
                '• Quest Expansion\n' +
                '• New Worlds\n' +
                '• UI Overhaul\n' +
                '• More Events',

              inline: false
            }
          )

          .setImage(
            'https://tr.rbxcdn.com/180DAY-c1db2679dce8dbec7a0f9b84d7dbb3f0/768/432/Image/Webp/noFilter'
          )

          .setThumbnail(
            'https://tr.rbxcdn.com/180DAY-c1db2679dce8dbec7a0f9b84d7dbb3f0/150/150/Image/Webp/noFilter'
          )

          .setFooter({

            text:
              'JabsterStudios • Endless Summer Simulator'
          })

          .setTimestamp();

      // ========================
      // 🔘 BUTTONS
      // ========================
      const row =
        new ActionRowBuilder()

          .addComponents(

            new ButtonBuilder()

              .setLabel(
                'Play Now'
              )

              .setEmoji('🌴')

              .setStyle(
                ButtonStyle.Link
              )

              .setURL(
                'https://www.roblox.com/games/130906696817438/Endless-Summer-Simulator'
              ),

            new ButtonBuilder()

              .setLabel(
                'Join Community'
              )

              .setEmoji('👥')

              .setStyle(
                ButtonStyle.Link
              )

              .setURL(
                'https://www.roblox.com/communities/11716549/JabsterStudios#!/about'
              ),

            new ButtonBuilder()

              .setLabel(
                'Favorite Game'
              )

              .setEmoji('⭐')

              .setStyle(
                ButtonStyle.Link
              )

              .setURL(
                'https://www.roblox.com/games/130906696817438/Endless-Summer-Simulator'
              )
          );

      // ========================
      // 📤 RESPONSE
      // ========================
      await interaction.editReply({

        embeds: [embed],

        components: [row]
      });

    } catch (err) {

      console.error(
        'ESS Command Error:',
        err
      );

      if (

        interaction.deferred ||

        interaction.replied
      ) {

        return interaction.editReply({

          content:
            '❌ Failed to load game info.'
        });
      }

      return interaction.reply({

        content:
          '❌ Failed to load game info.',

        ephemeral: true
      });
    }
  }
};
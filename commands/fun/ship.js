const {

  EmbedBuilder,

  SlashCommandBuilder

} = require('discord.js');

// ==================================================
// 💘 COMPATIBILITY
// ==================================================
function getCompatibility(id1, id2) {

  const [a, b] =
    [id1, id2].sort();

  const combined =
    a + b;

  let hash = 0;

  for (
    let i = 0;

    i < combined.length;

    i++
  ) {

    hash =

      combined.charCodeAt(i) +

      ((hash << 5) - hash);
  }

  const raw =
    Math.abs(hash % 101);

  // ==============================================
  // 🎯 WEIGHTED
  // ==============================================
  return Math.floor(

    Math.pow(
      raw / 100,
      0.75
    ) * 100
  );
}

// ==================================================
// 🎯 TIERS
// ==================================================
function getTier(percent) {

  if (percent === 100) {

    return {

      text:
        '👑 Destined Soulmates',

      color:
        0xFF4D6D
    };
  }

  if (percent >= 95) {

    return {

      text:
        '💞 Soulmates!',

      color:
        0xED4245
    };
  }

  if (percent >= 75) {

    return {

      text:
        '💖 Perfect Match!',

      color:
        0xFF73FA
    };
  }

  if (percent >= 60) {

    return {

      text:
        '💕 Strong Connection!',

      color:
        0xF47FFF
    };
  }

  if (percent >= 40) {

    return {

      text:
        '😐 Could work...',

      color:
        0x95A5A6
    };
  }

  if (percent >= 20) {

    return {

      text:
        '💀 Not looking good...',

      color:
        0x576574
    };
  }

  return {

    text:
      '🚫 Absolute Disaster.',

    color:
      0x2C2F33
  };
}

// ==================================================
// ❤️ BAR
// ==================================================
function createBar(percent) {

  const total = 10;

  const filled =
    Math.round(

      (percent / 100) * total
    );

  const empty =
    total - filled;

  return (

    '🟥'.repeat(filled) +

    '⬛'.repeat(empty)
  );
}

// ==================================================
// 🏷 SHIP NAME
// ==================================================
function createShipName(name1, name2) {

  const first =
    name1.slice(

      0,

      Math.max(
        2,

        Math.floor(
          name1.length / 2
        )
      )
    );

  const second =
    name2.slice(

      Math.floor(
        name2.length / 2
      )
    );

  return (
    first + second
  );
}

module.exports = {

  cooldown: 3000,

  data:
    new SlashCommandBuilder()

      .setName('ship')

      .setDescription(
        'Check compatibility between two users'
      )

      .addUserOption(option =>

        option

          .setName('user1')

          .setDescription(
            'First user'
          )

          .setRequired(true)
      )

      .addUserOption(option =>

        option

          .setName('user2')

          .setDescription(
            'Second user'
          )

          .setRequired(true)
      ),

  async execute(interaction) {

    try {

      // ==========================================
      // 👥 USERS
      // ==========================================
      const user1 =
        interaction.options.getUser(

          'user1',

          true
        );

      const user2 =
        interaction.options.getUser(

          'user2',

          true
        );

      // ==========================================
      // 💀 SAME USER
      // ==========================================
      if (user1.id === user2.id) {

        return interaction.editReply({

          content:

            '💀 You can’t ship someone with themselves... or can you?'
        });
      }

      // ==========================================
      // 🤖 BOTS
      // ==========================================
      if (

        user1.bot ||

        user2.bot
      ) {

        return interaction.editReply({

          content:

            '🤖 Bots don’t do relationships... yet.'
        });
      }

      // ==========================================
      // 💘 SUSPENSE
      // ==========================================
      await interaction.editReply({

        content:
          '💘 Calculating compatibility...'
      });

      await new Promise(res =>
        setTimeout(res, 1000)
      );

      // ==========================================
      // 🎲 RESULTS
      // ==========================================
      const percent =
        getCompatibility(

          user1.id,

          user2.id
        );

      const tier =
        getTier(percent);

      const bar =
        createBar(percent);

      const shipName =
        createShipName(

          user1.username,

          user2.username
        );

      // ==========================================
      // 🎨 EMBED
      // ==========================================
      const embed =
        new EmbedBuilder()

          .setColor(
            tier.color
          )

          .setTitle(
            '💘 Ship Result'
          )

          .setDescription(

            `${user1} ❤️ ${user2}\n\n` +

            `🏷 **Ship Name:** \`${shipName}\`\n\n` +

            `💖 **Compatibility:** \`${percent}%\`\n` +

            `${bar}\n\n` +

            `💬 **Status:** ${tier.text}`
          )

          .setThumbnail(

            user1.displayAvatarURL({

              dynamic: true,

              size: 256
            })
          )

          .setFooter({

            text:
              'Love is unpredictable... or is it?'
          })

          .setTimestamp();

      // ==========================================
      // 📤 RESPONSE
      // ==========================================
      return interaction.editReply({

        content: '',

        embeds: [embed]
      });

    } catch (err) {

      console.error(
        'Ship Command Error:',
        err
      );

      if (

        interaction.deferred ||

        interaction.replied
      ) {

        return interaction.editReply({

          content:
            '❌ Shipping failed.'
        });
      }

      return interaction.reply({

        content:
          '❌ Shipping failed.',

        ephemeral: true
      });
    }
  }
};
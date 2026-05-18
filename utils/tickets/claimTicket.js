const {
  EmbedBuilder
} = require('discord.js');

const {
  get,
  run
} = require('../../database');

const {
  canClaimTicket
} = require('./permissions');

const {
  addClaim
} = require('./stats');

// ==================================================
// 👮 CLAIM TICKET
// ==================================================
async function claimTicket({

  interaction
}) {

  // ==============================================
  // 🔍 FETCH TICKET
  // ==============================================
  const ticket = get(

    `SELECT *
     FROM tickets
     WHERE channelId = ?
     AND status = 'OPEN'`,

    [interaction.channel.id]
  );

  if (!ticket) {

    throw new Error(
      'Invalid ticket.'
    );
  }

  // ==============================================
  // 🔐 PERMISSION CHECK
  // ==============================================
  const allowed =
    canClaimTicket({

      member:
        interaction.member,

      guildId:
        interaction.guild.id,

      type:
        ticket.type
    });

  if (!allowed) {

    throw new Error(
      'You cannot claim tickets.'
    );
  }

  // ==============================================
  // 🚫 ALREADY CLAIMED
  // ==============================================
  if (ticket.claimedBy) {

    // ==========================================
    // 👤 SAME USER
    // ==========================================
    if (

      ticket.claimedBy ===
      interaction.user.id
    ) {

      throw new Error(
        'You already claimed this ticket.'
      );
    }

    throw new Error(
      'This ticket is already claimed.'
    );
  }

  // ==============================================
  // 💾 SAVE CLAIM
  // ==============================================
  run(

    `UPDATE tickets

     SET
       claimedBy = ?,
       claimedAt = ?

     WHERE channelId = ?`,

    [

      interaction.user.id,

      Date.now(),

      interaction.channel.id
    ]
  );

  // ==============================================
  // 📊 STATS
  // ==============================================
  addClaim(

    interaction.guild.id,

    interaction.user.id
  );

  // ==============================================
  // 🎨 EMBED
  // ==============================================
  const embed =
    new EmbedBuilder()

      .setColor(0x57F287)

      .setTitle(
        '👮 Ticket Claimed'
      )

      .setDescription(

        `${interaction.user} is now handling this ticket.`
      )

      .addFields({

        name: 'Staff Member',

        value:
          `${interaction.user}`,

        inline: true
      })

      .setFooter({

        text:
          `User ID: ${interaction.user.id}`
      })

      .setTimestamp();

  // ==============================================
  // 📤 SEND
  // ==============================================
  await interaction.channel.send({

    embeds: [embed]
  });

  return true;
}

module.exports = {
  claimTicket
};
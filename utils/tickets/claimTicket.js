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
// 🧠 SAFE STRING
// ==================================================
function safeString(
  value,
  fallback = 'Unknown'
) {

  if (
    typeof value !== 'string'
  ) {

    return fallback;
  }

  return value.trim() ||
    fallback;
}

// ==================================================
// 👮 CLAIM TICKET
// ==================================================
async function claimTicket({

  interaction
}) {

  // ==============================================
  // 🚫 INVALID INTERACTION
  // ==============================================
  if (
    !interaction ||
    !interaction.guild ||
    !interaction.channel
  ) {

    throw new Error(
      'Invalid interaction.'
    );
  }

  // ==============================================
  // 🔍 FETCH TICKET
  // ==============================================
  const ticket =
    get(

      `SELECT *
       FROM tickets
       WHERE channelId = ?
       AND status = 'OPEN'`,

      [

        interaction.channel.id
      ]
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
    await canClaimTicket({

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
  if (
    ticket.claimedBy
  ) {

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
  // 🔒 CLAIM LOCK
  // ==============================================
  const lock =
    run(

      `UPDATE tickets

       SET
         claimedBy = ?,
         claimedAt = ?

       WHERE channelId = ?
       AND claimedBy IS NULL
       AND status = 'OPEN'`,

      [

        interaction.user.id,

        Date.now(),

        interaction.channel.id
      ]
    );

  // ==============================================
  // 🚫 CLAIM FAILED
  // ==============================================
  if (
    !lock ||
    lock.changes === 0
  ) {

    throw new Error(
      'This ticket was claimed by someone else.'
    );
  }

  // ==============================================
  // 📊 UPDATE STAFF STATS
  // ==============================================
  try {

    addClaim(

      interaction.guild.id,

      interaction.user.id
    );

  } catch (err) {

    console.error(
      'Ticket stats error:',
      err
    );
  }

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

      .addFields(

        {

          name:
            'Staff Member',

          value:
            `${interaction.user}`,

          inline: true
        },

        {

          name:
            'Ticket Type',

          value:

            `\`${safeString(ticket.type)}\``,

          inline: true
        }
      )

      .setFooter({

        text:

          `Staff ID: ${interaction.user.id}`
      })

      .setTimestamp();

  // ==============================================
  // 🔘 UPDATE BUTTONS
  // ==============================================
  try {

    const messages =
      await interaction.channel.messages
        .fetch({ limit: 10 });

    const ticketMessage =
      messages.find(

        msg =>

          msg.author.id ===
          interaction.client.user.id &&

          msg.components?.length
      );

    if (ticketMessage) {

      const updatedComponents =
        ticketMessage.components.map(
          row => {

            row.components.forEach(
              component => {

                // ==============================
                // 🚫 DISABLE CLAIM BUTTON
                // ==============================
                if (

                  component.customId ===
                  'ticket_claim'
                ) {

                  component.data.disabled =
                    true;

                  component.data.label =
                    'Claimed';
                }
              }
            );

            return row;
          }
        );

      await ticketMessage.edit({

        components:
          updatedComponents
      }).catch(() => {});
    }

  } catch (err) {

    console.error(
      'Ticket button update error:',
      err
    );
  }

  // ==============================================
  // 📤 SEND CLAIM MESSAGE
  // ==============================================
  await interaction.channel.send({

    embeds: [embed]
  });

  return {

    success: true,

    claimedBy:
      interaction.user.id
  };
}

module.exports = {
  claimTicket
};
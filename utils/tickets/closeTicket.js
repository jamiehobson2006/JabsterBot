const {
  EmbedBuilder
} = require('discord.js');

const {
  get,
  run
} = require('../../database');

const {
  canCloseTicket
} = require('./permissions');

const {
  addClose,
  addHandleTime
} = require('./stats');

const {
  generateTranscript
} = require('./transcript');

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
// ⏱ FORMAT TIME
// ==================================================
function formatDuration(ms) {

  if (
    !ms ||
    ms < 1000
  ) {

    return 'Under 1 second';
  }

  const seconds =
    Math.floor(ms / 1000);

  const minutes =
    Math.floor(seconds / 60);

  const hours =
    Math.floor(minutes / 60);

  const days =
    Math.floor(hours / 24);

  if (days >= 1) {

    return `${days}d ${hours % 24}h`;
  }

  if (hours >= 1) {

    return `${hours}h ${minutes % 60}m`;
  }

  if (minutes >= 1) {

    return `${minutes}m ${seconds % 60}s`;
  }

  return `${seconds}s`;
}

// ==================================================
// 🔒 CLOSE TICKET
// ==================================================
async function closeTicket({

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
    await canCloseTicket({

      member:
        interaction.member,

      guildId:
        interaction.guild.id,

      type:
        ticket.type
    });

  if (!allowed) {

    throw new Error(
      'You cannot close tickets.'
    );
  }

  // ==============================================
  // 🔒 CLOSE LOCK
  // ==============================================
  const closeResult =
    run(

      `UPDATE tickets

       SET
         status = 'CLOSED',
         closedBy = ?,
         closedAt = ?

       WHERE channelId = ?
       AND status = 'OPEN'`,

      [

        interaction.user.id,

        Date.now(),

        interaction.channel.id
      ]
    );

  // ==============================================
  // 🚫 ALREADY CLOSED
  // ==============================================
  if (
    !closeResult ||
    closeResult.changes === 0
  ) {

    throw new Error(
      'This ticket is already closed.'
    );
  }

  // ==============================================
  // ⏱ HANDLE TIME
  // ==============================================
  const createdAt =
    Number(
      ticket.createdAt || 0
    );

  const handleTime =
    Math.max(

      Date.now() - createdAt,

      0
    );

  // ==============================================
  // 📊 STAFF STATS
  // ==============================================
  try {

    addClose(

      interaction.guild.id,

      interaction.user.id
    );

    addHandleTime(

      interaction.guild.id,

      interaction.user.id,

      handleTime
    );

  } catch (err) {

    console.error(
      'Ticket stats error:',
      err
    );
  }

  // ==============================================
  // 🎨 CLOSE EMBED
  // ==============================================
  const embed =
    new EmbedBuilder()

      .setColor(0xED4245)

      .setTitle(
        '🔒 Ticket Closed'
      )

      .setDescription(

        `This ticket was closed by ${interaction.user}`
      )

      .addFields(

        {

          name:
            'Closed By',

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
        },

        {

          name:
            'Handle Time',

          value:
            formatDuration(handleTime),

          inline: true
        }
      )

      .setFooter({

        text:
          'Channel will be deleted shortly'
      })

      .setTimestamp();

  // ==============================================
  // 🔘 DISABLE BUTTONS
  // ==============================================
  try {

    const messages =
      await interaction.channel.messages
        .fetch({ limit: 15 });

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

                component.data.disabled =
                  true;

                // ==============================
                // 🔒 UPDATE LABEL
                // ==============================
                if (

                  component.customId ===
                  'ticket_close'
                ) {

                  component.data.label =
                    'Closed';
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
      'Ticket button disable error:',
      err
    );
  }

  // ==============================================
  // 📤 SEND CLOSE MESSAGE
  // ==============================================
  await interaction.channel.send({

    embeds: [embed]
  });

  // ==============================================
  // 📜 GENERATE TRANSCRIPT
  // ==============================================
  try {

    await generateTranscript({

      client:
        interaction.client,

      channel:
        interaction.channel,

      ticket,

      closedBy:
        interaction.user
    });

  } catch (err) {

    console.error(
      'Transcript generation error:',
      err
    );
  }

  // ==============================================
  // 🗑 DELETE CHANNEL
  // ==============================================
  setTimeout(async () => {

    try {

      await interaction.channel.delete(

        `Ticket closed by ${interaction.user.tag}`
      );

    } catch (err) {

      console.error(
        'Channel delete error:',
        err
      );
    }

  }, 5000);

  return {

    success: true,

    closedBy:
      interaction.user.id,

    handleTime
  };
}

module.exports = {
  closeTicket
};
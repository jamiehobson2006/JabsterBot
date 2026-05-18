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
// 🔒 CLOSE TICKET
// ==================================================
async function closeTicket({

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
    canCloseTicket({

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
  // ⏱ HANDLE TIME
  // ==============================================
  const handleTime =
    Date.now() -
    ticket.createdAt;

  // ==============================================
  // 💾 UPDATE DB
  // ==============================================
  run(

    `UPDATE tickets

     SET
       status = 'CLOSED',
       closedBy = ?,
       closedAt = ?

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
  addClose(

    interaction.guild.id,

    interaction.user.id
  );

  addHandleTime(

    interaction.guild.id,

    interaction.user.id,

    handleTime
  );

  // ==============================================
  // 🎨 EMBED
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

          name: 'Closed By',

          value:
            `${interaction.user}`,

          inline: true
        },

        {

          name: 'Ticket Type',

          value:
            ticket.type,

          inline: true
        }
      )

      .setFooter({

        text:
          'Channel will be deleted shortly'
      })

      .setTimestamp();

  // ==============================================
  // 📤 SEND CLOSE MESSAGE
  // ==============================================
  await interaction.channel.send({

    embeds: [embed]
  });

  // ==============================================
  // 📜 TRANSCRIPT
  // ==============================================
  await generateTranscript({

    client:
      interaction.client,

    channel:
      interaction.channel,

    ticket,

    closedBy:
      interaction.user
  });

  // ==============================================
  // 🗑 DELETE CHANNEL
  // ==============================================
  setTimeout(async () => {

    await interaction.channel.delete()

      .catch(() => {});

  }, 5000);

  return true;
}

module.exports = {
  closeTicket
};
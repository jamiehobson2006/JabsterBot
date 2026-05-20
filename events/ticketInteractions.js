const {
  MessageFlags
} = require('discord.js');

const {
  claimTicket
} = require('../utils/tickets/claimTicket');

const {
  closeTicket
} = require('../utils/tickets/closeTicket');

// ==================================================
// 🚫 STALE INTERACTIONS
// ==================================================
function isStaleInteractionError(error) {

  return (

    error?.code === 10062 ||

    error?.code === 40060 ||

    error?.code === 10015
  );
}

// ==================================================
// ⏳ SAFE DEFER
// ==================================================
async function safelyDefer(
  interaction
) {

  try {

    if (

      interaction.deferred ||

      interaction.replied
    ) {

      return true;
    }

    await interaction.deferReply({

      flags:
        MessageFlags.Ephemeral
    });

    return true;

  } catch (err) {

    if (
      !isStaleInteractionError(err)
    ) {

      console.error(
        'Ticket defer error:',
        err
      );
    }

    return false;
  }
}

// ==================================================
// 💬 SAFE REPLY
// ==================================================
async function safelyReply(
  interaction,
  payload
) {

  try {

    // ==============================================
    // ✏️ EDIT REPLY
    // ==============================================
    if (

      interaction.deferred ||

      interaction.replied
    ) {

      try {

        return await interaction.editReply(
          payload
        );

      } catch {

        // ==========================================
        // 🔁 FALLBACK FOLLOWUP
        // ==========================================
        return await interaction.followUp({

          ...payload,

          flags:
            MessageFlags.Ephemeral
        });
      }
    }

    // ==============================================
    // 💬 NORMAL REPLY
    // ==============================================
    return await interaction.reply({

      ...payload,

      flags:
        MessageFlags.Ephemeral
    });

  } catch (err) {

    if (
      !isStaleInteractionError(err)
    ) {

      console.error(
        'Ticket reply error:',
        err
      );
    }

    return null;
  }
}

module.exports = {

  name: 'interactionCreate',

  async execute(interaction) {

    try {

      // ==================================================
      // 🎟 TICKET DROPDOWN
      // ==================================================
      if (

        interaction.isStringSelectMenu() &&

        interaction.customId ===
        'ticket_create'
      ) {

        // handled in ticketMenus.js
        return;
      }

      // ==================================================
      // 📝 TICKET MODALS
      // ==================================================
      if (

        interaction.isModalSubmit() &&

        interaction.customId.startsWith(
          'ticket_modal_'
        )
      ) {

        // handled in ticketModals.js
        return;
      }

      // ==================================================
      // 🔘 BUTTON ONLY
      // ==================================================
      if (
        !interaction.isButton()
      ) {

        return;
      }

      // ==================================================
      // 🎟 CLAIM BUTTON
      // ==================================================
      if (

        interaction.customId ===
        'ticket_claim'
      ) {

        const deferred =
          await safelyDefer(
            interaction
          );

        if (!deferred) {
          return;
        }

        try {

          await claimTicket({

            interaction
          });

          return safelyReply(
            interaction,
            {

              content:
                '✅ Ticket claimed.'
            }
          );

        } catch (err) {

          console.error(
            'Claim Ticket Error:',
            err
          );

          return safelyReply(
            interaction,
            {

              content:
                `❌ ${err.message || 'Failed to claim ticket.'}`
            }
          );
        }
      }

      // ==================================================
      // 🔒 CLOSE BUTTON
      // ==================================================
      if (

        interaction.customId ===
        'ticket_close'
      ) {

        const deferred =
          await safelyDefer(
            interaction
          );

        if (!deferred) {
          return;
        }

        try {

          await closeTicket({

            interaction
          });

          return safelyReply(
            interaction,
            {

              content:
                '✅ Ticket closed.'
            }
          );

        } catch (err) {

          console.error(
            'Close Ticket Error:',
            err
          );

          return safelyReply(
            interaction,
            {

              content:
                `❌ ${err.message || 'Failed to close ticket.'}`
            }
          );
        }
      }

      // ==================================================
      // 🚫 UNKNOWN BUTTON
      // ==================================================
      return;

    } catch (err) {

      console.error(
        'Ticket Interaction Error:',
        err
      );

      return safelyReply(
        interaction,
        {

          content:
            '❌ Ticket system error.'
        }
      );
    }
  }
};
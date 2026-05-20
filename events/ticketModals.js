const {
  MessageFlags
} = require('discord.js');

const {
  createTicket
} = require('../utils/tickets/createTicket');

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
        'Ticket Modal Defer Error:',
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
        'Ticket Modal Reply Error:',
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
      // 📝 MODAL ONLY
      // ==================================================
      if (

        !interaction.isModalSubmit() ||

        !interaction.customId.startsWith(
          'ticket_modal_'
        )
      ) {

        return;
      }

      // ==================================================
      // ⏳ SAFE DEFER
      // ==================================================
      const deferred =
        await safelyDefer(
          interaction
        );

      if (!deferred) {
        return;
      }

      // ==============================================
      // 🎫 TYPE
      // ==============================================
      const rawType =
        interaction.customId.replace(
          'ticket_modal_',
          ''
        );

      const type =
        rawType

          .replace(/[^a-zA-Z0-9_-]/g, '')

          .slice(0, 30);

      if (!type.length) {

        return safelyReply(
          interaction,
          {

            content:
              '❌ Invalid ticket type.'
          }
        );
      }

      // ==============================================
      // 📝 REASON
      // ==============================================
      let reason =
        interaction.fields.getTextInputValue(
          'ticket_reason'
        );

      // ==============================================
      // 🧹 CLEAN INPUT
      // ==============================================
      reason = reason

        .replace(/@everyone|@here/g, '[mention removed]')

        .replace(/\s+/g, ' ')

        .trim();

      // ==============================================
      // 🚫 INVALID REASON
      // ==============================================
      if (
        reason.length < 5
      ) {

        return safelyReply(
          interaction,
          {

            content:
              '❌ Please provide more detail.'
          }
        );
      }

      // ==============================================
      // ✂️ LIMIT LENGTH
      // ==============================================
      if (
        reason.length > 1000
      ) {

        reason =
          reason.slice(0, 1000);
      }

      // ==============================================
      // 🎟 CREATE TICKET
      // ==============================================
      try {

        const result =
          await createTicket({

            interaction,

            type,

            reason
          });

        // ==========================================
        // ❌ FAILED CREATION
        // ==========================================
        if (
          !result ||
          !result.channel
        ) {

          return safelyReply(
            interaction,
            {

              content:
                '❌ Failed to create ticket.'
            }
          );
        }

        // ==========================================
        // ✅ SUCCESS
        // ==========================================
        return safelyReply(
          interaction,
          {

            content:

              `✅ Ticket created: ${result.channel}`
          }
        );

      } catch (err) {

        console.error(
          'Create Ticket Error:',
          err
        );

        return safelyReply(
          interaction,
          {

            content:

              `❌ ${err.message || 'Failed to create ticket.'}`
          }
        );
      }

    } catch (err) {

      console.error(
        'Ticket Modal Error:',
        err
      );

      if (
        isStaleInteractionError(err)
      ) {

        return;
      }

      return safelyReply(
        interaction,
        {

          content:
            '❌ Failed to create ticket.'
        }
      );
    }
  }
};
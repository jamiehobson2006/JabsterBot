const {

  EmbedBuilder,

  PermissionsBitField,

  ModalBuilder,

  TextInputBuilder,

  TextInputStyle,

  ActionRowBuilder

} = require('discord.js');

const {
  get,
  run
} = require('../database');

const {
  createTicket
} = require('../utils/tickets/createTicket');

const {
  generateTranscript
} = require('../utils/tickets/transcript');

module.exports = {

  name: 'interactionCreate',

  async execute(interaction) {

    try {

      // ==================================================
      // 🎟 TICKET DROPDOWN
      // ==================================================
      if (

        interaction.isStringSelectMenu() &&

        interaction.customId === 'ticket_create'
      ) {

        const type =
          interaction.values[0];

        // ==============================================
        // 📝 MODAL
        // ==============================================
        const modal =
          new ModalBuilder()

            .setCustomId(
              `ticket_modal_${type}`
            )

            .setTitle(
              'Create Ticket'
            );

        const reasonInput =
          new TextInputBuilder()

            .setCustomId(
              'ticket_reason'
            )

            .setLabel(
              'Describe your issue'
            )

            .setStyle(
              TextInputStyle.Paragraph
            )

            .setPlaceholder(

              'Provide as much detail as possible...'
            )

            .setRequired(true)

            .setMaxLength(1000);

        const row =
          new ActionRowBuilder()

            .addComponents(reasonInput);

        modal.addComponents(row);

        return interaction.showModal(modal);
      }

      // ==================================================
      // 📝 MODAL SUBMIT
      // ==================================================
      if (

        interaction.isModalSubmit() &&

        interaction.customId.startsWith(
          'ticket_modal_'
        )
      ) {

        await interaction.deferReply({

          ephemeral: true
        });

        // ==============================================
        // 🎫 TYPE
        // ==============================================
        const type =
          interaction.customId.replace(
            'ticket_modal_',
            ''
          );

        // ==============================================
        // 📝 REASON
        // ==============================================
        const reason =
          interaction.fields.getTextInputValue(
            'ticket_reason'
          );

        try {

          const result =
            await createTicket({

              interaction,

              type,

              reason
            });

          return interaction.editReply({

            content:

              `✅ Ticket created: ${result.channel}`
          });

        } catch (err) {

          return interaction.editReply({

            content:
              `❌ ${err.message}`
          });
        }
      }

      // ==================================================
      // 🔒 CLOSE BUTTON
      // ==================================================
      if (

        interaction.isButton() &&

        interaction.customId === 'ticket_close'
      ) {

        await interaction.deferReply({

          ephemeral: true
        });

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

          return interaction.editReply({

            content:
              '❌ This is not a valid ticket.'
          });
        }

        // ==============================================
        // 🔍 FETCH SETTINGS
        // ==============================================
        const settings = get(

          `SELECT *
           FROM ticket_settings
           WHERE guildId = ?
           AND type = ?`,

          [
            interaction.guild.id,
            ticket.type
          ]
        );

        // ==============================================
        // 🔐 STAFF ROLE CHECK
        // ==============================================
        const hasStaffRole =

          settings?.roleId &&

          interaction.member.roles.cache.has(
            settings.roleId
          );

        if (

          !hasStaffRole &&

          !interaction.memberPermissions.has(
            PermissionsBitField.Flags.Administrator
          )
        ) {

          return interaction.editReply({

            content:
              '❌ You cannot close tickets.'
          });
        }

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
        // 🎨 EMBED
        // ==============================================
        const embed =
          new EmbedBuilder()

            .setColor(0xED4245)

            .setTitle(
              '🔒 Ticket Closed'
            )

            .setDescription(

              `Closed by ${interaction.user}`
            )

            .setTimestamp();

        await interaction.channel.send({

          embeds: [embed]
        });

        // ==============================================
        // 📜 TRANSCRIPT
        // ==============================================
        await generateTranscript({

          client: interaction.client,

          channel: interaction.channel,

          ticket,

          closedBy: interaction.user
        });

        await interaction.editReply({

          content:
            '✅ Ticket closed.'
        });

        // ==============================================
        // 🗑 DELETE CHANNEL
        // ==============================================
        setTimeout(async () => {

          await interaction.channel.delete()

            .catch(() => {});

        }, 5000);
      }

      // ==================================================
      // 👮 CLAIM BUTTON
      // ==================================================
      if (

        interaction.isButton() &&

        interaction.customId === 'ticket_claim'
      ) {

        await interaction.deferReply({

          ephemeral: true
        });

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

          return interaction.editReply({

            content:
              '❌ Invalid ticket.'
          });
        }

        // ==============================================
        // 🚫 ALREADY CLAIMED
        // ==============================================
        if (ticket.claimedBy) {

          return interaction.editReply({

            content:
              '❌ This ticket is already claimed.'
          });
        }

        // ==============================================
        // 🔍 FETCH SETTINGS
        // ==============================================
        const settings = get(

          `SELECT *
           FROM ticket_settings
           WHERE guildId = ?
           AND type = ?`,

          [
            interaction.guild.id,
            ticket.type
          ]
        );

        // ==============================================
        // 🔐 STAFF ROLE CHECK
        // ==============================================
        const hasStaffRole =

          settings?.roleId &&

          interaction.member.roles.cache.has(
            settings.roleId
          );

        if (

          !hasStaffRole &&

          !interaction.memberPermissions.has(
            PermissionsBitField.Flags.Administrator
          )
        ) {

          return interaction.editReply({

            content:
              '❌ You cannot claim tickets.'
          });
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

            .setTimestamp();

        await interaction.channel.send({

          embeds: [embed]
        });

        return interaction.editReply({

          content:
            '✅ Ticket claimed.'
        });
      }

    } catch (err) {

      console.error(
        'Ticket Interaction Error:',
        err
      );
    }
  }
};
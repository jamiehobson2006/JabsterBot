const {

  SlashCommandBuilder,

  PermissionsBitField,

  ChannelType,

  EmbedBuilder

} = require('discord.js');

const {
  run,
  get
} = require('../../database');

const ticketTypes =
  require('../../utils/tickets/ticketTypes');

module.exports = {

  data:
    new SlashCommandBuilder()

      .setName('ticketsetup')

      .setDescription(
        'Configure a ticket type'
      )

      // ========================
      // 🎫 TYPE
      // ========================
      .addStringOption(option => {

        option

          .setName('type')

          .setDescription(
            'Ticket type'
          )

          .setRequired(true);

        for (const key of Object.keys(ticketTypes)) {

          option.addChoices({

            name:
              ticketTypes[key].name,

            value: key
          });
        }

        return option;
      })

      // ========================
      // 📂 CATEGORY
      // ========================
      .addChannelOption(option =>

        option

          .setName('category')

          .setDescription(
            'Category for this ticket type'
          )

          .addChannelTypes(
            ChannelType.GuildCategory
          )

          .setRequired(true)
      )

      // ========================
      // 👮 STAFF ROLE
      // ========================
      .addRoleOption(option =>

        option

          .setName('staff_role')

          .setDescription(
            'Staff role for tickets'
          )

          .setRequired(true)
      )

      // ========================
      // ⚡ ENABLED
      // ========================
      .addBooleanOption(option =>

        option

          .setName('enabled')

          .setDescription(
            'Enable this ticket type'
          )

          .setRequired(true)
      ),

  async execute(interaction) {

    try {

      // ==========================================
      // 🔐 PERMISSION CHECK
      // ==========================================
      if (

        !interaction.memberPermissions.has(
          PermissionsBitField.Flags.Administrator
        )
      ) {

        return interaction.editReply({

          content:
            '❌ You need Administrator permission.'
        });
      }

      // ==========================================
      // 📥 OPTIONS
      // ==========================================
      const type =
        interaction.options.getString(
          'type',
          true
        );

      const category =
        interaction.options.getChannel(
          'category',
          true
        );

      const role =
        interaction.options.getRole(
          'staff_role',
          true
        );

      const enabled =
        interaction.options.getBoolean(
          'enabled',
          true
        );

      // ==========================================
      // 💾 SAVE
      // ==========================================
      run(

        `INSERT INTO ticket_settings
         (
           guildId,
           type,
           enabled,
           categoryId,
           roleId
         )

         VALUES (?, ?, ?, ?, ?)

         ON CONFLICT(guildId, type)

         DO UPDATE SET

           enabled = excluded.enabled,

           categoryId = excluded.categoryId,

           roleId = excluded.roleId`,

        [

          interaction.guild.id,

          type,

          enabled ? 1 : 0,

          category.id,

          role.id
        ]
      );

      // ==========================================
      // 🎨 EMBED
      // ==========================================
      const embed =
        new EmbedBuilder()

          .setColor(
            enabled
              ? 0x57F287
              : 0xED4245
          )

          .setTitle(
            '🎫 Ticket System Configured'
          )

          .addFields(

            {

              name: 'Type',

              value:
                ticketTypes[type].name,

              inline: true
            },

            {

              name: 'Enabled',

              value:
                enabled
                  ? 'Yes'
                  : 'No',

              inline: true
            },

            {

              name: 'Category',

              value:
                `${category}`,

              inline: true
            },

            {

              name: 'Staff Role',

              value:
                `${role}`,

              inline: true
            }
          )

          .setFooter({

            text:
              `Configured by ${interaction.user.tag}`
          })

          .setTimestamp();

      return interaction.editReply({

        embeds: [embed]
      });

    } catch (err) {

      console.error(
        'TicketSetup Error:',
        err
      );

      return interaction.editReply({

        content:
          '❌ Failed to configure ticket system.'
      });
    }
  }
};
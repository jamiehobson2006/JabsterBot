const {

  SlashCommandBuilder,

  PermissionsBitField,

  ChannelType,

  EmbedBuilder

} = require('discord.js');

const {
  run
} = require('../../database');

const ticketTypes =
  require('../../utils/tickets/ticketTypes');

module.exports = {

  cooldown: 5000,

  data:
    new SlashCommandBuilder()

      .setName('ticketsetup')

      .setDescription(
        'Configure a ticket type'
      )

      // ==========================================
      // 🎫 TYPE
      // ==========================================
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

      // ==========================================
      // 📂 CATEGORY
      // ==========================================
      .addChannelOption(option =>

        option

          .setName('category')

          .setDescription(
            'Category for this ticket type'
          )

          .addChannelTypes(
            ChannelType.GuildCategory
          )

          .setRequired(false)
      )

      // ==========================================
      // 👮 STAFF ROLE
      // ==========================================
      .addRoleOption(option =>

        option

          .setName('staff_role')

          .setDescription(
            'Staff role for tickets'
          )

          .setRequired(false)
      )

      // ==========================================
      // ⚡ ENABLED
      // ==========================================
      .addBooleanOption(option =>

        option

          .setName('enabled')

          .setDescription(
            'Enable this ticket type'
          )

          .setRequired(false)
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
          false
        );

      const role =
        interaction.options.getRole(
          'staff_role',
          false
        );

      const enabledOption =
        interaction.options.getBoolean(
          'enabled',
          false
        );

      const enabled =
        enabledOption ?? true;

      const botMember =
        interaction.guild.members.me;

      // ==========================================
      // 🛡 CATEGORY VALIDATION
      // ==========================================
      const perms =
        category
          ? category.permissionsFor(
              botMember
            )
          : null;

      const missing = [];

      if (

        category &&
        !perms?.has(
          PermissionsBitField.Flags.ViewChannel
        )
      ) {

        missing.push(
          'View Channel'
        );
      }

      if (

        category &&
        !perms?.has(
          PermissionsBitField.Flags.SendMessages
        )
      ) {

        missing.push(
          'Send Messages'
        );
      }

      if (

        category &&
        !perms?.has(
          PermissionsBitField.Flags.ManageChannels
        )
      ) {

        missing.push(
          'Manage Channels'
        );
      }

      if (missing.length) {

        return interaction.editReply({

          content:

            `❌ Missing category permissions:\n\n` +

            `• ${missing.join('\n• ')}`
        });
      }

      // ==========================================
      // 🚫 ROLE HIERARCHY CHECK
      // ==========================================
      if (

        role &&
        role.position >=
        botMember.roles.highest.position
      ) {

        return interaction.editReply({

          content:

            '❌ That role is above my highest role.'
        });
      }

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

          category?.id || null,

          role?.id || null
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

          .setDescription(

            `Successfully updated the **${ticketTypes[type].name}** ticket configuration.`
          )

          .addFields(

            {

              name: '🎫 Ticket Type',

              value:
                ticketTypes[type].name,

              inline: true
            },

            {

              name: '⚡ Status',

              value:

                enabled

                  ? 'Enabled'

                  : 'Disabled',

              inline: true
            },

            {

              name: '📂 Category',

              value:
                category
                  ? `${category}`
                  : 'No category set',

              inline: true
            },

            {

              name: '👮 Staff Role',

              value:
                role
                  ? `${role}`
                  : 'No staff role set',

              inline: true
            },

            {

              name: '📊 Features',

              value:

                '• Ticket claiming\n' +
                '• Ticket closing\n' +
                '• Transcript logging\n' +
                '• Staff permissions',

              inline: false
            }
          )

          .setFooter({

            text:
              `Configured by ${interaction.user.tag}`
          })

          .setTimestamp();

      // ==========================================
      // 📤 RESPONSE
      // ==========================================
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

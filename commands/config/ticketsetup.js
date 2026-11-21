const {

  SlashCommandBuilder,

  PermissionsBitField,

  ChannelType,

  EmbedBuilder

} = require('discord.js');

const {
  get,
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

      .addStringOption(option => option.setName('category_id')
        .setDescription('Alternative category ID if Discord rejects the category picker')
        .setMinLength(16).setMaxLength(22))

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

      const existing = get(
        `SELECT categoryId, roleId, enabled FROM ticket_settings
         WHERE guildId = ? AND type = ?`,
        [interaction.guild.id, type]
      );

      if (!Object.hasOwn(ticketTypes, type)) throw new Error('Unknown ticket type. Refresh Discord and select a ticket type again.');
      const enabled = enabledOption ?? (existing ? Boolean(existing.enabled) : true);
      const validation = require('../../utils/tickets/configuration');

      const explicitCategoryId = interaction.options.getString('category_id');
      if (explicitCategoryId && !/^\d{16,22}$/.test(explicitCategoryId)) throw new Error('Category ID must contain only the digits copied from a Discord category.');
      if (category && explicitCategoryId && category.id !== explicitCategoryId) throw new Error('Choose category or category_id, not two different destinations.');
      const categoryId = explicitCategoryId || category?.id || existing?.categoryId || null;
      const roleId = role?.id || existing?.roleId || null;
      const effectiveCategory = enabled || category || explicitCategoryId ? await validation.fetchCategory(interaction.guild, categoryId) : null;
      if ((category || explicitCategoryId) && !effectiveCategory) throw new Error('That ID does not identify an accessible category in this server.');
      const effectiveRole = enabled || role ? await validation.fetchStaffRole(interaction.guild, roleId) : null;

      if (enabled && (!effectiveCategory || !effectiveRole)) {
        return interaction.editReply({
          content: 'A valid category and staff role are both required before this ticket type can be enabled.'
        });
      }

      if (enabled && effectiveCategory.type !== ChannelType.GuildCategory) {
        return interaction.editReply({
          content: 'The configured ticket destination is no longer a category. Choose a new category.'
        });
      }

      if (effectiveRole?.id === interaction.guild.roles.everyone.id || effectiveRole?.managed) {
        return interaction.editReply({
          content: 'Choose a normal staff role other than @everyone or an integration-managed role.'
        });
      }

      const botMember = await interaction.guild.members.fetchMe({ force: true });

      // ==========================================
      // 🛡 CATEGORY VALIDATION
      // ==========================================
      const perms =
        effectiveCategory
          ? effectiveCategory.permissionsFor(
              botMember
            )
          : null;

      const missing = [];

      if (

        enabled && effectiveCategory &&
        !perms?.has(
          PermissionsBitField.Flags.ViewChannel
        )
      ) {

        missing.push(
          'View Channel'
        );
      }

      if (

        enabled && effectiveCategory &&
        !perms?.has(
          PermissionsBitField.Flags.SendMessages
        )
      ) {

        missing.push(
          'Send Messages'
        );
      }

      if (

        enabled && effectiveCategory &&
        !perms?.has(
          PermissionsBitField.Flags.ManageChannels
        )
      ) {

        missing.push(
          'Manage Channels'
        );
      }

      if (enabled && !perms?.has(PermissionsBitField.Flags.EmbedLinks)) missing.push('Embed Links');

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

        enabled && effectiveRole &&
        effectiveRole.position >=
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

           categoryId =
             COALESCE(
               excluded.categoryId,
               ticket_settings.categoryId
             ),

           roleId =
             COALESCE(
               excluded.roleId,
               ticket_settings.roleId
             )`,

        [

          interaction.guild.id,

          type,

          enabled ? 1 : 0,

          effectiveCategory?.id || categoryId,

          effectiveRole?.id || roleId
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
                effectiveCategory
                  ? `${effectiveCategory}`
                  : 'No category set',

              inline: true
            },

            {

              name: '👮 Staff Role',

              value:
                effectiveRole
                  ? `${effectiveRole}`
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
          `Failed to configure tickets: ${err.message || 'Unknown error.'}`,
        allowedMentions: { parse: [] }
      });
    }
  }
};

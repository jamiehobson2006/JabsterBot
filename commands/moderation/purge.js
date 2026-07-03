const {

  PermissionsBitField,

  EmbedBuilder,

  SlashCommandBuilder,

  MessageType,

  ChannelType

} = require('discord.js');

const {

  sendLog,

  createLogEmbed

} = require('../../utils/logger');

module.exports = {

  cooldown: 5000,

  data:
    new SlashCommandBuilder()

      .setName('purge')

      .setDescription(
        'Delete multiple messages'
      )

      .addIntegerOption(option =>

        option

          .setName('amount')

          .setDescription(
            'Number of messages to delete (1-100)'
          )

          .setRequired(true)

          .setMinValue(1)

          .setMaxValue(100)
      )

      .addUserOption(option =>

        option

          .setName('user')

          .setDescription(
            'Only delete messages from this user'
          )
      )

      .addStringOption(option =>

        option

          .setName('type')

          .setDescription(
            'Filter message type'
          )

          .addChoices(

            {

              name: 'Humans',

              value: 'humans'
            },

            {

              name: 'Bots',

              value: 'bots'
            },

            {

              name: 'Links',

              value: 'links'
            },

            {

              name: 'Attachments',

              value: 'attachments'
            },

            {

              name: 'Webhooks',

              value: 'webhooks'
            }
          )
      )

      .addStringOption(option =>

        option

          .setName('contains')

          .setDescription(
            'Only delete messages containing this text'
          )

          .setMaxLength(100)
      ),

  async execute(interaction) {

    try {

      // ==========================================
      // 🔐 USER PERMISSION
      // ==========================================
      if (

        !interaction.memberPermissions.has(

          PermissionsBitField.Flags.ManageMessages
        )
      ) {

        return interaction.editReply({

          content:

            '❌ You need **Manage Messages** permission.'
        });
      }

      // ==========================================
      // 🤖 BOT PERMISSION
      // ==========================================
      const botMember =
        interaction.guild.members.me;

      if (

        !botMember.permissions.has(

          PermissionsBitField.Flags.ManageMessages
        )
      ) {

        return interaction.editReply({

          content:

            '❌ I do not have permission to delete messages.'
        });
      }

      // ==========================================
      // 📺 CHANNEL CHECK
      // ==========================================
      if (

        interaction.channel.type ===
        ChannelType.GuildAnnouncement
      ) {

        return interaction.editReply({

          content:

            '❌ Purge cannot be used in announcement channels.'
        });
      }

      // ==========================================
      // 📥 OPTIONS
      // ==========================================
      const amount =
        interaction.options.getInteger(

          'amount',

          true
        );

      const target =
        interaction.options.getUser(
          'user'
        );

      const type =
        interaction.options.getString(
          'type'
        );

      const contains =
        interaction.options.getString(
          'contains'
        );

      // ==========================================
      // 🔒 LARGE PURGE PROTECTION
      // ==========================================
      if (

        amount >= 50 &&

        !interaction.memberPermissions.has(

          PermissionsBitField.Flags.Administrator
        )
      ) {

        return interaction.editReply({

          content:

            '❌ Only administrators can purge 50+ messages.'
        });
      }

      // ==========================================
      // 🚫 FILTER CONFLICT
      // ==========================================
      if (

        target &&

        type
      ) {

        return interaction.editReply({

          content:

            '❌ You cannot use both **user** and **type** filters together.'
        });
      }

      // ==========================================
      // 📥 FETCH MESSAGES
      // ==========================================
      let fetched =
        [];

      let lastId =
        null;

      while (

        fetched.length < amount + 50
      ) {

        const batch =
          await interaction.channel.messages.fetch({

            limit: 100,

            before: lastId || undefined
          });

        if (!batch.size) {

          break;
        }

        fetched.push(
          ...batch.values()
        );

        lastId =
          batch.last().id;

        if (

          fetched.length >= 500
        ) {

          break;
        }
      }

      // ==========================================
      // 🔍 FILTERING
      // ==========================================
      let filtered =
        fetched;

      // ==========================================
      // 👤 USER FILTER
      // ==========================================
      if (target) {

        filtered =
          filtered.filter(

            m =>
              m.author.id ===
              target.id
          );
      }

      // ==========================================
      // 🤖 TYPE FILTERS
      // ==========================================
      if (type === 'bots') {

        filtered =
          filtered.filter(

            m =>
              m.author.bot
          );
      }

      if (type === 'humans') {

        filtered =
          filtered.filter(

            m =>
              !m.author.bot
          );
      }

      if (type === 'links') {

        filtered =
          filtered.filter(

            m =>

              /(https?:\/\/|discord\.gg)/i

                .test(m.content)
          );
      }

      if (type === 'attachments') {

        filtered =
          filtered.filter(

            m =>
              m.attachments.size > 0
          );
      }

      if (type === 'webhooks') {

        filtered =
          filtered.filter(

            m =>
              m.webhookId
          );
      }

      // ==========================================
      // 🔎 CONTAINS FILTER
      // ==========================================
      if (contains) {

        filtered =
          filtered.filter(

            m =>

              m.content

                .toLowerCase()

                .includes(

                  contains.toLowerCase()
                )
          );
      }

      // ==========================================
      // 🧹 SAFE FILTERS
      // ==========================================
      filtered =
        filtered.filter(m =>

          !m.pinned &&

          m.deletable &&

          m.type ===
          MessageType.Default
        );

      // ==========================================
      // ✂️ LIMIT
      // ==========================================
      const toDelete =
        filtered.slice(
          0,
          amount
        );

      // ==========================================
      // ❌ NO RESULTS
      // ==========================================
      if (!toDelete.length) {

        return interaction.editReply({

          content:

            '❌ No messages found matching your filters.'
        });
      }

      // ==========================================
      // 🧹 BULK DELETE
      // ==========================================
      const deleted =
        await interaction.channel.bulkDelete(

          toDelete,

          true
        );

      const deletedCount =
        deleted.size;

      const skipped =
        toDelete.length -

        deletedCount;

      // ==========================================
      // ❌ NONE DELETED
      // ==========================================
      if (!deletedCount) {

        return interaction.editReply({

          content:

            '❌ Messages may be older than 14 days.'
        });
      }

      // ==========================================
      // 🎨 EMBED
      // ==========================================
      const embed =
        new EmbedBuilder()

          .setColor(
            0xE67E22
          )

          .setTitle(
            '🧹 Messages Cleared'
          )

          .setDescription(

            target

              ? `Deleted **${deletedCount} messages** from ${target}`

              : type === 'bots'

                ? `Deleted **${deletedCount} bot messages**`

                : type === 'humans'

                  ? `Deleted **${deletedCount} human messages**`

                  : type === 'links'

                    ? `Deleted **${deletedCount} link messages**`

                    : type === 'attachments'

                      ? `Deleted **${deletedCount} attachment messages**`

                      : type === 'webhooks'

                        ? `Deleted **${deletedCount} webhook messages**`

                        : contains

                          ? `Deleted **${deletedCount} matching messages**`

                          : `Deleted **${deletedCount} messages**`
          )

          .addFields(

            {

              name: '📺 Channel',

              value:
                `${interaction.channel}`,

              inline: true
            },

            {

              name: '🛡 Moderator',

              value:
                `${interaction.user}`,

              inline: true
            }
          )

          .setFooter({

            text:
              `Purge System`
          })

          .setTimestamp();

      // ==========================================
      // ⚠️ SKIPPED
      // ==========================================
      if (skipped > 0) {

        embed.addFields({

          name: '⚠️ Skipped',

          value:

            `${skipped} messages were older than 14 days`
        });
      }

      // ==========================================
      // 🔎 FILTER INFO
      // ==========================================
      if (contains) {

        embed.addFields({

          name: '🔎 Contains Filter',

          value:
            `\`${contains}\``
        });
      }

      // ==========================================
      // ✅ RESPONSE
      // ==========================================
      await interaction.editReply({

        embeds: [embed]
      });

      // ==========================================
      // 🗑 AUTO DELETE REPLY
      // ==========================================
      setTimeout(async () => {

        try {

          await interaction.deleteReply();

        } catch {}

      }, 3000);

      // ==========================================
      // 📜 LOG
      // ==========================================
      const logEmbed =
        createLogEmbed({

          action:
            'PURGE',

          user: {

            id:
              interaction.channel.id,

            tag:
              `#${interaction.channel.name}`
          },

          moderator:
            interaction.user,

          reason:

            `Deleted ${deletedCount} messages` +

            (
              target

                ? ` from ${target.tag}`

                : ''
            ) +

            (
              type

                ? ` | Filter: ${type}`

                : ''
            ) +

            (
              contains

                ? ` | Contains: ${contains}`

                : ''
            ),

          caseId:
            null
        });

      await sendLog(

        interaction.client,

        interaction.guild.id,

        logEmbed
      );

    } catch (err) {

      console.error(
        'Purge Error:',
        err
      );

      if (

        interaction.deferred ||

        interaction.replied
      ) {

        return interaction.editReply({

          content:
            '❌ Failed to purge messages.'
        });
      }

      return interaction.reply({

        content:
          '❌ Failed to purge messages.',

        flags: 64
      });
    }
  }
};
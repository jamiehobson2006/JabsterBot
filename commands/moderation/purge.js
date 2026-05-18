const {
  PermissionsBitField,
  EmbedBuilder,
  SlashCommandBuilder
} = require('discord.js');

const {
  sendLog,
  createLogEmbed
} = require('../../utils/logger');

module.exports = {

  cooldown: 5000,

  data: new SlashCommandBuilder()

    .setName('purge')

    .setDescription('Delete multiple messages')

    .addIntegerOption(option =>
      option
        .setName('amount')
        .setDescription('Number of messages to delete (1-100)')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100)
    )

    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('Only delete messages from this user')
    )

    .addStringOption(option =>
      option
        .setName('type')
        .setDescription('Filter message type')
        .addChoices(

          {
            name: 'Humans',
            value: 'humans'
          },

          {
            name: 'Bots',
            value: 'bots'
          }
        )
    ),

  async execute(interaction) {

    try {

      // ========================
      // 🔐 USER PERMISSION
      // ========================
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

      const botMember =
        interaction.guild.members.me;

      // ========================
      // 🤖 BOT PERMISSION
      // ========================
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

      // ========================
      // 📥 OPTIONS
      // ========================
      const amount =
        interaction.options.getInteger(
          'amount',
          true
        );

      const target =
        interaction.options.getUser('user');

      const type =
        interaction.options.getString('type');

      // ========================
      // 🚫 FILTER CONFLICT
      // ========================
      if (target && type) {

        return interaction.editReply({
          content:
            '❌ You cannot use both **user** and **type** filters together.'
        });
      }

      // ========================
      // 📥 FETCH MESSAGES
      // ========================
      const fetched =
        await interaction.channel.messages.fetch({
          limit: 100
        });

      let filtered = fetched;

      if (target) {

        filtered =
          filtered.filter(
            m => m.author.id === target.id
          );
      }

      // ========================
      // 🤖 TYPE FILTER
      // ========================
      if (type === 'bots') {

        filtered =
          filtered.filter(
            m => m.author.bot
          );
      }

      if (type === 'humans') {

        filtered =
          filtered.filter(
            m => !m.author.bot
          );
      }

      // ========================
      // 🧹 SAFE FILTERS
      // ========================
      filtered =
        filtered.filter(m =>

          !m.pinned &&
          m.deletable &&
          m.type === 0
        );

      // ========================
      // ✂️ LIMIT
      // ========================
      const toDelete =
        filtered.first(amount);

      if (!toDelete.length) {

        return interaction.editReply({
          content:
            '❌ No messages found matching your filter.'
        });
      }

      // ========================
      // 🧹 DELETE
      // ========================
      const deleted =
        await interaction.channel.bulkDelete(
          toDelete,
          true
        );

      const deletedCount =
        deleted.size;

      const skipped =
        toDelete.length - deletedCount;

      if (!deletedCount) {

        return interaction.editReply({
          content:
            '❌ Messages may be older than 14 days.'
        });
      }

      // ========================
      // 🎨 RESPONSE
      // ========================
      const embed =
        new EmbedBuilder()

          .setColor(0xE67E22)

          .setTitle('🧹 Messages Cleared')

          .setDescription(

            target

              ? `Deleted **${deletedCount} messages** from ${target}`

              : type === 'bots'

                ? `Deleted **${deletedCount} bot messages**`

                : type === 'humans'

                  ? `Deleted **${deletedCount} human messages**`

                  : `Deleted **${deletedCount} messages**`
          )

          .setFooter({
            text:
              `By ${interaction.user.tag}`
          })

          .setTimestamp();

      // ========================
      // ⚠️ SKIPPED
      // ========================
      if (skipped > 0) {

        embed.addFields({

          name: '⚠️ Skipped',

          value:
            `${skipped} messages were older than 14 days`
        });
      }

      // ========================
      // ✅ RESPONSE
      // ========================
      await interaction.editReply({
        embeds: [embed]
      });

      // ========================
      // 🗑 AUTO DELETE REPLY
      // ========================
      setTimeout(() => {

        interaction.deleteReply()
          .catch(() => {});

      }, 2000);

      // ========================
      // 📜 LOG
      // ========================
      const logEmbed =
        createLogEmbed({

          action: 'PURGE',

          user: {
            id: 'CHANNEL',
            tag: interaction.channel.name
          },

          moderator: interaction.user,

          reason:
            target

              ? `Deleted ${deletedCount} messages from ${target.tag}`

              : type === 'bots'

                ? `Deleted ${deletedCount} bot messages`

                : type === 'humans'

                  ? `Deleted ${deletedCount} human messages`

                  : `Deleted ${deletedCount} messages`,

          caseId: null
        });

      await sendLog(
        interaction.client,
        interaction.guild.id,
        logEmbed
      );

    } catch (err) {

      console.error('Purge Error:', err);

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

        ephemeral: true
      });
    }
  }
};
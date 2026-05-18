const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
  SlashCommandBuilder
} = require('discord.js');

const {
  get,
  run
} = require('../../database');

module.exports = {

  cooldown: 5000,

  data: new SlashCommandBuilder()

    .setName('suggest')

    .setDescription('Submit a suggestion')

    .addStringOption(option =>
      option
        .setName('text')
        .setDescription('Your suggestion')
        .setRequired(true)
        .setMaxLength(500)
    ),

  async execute(interaction) {

    try {

      const text =
        interaction.options.getString(
          'text',
          true
        );

      // ========================
      // 🔄 GET SETTINGS
      // ========================
      const settings =
        get(

          `SELECT suggestionChannelId
          FROM guild_settings
          WHERE guildId = ?`,

          [interaction.guild.id]
        );

      if (!settings?.suggestionChannelId) {

        return interaction.editReply({
          content:
            '❌ Suggestion channel not set.'
        });
      }

      const channel =
        interaction.guild.channels.cache.get(
          settings.suggestionChannelId
        );

      if (
        !channel ||
        !channel.isTextBased()
      ) {

        return interaction.editReply({
          content:
            '❌ Suggestion channel is invalid.'
        });
      }

      // ========================
      // 🤖 BOT PERMISSIONS
      // ========================
      const perms =
        channel.permissionsFor(
          interaction.guild.members.me
        );

      if (
        !perms.has([

          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.EmbedLinks,
          PermissionsBitField.Flags.AddReactions,
          PermissionsBitField.Flags.ReadMessageHistory

        ])
      ) {

        return interaction.editReply({
          content:
            '❌ I am missing permissions in the suggestion channel.'
        });
      }

      // ========================
      // 🚫 DUPLICATE CHECK
      // ========================
      const recent =
        get(

          `SELECT * FROM suggestions
          WHERE guildId = ?
          AND userId = ?
          AND content = ?
          AND timestamp > ?`,

          [
            interaction.guild.id,
            interaction.user.id,
            text,
            Date.now() - (5 * 60 * 1000)
          ]
        );

      if (recent) {

        return interaction.editReply({
          content:
            '⚠️ You already submitted this suggestion recently.'
        });
      }

      // ========================
      // 🎨 EMBED
      // ========================
      const embed =
        new EmbedBuilder()

          .setColor(0x5865F2)

          .setTitle('💡 New Suggestion')

          .setDescription(text)

          .addFields(

            {
              name: '👤 Author',
              value: `${interaction.user}`,
              inline: true
            },

            {
              name: '📊 Status',
              value: '⏳ Pending',
              inline: true
            },

            {
              name: '👍 Votes',
              value: '✅ 0 • ❌ 0',
              inline: true
            }
          )

          .setFooter({
            text:
              `User ID: ${interaction.user.id}`
          })

          .setTimestamp();

      // ========================
      // 🔘 BUTTONS
      // ========================
      const row =
        new ActionRowBuilder()

          .addComponents(

            new ButtonBuilder()

              .setCustomId('suggest_accept')

              .setLabel('Accept')

              .setStyle(ButtonStyle.Success),

            new ButtonBuilder()

              .setCustomId('suggest_deny')

              .setLabel('Deny')

              .setStyle(ButtonStyle.Danger)
          );

      // ========================
      // 📤 SEND MESSAGE
      // ========================
      const msg =
        await channel.send({

          embeds: [embed],

          components: [row]
        });

      // ========================
      // 👍 COMMUNITY VOTING
      // ========================
      await msg.react('✅');
      await msg.react('❌');

      // ========================
      // 💾 SAVE DB
      // ========================
      run(

        `INSERT INTO suggestions
        (guildId, messageId, userId, content, status, timestamp)

        VALUES (?, ?, ?, ?, ?, ?)`,

        [
          interaction.guild.id,
          msg.id,
          interaction.user.id,
          text,
          'PENDING',
          Date.now()
        ]
      );

      // ========================
      // ⏳ AUTO VOTE UPDATER
      // ========================
      setTimeout(async () => {

        try {

          const fetched =
            await msg.fetch();

          const upvote =
            fetched.reactions.cache.get('✅');

          const downvote =
            fetched.reactions.cache.get('❌');

          const upvotes =
            Math.max(
              (upvote?.count || 1) - 1,
              0
            );

          const downvotes =
            Math.max(
              (downvote?.count || 1) - 1,
              0
            );

          const updatedEmbed =
            EmbedBuilder.from(
              fetched.embeds[0]
            );

          updatedEmbed.data.fields =
            updatedEmbed.data.fields.map(field => {

              if (
                field.name === '👍 Votes'
              ) {

                field.value =
                  `✅ ${upvotes} • ❌ ${downvotes}`;
              }

              return field;
            });

          await fetched.edit({
            embeds: [updatedEmbed]
          });

        } catch {}
      }, 5000);

      // ========================
      // ✅ RESPONSE
      // ========================
      await interaction.editReply({

        content:
          `✅ Suggestion submitted successfully.\n${msg.url}`
      });

      // ========================
      // 🗑 AUTO DELETE
      // ========================
      setTimeout(() => {

        interaction
          .deleteReply()
          .catch(() => {});

      }, 4000);

    } catch (err) {

      console.error(
        'Suggest Error:',
        err
      );

      if (
        interaction.deferred ||
        interaction.replied
      ) {

        return interaction.editReply({
          content:
            '❌ Failed to submit suggestion.'
        });
      }

      return interaction.reply({

        content:
          '❌ Failed to submit suggestion.',

        ephemeral: true
      });
    }
  }
};
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionsBitField,
  SlashCommandBuilder
} = require('discord.js');

const {
  get,
  run
} = require('../../database');

const {
  findCensoredTerm,
  listCensorTerms
} = require('../../utils/censor');

const { findRacistTerm } = require('../../utils/racismFilter');

const {
  detectPhishing,
  guildPhishingLists
} = require('../../utils/phishingProtection');

module.exports = {
  cooldown: 5000,

  data:
    new SlashCommandBuilder()
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
    let suggestionId = null;

    try {
      const text =
        interaction.options
          .getString(
            'text',
            true
          )
          .trim();

      if (!text.length) {
        return interaction.editReply({
          content:
            'Suggestion cannot be empty.'
        });
      }

      if (
        text.includes('@everyone') ||
        text.includes('@here')
      ) {
        return interaction.editReply({
          content:
            'Suggestions cannot contain mass mentions.'
        });
      }

      if (
        findRacistTerm(text) ||
        findCensoredTerm(text, listCensorTerms(interaction.guild.id))
      ) {
        return interaction.editReply({
          content: 'That suggestion contains blocked language.'
        });
      }

      if (detectPhishing(text, guildPhishingLists(interaction.guild.id))) {
        return interaction.editReply({
          content: 'That suggestion contains a suspicious link.'
        });
      }

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
            'Suggestion channel is not set.'
        });
      }

      const channel =
        interaction.guild.channels.cache.get(
          settings.suggestionChannelId
        );

      if (
        !channel ||
        ![
          ChannelType.GuildText,
          ChannelType.GuildAnnouncement
        ].includes(channel.type)
      ) {
        return interaction.editReply({
          content:
            'Suggestion channel is invalid.'
        });
      }

      const permissions =
        channel.permissionsFor(
          interaction.guild.members.me
        );

      if (
        !permissions?.has([
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.EmbedLinks,
          PermissionsBitField.Flags.AddReactions,
          PermissionsBitField.Flags.ReadMessageHistory
        ])
      ) {
        return interaction.editReply({
          content:
            'I am missing permissions in the suggestion channel.'
        });
      }

      const recent =
        get(
          `SELECT 1
           FROM suggestions
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
            'You already submitted this suggestion recently.'
        });
      }

      const result =
        run(
          `INSERT INTO suggestions
           (
             guildId,
             userId,
             content,
             status,
             timestamp
           )
           VALUES (?, ?, ?, ?, ?)`,
          [
            interaction.guild.id,
            interaction.user.id,
            text,
            'PENDING',
            Date.now()
          ]
        );

      suggestionId =
        result.lastInsertRowid;

      const embed =
        new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('New Suggestion')
          .setDescription(text)
          .addFields(
            {
              name: 'Author',
              value: `${interaction.user}`,
              inline: true
            },
            {
              name: 'Status',
              value: 'Pending',
              inline: true
            },
            {
              name: 'Votes',
              value: 'Yes: 0 | No: 0',
              inline: true
            },
            {
              name: 'Suggestion ID',
              value: `#${suggestionId}`,
              inline: true
            }
          )
          .setThumbnail(
            interaction.user.displayAvatarURL({
              size: 256
            })
          )
          .setFooter({
            text:
              `User ID: ${interaction.user.id}`
          })
          .setTimestamp();

      const row =
        new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId('suggest_accept')
              .setLabel('Accept')
              .setEmoji('✅')
              .setStyle(ButtonStyle.Success),

            new ButtonBuilder()
              .setCustomId('suggest_deny')
              .setLabel('Deny')
              .setEmoji('❌')
              .setStyle(ButtonStyle.Danger)
          );

      const message =
        await channel.send({
          embeds: [embed],
          components: [row]
        });

      run(
        `UPDATE suggestions
         SET messageId = ?
         WHERE id = ?`,
        [
          message.id,
          suggestionId
        ]
      );

      await message.react('✅').catch(err =>
        console.warn(`Suggestion ${suggestionId} upvote reaction failed:`, err.message)
      );
      await message.react('❌').catch(err =>
        console.warn(`Suggestion ${suggestionId} downvote reaction failed:`, err.message)
      );

      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x57F287)
            .setTitle('Suggestion Submitted')
            .setDescription(
              `Your suggestion has been posted in ${channel}.`
            )
            .addFields(
              {
                name: 'Suggestion ID',
                value: `#${suggestionId}`,
                inline: true
              },
              {
                name: 'Message',
                value:
                  `[Jump to Suggestion](${message.url})`,
                inline: true
              }
            )
            .setFooter({
              text:
                `${interaction.guild.name} Suggestions`
            })
            .setTimestamp()
        ]
      });

    } catch (err) {
      console.error(
        'Suggest Error:',
        err
      );

      if (suggestionId) {
        run(
          `DELETE FROM suggestions WHERE id = ? AND messageId IS NULL`,
          [suggestionId]
        );
      }

      return interaction.editReply({
        content:
          'Failed to submit suggestion.'
      });
    }
  }
};

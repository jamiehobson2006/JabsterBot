const {

  EmbedBuilder,

  ActionRowBuilder,

  ButtonBuilder,

  ButtonStyle,

  PermissionsBitField,

  SlashCommandBuilder,

  ChannelType

} = require('discord.js');

const {

  get,

  run

} = require('../../database');

module.exports = {

  cooldown: 5000,

  data:
    new SlashCommandBuilder()

      .setName('suggest')

      .setDescription(
        'Submit a suggestion'
      )

      .addStringOption(option =>

        option

          .setName('text')

          .setDescription(
            'Your suggestion'
          )

          .setRequired(true)

          .setMaxLength(500)
      ),

  async execute(interaction) {

    try {

      // ========================
      // 📥 INPUT
      // ========================
      const text =
        interaction.options

          .getString(
            'text',
            true
          )

          .trim();

      // ========================
      // 🚫 EMPTY CHECK
      // ========================
      if (!text.length) {

        return interaction.editReply({

          content:
            '❌ Suggestion cannot be empty.'
        });
      }

      // ========================
      // 🚫 MASS MENTION FILTER
      // ========================
      if (

        text.includes('@everyone') ||

        text.includes('@here')
      ) {

        return interaction.editReply({

          content:

            '❌ Suggestions cannot contain mass mentions.'
        });
      }

      // ========================
      // 🔄 GET SETTINGS
      // ========================
      const settings =
        get(

          `SELECT suggestionChannelId

           FROM guild_settings

           WHERE guildId = ?`,

          [

            interaction.guild.id
          ]
        );

      if (

        !settings?.suggestionChannelId
      ) {

        return interaction.editReply({

          content:
            '❌ Suggestion channel not set.'
        });
      }

      // ========================
      // 📺 FETCH CHANNEL
      // ========================
      const channel =
        interaction.guild.channels.cache.get(

          settings.suggestionChannelId
        );

      if (

        !channel ||

        !channel.isTextBased() ||

        channel.type ===
        ChannelType.GuildVoice
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

        !perms?.has([

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

          `SELECT *

           FROM suggestions

           WHERE guildId = ?
           AND userId = ?
           AND content = ?
           AND timestamp > ?`,

          [

            interaction.guild.id,

            interaction.user.id,

            text,

            Date.now() -
            (5 * 60 * 1000)
          ]
        );

      if (recent) {

        return interaction.editReply({

          content:

            '⚠️ You already submitted this suggestion recently.'
        });
      }

      // ========================
      // 📊 USER STATS
      // ========================
      const stats =
        get(

          `SELECT COUNT(*) as total

           FROM suggestions

           WHERE guildId = ?
           AND userId = ?`,

          [

            interaction.guild.id,

            interaction.user.id
          ]
        );
        
const suggestionNumber =
  msg.id;
      const embed =
        new EmbedBuilder()

          .setColor(
            0x5865F2
          )

          .setTitle(
            '💡 New Suggestion'
          )

          .setDescription(text)

          .addFields(

            {

              name: '👤 Author',

              value:
                `${interaction.user}`,

              inline: true
            },

            {

              name: '📊 Status',

              value:
                '⏳ Pending',

              inline: true
            },

            {

              name: '👍 Votes',

              value:
                '✅ 0 • ❌ 0',

              inline: true
            },

            {

              name: '🆔 Suggestion ID',

              value:
                `#${suggestionNumber}`,

              inline: true
            }
          )

          .setThumbnail(

            interaction.user.displayAvatarURL({

              dynamic: true
            })
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

              .setEmoji('✅')

              .setStyle(
                ButtonStyle.Success
              ),

            new ButtonBuilder()

              .setCustomId('suggest_deny')

              .setLabel('Deny')

              .setEmoji('❌')

              .setStyle(
                ButtonStyle.Danger
              )
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
      // 💾 SAVE DATABASE
      // ========================
      run(

        `INSERT INTO suggestions

         (
           guildId,
           messageId,
           userId,
           content,
           status,
           timestamp
         )

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

      await interaction.editReply({

        embeds: [

          new EmbedBuilder()

            .setColor(
              0x57F287
            )

            .setTitle(
              '✅ Suggestion Submitted'
            )

            .setDescription(

              `Your suggestion has been posted in ${channel}`
            )

            .addFields(

              {

                name: '🆔 Suggestion ID',

                value:
                  `#${suggestionNumber}`,

                inline: true
              },

              {

                name: '🔗 Message',

                value:
                  `[Jump to Suggestion](${msg.url})`,

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
const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits
} = require('discord.js');

const {
  all
} = require('../../database');

module.exports = {

  cooldown: 3000,

  data: new SlashCommandBuilder()

    .setName('sociallist')

    .setDescription(
      'View configured social feeds'
    ),

  async execute(interaction) {

    if (
      !interaction.memberPermissions.has(
        PermissionFlagsBits.ManageGuild
      )
    ) {

      return interaction.editReply({

        content:
          '❌ You need Manage Server permission.'
      });
    }

    const socials = all(

      `SELECT *
       FROM social_channels
       WHERE guildId = ?`,

      [interaction.guild.id]
    );

    if (!socials.length) {

      return interaction.editReply({

        content:
          '❌ No social feeds configured.'
      });
    }

    const embed =
      new EmbedBuilder()

        .setColor(0x5865F2)

        .setTitle(
          '📱 Social Feeds'
        )

        .setDescription(

          socials.map(feed =>

            `**${feed.creatorName}**\n` +

            `Platform: ${feed.platform}\n` +

            `Type: ${feed.contentType}\n` +

            `Channel: <#${feed.targetChannelId}>\n` +

            `Role: ${
              feed.pingRoleId
                ? `<@&${feed.pingRoleId}>`
                : 'None'
            }\n` +
            `Style: ${feed.messageTemplate ? 'Custom template' : 'Default'}\n` +
            `Quiet Hours: ${feed.quietStartHour !== null && feed.quietEndHour !== null && Number.isInteger(Number(feed.quietStartHour)) && Number.isInteger(Number(feed.quietEndHour))
              ? `${String(feed.quietStartHour).padStart(2, '0')}:00-${String(feed.quietEndHour).padStart(2, '0')}:00 (${feed.timezone || 'Europe/London'})`
              : 'Disabled'}`

          ).join('\n\n')
        )

        .setTimestamp();

    await interaction.editReply({

      embeds: [embed]
    });
  }
};

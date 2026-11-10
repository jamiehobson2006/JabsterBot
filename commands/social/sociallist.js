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
    )
    .addIntegerOption(option=>option.setName('page').setDescription('Feed page').setMinValue(1)),

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

          socials.slice(((interaction.options.getInteger('page') || 1)-1)*5,(interaction.options.getInteger('page') || 1)*5).map(feed =>

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
              : 'Disabled'}` + '\n' + (()=>{
                const health=require('../../utils/gameProviders').providerHealth(`SOCIAL:${feed.platform==='twitch'?'twitch:':'youtube-uploads:'}${feed.creatorId}${feed.platform==='youtube'?':10':''}`);
                return `API: ${health?.error?String(health.error).slice(0,180):health?.successAt?`Last success <t:${Math.floor(health.successAt/1000)}:R>`:'Not checked yet'}`;
              })()

          ).join('\n\n')
        )

        .setTimestamp();

    await interaction.editReply({

      embeds: [embed]
    });
  }
};

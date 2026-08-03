const {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder
} = require('discord.js');

const {
  run
} = require('../../database');

const {
  getFeedback,
  listFeedback
} = require('../../utils/ticketFeedback');

function feedbackLine(record) {
  const rating =
    record.rating
      ? `${record.rating}/5`
      : 'Pending';

  return `\`${record.id}\` - <@${record.userId}> - ${record.ticketType} - ${rating}`;
}

module.exports = {
  cooldown: 3000,
  ephemeral: true,

  data: new SlashCommandBuilder()
    .setName('ticketfeedback')
    .setDescription('Configure and review ticket feedback')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(subcommand =>
      subcommand
        .setName('setchannel')
        .setDescription('Set the channel that receives ticket feedback')
        .addChannelOption(option =>
          option
            .setName('channel')
            .setDescription('Feedback channel')
            .addChannelTypes(
              ChannelType.GuildText,
              ChannelType.GuildAnnouncement
            )
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('clear')
        .setDescription('Stop sending ticket feedback to a channel')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('View recently stored ticket feedback')
        .addIntegerOption(option =>
          option
            .setName('limit')
            .setDescription('Number of records to show')
            .setMinValue(1)
            .setMaxValue(20)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('view')
        .setDescription('View one feedback record')
        .addStringOption(option =>
          option
            .setName('id')
            .setDescription('Feedback ID from /ticketfeedback list')
            .setRequired(true)
        )
    ),

  async execute(interaction) {
    if (
      !interaction.memberPermissions.has(
        PermissionFlagsBits.Administrator
      )
    ) {
      return interaction.editReply({
        content: 'You need Administrator permission.'
      });
    }

    const subcommand =
      interaction.options.getSubcommand();

    if (subcommand === 'setchannel') {
      const channel =
        interaction.options.getChannel('channel', true);

      const permissions =
        channel.permissionsFor(interaction.guild.members.me);

      if (
        !permissions?.has([
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.EmbedLinks
        ])
      ) {
        return interaction.editReply({
          content: 'I need View Channel, Send Messages, and Embed Links there.'
        });
      }

      run(
        `INSERT INTO guild_settings (
           guildId,
           ticketFeedbackChannelId
         )
         VALUES (?, ?)
         ON CONFLICT(guildId)
         DO UPDATE SET ticketFeedbackChannelId = excluded.ticketFeedbackChannelId`,
        [
          interaction.guild.id,
          channel.id
        ]
      );

      return interaction.editReply({
        content: `Ticket feedback will be sent to ${channel}.`
      });
    }

    if (subcommand === 'clear') {
      run(
        `INSERT INTO guild_settings (
           guildId,
           ticketFeedbackChannelId
         )
         VALUES (?, NULL)
         ON CONFLICT(guildId)
         DO UPDATE SET ticketFeedbackChannelId = NULL`,
        [interaction.guild.id]
      );

      return interaction.editReply({
        content: 'Ticket feedback will remain stored but will not be posted to a channel.'
      });
    }

    if (subcommand === 'list') {
      const records =
        listFeedback(
          interaction.guild.id,
          interaction.options.getInteger('limit') || 10
        );

      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('Ticket Feedback')
            .setDescription(
              records.length
                ? records.map(feedbackLine).join('\n')
                : 'No ticket feedback has been recorded yet.'
            )
            .setTimestamp()
        ]
      });
    }

    const record =
      getFeedback(
        interaction.options.getString('id', true)
      );

    if (!record || record.guildId !== interaction.guild.id) {
      return interaction.editReply({
        content: 'Feedback record not found.'
      });
    }

    return interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(record.rating >= 4 ? 0x57F287 : record.rating <= 2 ? 0xED4245 : 0xFEE75C)
          .setTitle('Ticket Feedback Record')
          .addFields(
            {
              name: 'User',
              value: `<@${record.userId}>`,
              inline: true
            },
            {
              name: 'Rating',
              value: record.rating ? `${record.rating}/5` : 'Pending',
              inline: true
            },
            {
              name: 'Ticket Type',
              value: record.ticketType,
              inline: true
            },
            {
              name: 'Close Reason',
              value: record.closeReason
            },
            {
              name: 'Feedback',
              value: record.feedback || 'No written feedback provided.'
            }
          )
          .setFooter({
            text: `Feedback ID: ${record.id}`
          })
          .setTimestamp(record.completedAt || record.createdAt)
      ]
    });
  }
};

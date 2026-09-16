const {
  ChannelType,
  EmbedBuilder,
  PermissionsBitField,
  SlashCommandBuilder
} = require('discord.js');

const {
  run
} = require('../../database');

const TRANSCRIPT_TYPES = {
  TICKETS: {
    column: 'transcriptChannelId',
    label: 'Ticket'
  },
  APPLICATIONS: {
    column: 'applicationTranscriptChannelId',
    label: 'Application'
  }
};

module.exports = {
  cooldown: 5000,
  ephemeral: true,

  data: new SlashCommandBuilder()
    .setName('settranscriptchannel')
    .setDescription('Set where ticket or application transcripts are saved')
    .addChannelOption(option => option
      .setName('channel')
      .setDescription('Staff-only channel for transcript archives')
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(true))
    .addStringOption(option => option
      .setName('type')
      .setDescription('Transcript type to send to this channel')
      .addChoices(
        { name: 'Tickets', value: 'TICKETS' },
        { name: 'Applications', value: 'APPLICATIONS' }
      )),

  async execute(interaction) {
    if (!interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.editReply({ content: 'Administrator permission is required.' });
    }

    const channel = interaction.options.getChannel('channel', true);
    const selectedType = interaction.options.getString('type') || 'TICKETS';
    const transcriptType = TRANSCRIPT_TYPES[selectedType];
    const permissions = channel.permissionsFor(interaction.guild.members.me);

    if (!permissions?.has([
      PermissionsBitField.Flags.ViewChannel,
      PermissionsBitField.Flags.SendMessages,
      PermissionsBitField.Flags.AttachFiles,
      PermissionsBitField.Flags.EmbedLinks,
      PermissionsBitField.Flags.ReadMessageHistory
    ])) {
      return interaction.editReply({
        content: 'I need View Channel, Send Messages, Attach Files, Embed Links, and Read Message History in that channel.'
      });
    }

    run(
      `INSERT INTO guild_settings (guildId, ${transcriptType.column})
       VALUES (?, ?)
       ON CONFLICT(guildId)
       DO UPDATE SET ${transcriptType.column} = excluded.${transcriptType.column}`,
      [interaction.guild.id, channel.id]
    );

    const embed = new EmbedBuilder()
      .setColor(0x57F287)
      .setTitle(`${transcriptType.label} Transcript Channel Configured`)
      .setDescription(`${transcriptType.label} transcripts will be saved in ${channel}.`)
      .addFields(
        { name: 'Archive', value: 'HTML transcript with ticket details, staff activity, timestamps, and close reason.' },
        { name: 'Configured By', value: `${interaction.user}`, inline: true },
        { name: 'Channel', value: `${channel}`, inline: true }
      )
      .setFooter({ text: 'Keep transcript channels visible to staff only.' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    await channel.send({
      embeds: [new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`${transcriptType.label} Transcript Logging Enabled`)
        .setDescription('This channel will receive protected HTML transcript archives.')
        .setFooter({ text: `Configured by ${interaction.user.tag}` })
        .setTimestamp()]
    }).catch(error => {
      console.warn('Transcript setup message error:', error.message);
    });
  }
};

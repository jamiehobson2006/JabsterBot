const {
  PermissionFlagsBits,
  SlashCommandBuilder
} = require('discord.js');

const {
  buildPollComponents,
  buildPollEmbed,
  createPoll,
  getVoteCounts
} = require('../../utils/polls');

function parseDuration(input) {
  if (!input) {
    return null;
  }

  const match =
    input.trim().match(/^(\d+)(s|m|h|d)$/i);

  if (!match) {
    return null;
  }

  const value =
    Number(match[1]);

  const unit =
    match[2].toLowerCase();

  const multipliers = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000
  };

  const milliseconds =
    value * multipliers[unit];

  return Number.isSafeInteger(milliseconds) && milliseconds > 0
    ? milliseconds
    : null;
}

function cleanOption(value) {
  return String(value || '')
    .replace(/@everyone|@here/g, '[mention removed]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
}

module.exports = {
  cooldown: 5000,

  data: new SlashCommandBuilder()
    .setName('poll')
    .setDescription('Create a custom poll with 2 to 5 options')
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageMessages
    )
    .addStringOption(option =>
      option
        .setName('question')
        .setDescription('Poll question')
        .setRequired(true)
        .setMaxLength(300)
    )
    .addStringOption(option =>
      option
        .setName('option1')
        .setDescription('First option')
        .setRequired(true)
        .setMaxLength(100)
    )
    .addStringOption(option =>
      option
        .setName('option2')
        .setDescription('Second option')
        .setRequired(true)
        .setMaxLength(100)
    )
    .addStringOption(option =>
      option
        .setName('option3')
        .setDescription('Third option')
        .setMaxLength(100)
    )
    .addStringOption(option =>
      option
        .setName('option4')
        .setDescription('Fourth option')
        .setMaxLength(100)
    )
    .addStringOption(option =>
      option
        .setName('option5')
        .setDescription('Fifth option')
        .setMaxLength(100)
    )
    .addStringOption(option =>
      option
        .setName('duration')
        .setDescription('Optional duration, for example 30s, 5m, 1h, or 1d')
        .setMaxLength(10)
    )
    .addRoleOption(option =>
      option
        .setName('ping_role')
        .setDescription('Role to notify about the poll (administrators only)')
    ),

  async execute(interaction) {
    if (
      !interaction.memberPermissions.has(
        PermissionFlagsBits.ManageMessages
      )
    ) {
      return interaction.editReply({
        content: 'You need Manage Messages permission to create a poll.'
      });
    }

    const durationInput =
      interaction.options.getString('duration');

    const duration =
      parseDuration(durationInput);

    if (durationInput && !duration) {
      return interaction.editReply({
        content: 'Use a duration like `30s`, `5m`, `1h`, or `1d`.'
      });
    }

    const options =
      [
        interaction.options.getString('option1', true),
        interaction.options.getString('option2', true),
        interaction.options.getString('option3'),
        interaction.options.getString('option4'),
        interaction.options.getString('option5')
      ]
        .filter(Boolean)
        .map(cleanOption);

    if (options.some(option => !option)) {
      return interaction.editReply({
        content: 'Poll options cannot be empty.'
      });
    }

    const uniqueOptions =
      new Set(options.map(option => option.toLowerCase()));

    if (uniqueOptions.size !== options.length) {
      return interaction.editReply({
        content: 'Poll options must be unique.'
      });
    }

    const role =
      interaction.options.getRole('ping_role');

    if (
      role &&
      !interaction.memberPermissions.has(
        PermissionFlagsBits.Administrator
      )
    ) {
      return interaction.editReply({
        content: 'Only administrators can ping a role for a poll.'
      });
    }

    if (
      role &&
      (role.managed || role.id === interaction.guild.roles.everyone.id)
    ) {
      return interaction.editReply({
        content: 'Choose a normal server role to notify.'
      });
    }

    const botPermissions =
      interaction.channel.permissionsFor(interaction.guild.members.me);

    if (
      !botPermissions?.has([
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.ReadMessageHistory
      ])
    ) {
      return interaction.editReply({
        content: 'I am missing permissions to create a poll in this channel.'
      });
    }

    if (
      role &&
      !botPermissions.has(PermissionFlagsBits.MentionEveryone)
    ) {
      return interaction.editReply({
        content: 'I need Mention Everyone permission to notify that role.'
      });
    }

    const endsAt =
      duration
        ? Date.now() + duration
        : null;

    const initialPoll = {
      guildId: interaction.guild.id,
      channelId: interaction.channel.id,
      creatorId: interaction.user.id,
      creatorTag: interaction.user.tag,
      question: interaction.options.getString('question', true),
      endsAt,
      createdAt: Date.now(),
      active: 1
    };

    const message =
      await interaction.channel.send({
        content: role ? `<@&${role.id}>` : undefined,
        allowedMentions: role
          ? { roles: [role.id] }
          : { parse: [] },
        embeds: [
          buildPollEmbed(
            initialPoll,
            options,
            new Array(options.length).fill(0)
          )
        ]
      });

    createPoll({
      ...initialPoll,
      messageId: message.id
    });

    await message.edit({
      components: buildPollComponents(message.id, options)
    });

    const counts =
      getVoteCounts(message.id, options.length);

    await message.edit({
      embeds: [
        buildPollEmbed(
          {
            ...initialPoll,
            messageId: message.id
          },
          options,
          counts
        )
      ]
    });

    return interaction.editReply({
      content:
        duration
          ? `Poll created. It ends <t:${Math.floor(endsAt / 1000)}:R>.`
          : 'Poll created. It has no automatic end time.'
    });
  }
};

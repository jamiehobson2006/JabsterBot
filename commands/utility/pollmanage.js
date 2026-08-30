const {
  AttachmentBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder
} = require('discord.js');

const {
  all,
  get,
  run
} = require('../../database');

const {
  endPoll,
  getPoll,
  parseOptions,
  refreshPollMessage
} = require('../../utils/polls');

function canManage(interaction, poll) {
  return interaction.memberPermissions.has(PermissionFlagsBits.ManageMessages) ||
    poll.creatorId === interaction.user.id;
}

module.exports = {
  cooldown: 2500,
  ephemeral: true,

  data: new SlashCommandBuilder()
    .setName('pollmanage')
    .setDescription('Edit, close, or export a poll you manage')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addSubcommand(subcommand => subcommand
      .setName('close')
      .setDescription('End a poll immediately')
      .addStringOption(option => option
        .setName('message_id')
        .setDescription('Poll message ID')
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('question')
      .setDescription('Edit an active poll question without clearing votes')
      .addStringOption(option => option
        .setName('message_id')
        .setDescription('Poll message ID')
        .setRequired(true))
      .addStringOption(option => option
        .setName('text')
        .setDescription('Replacement question')
        .setMaxLength(300)
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('export')
      .setDescription('Export current poll votes as CSV')
      .addStringOption(option => option
        .setName('message_id')
        .setDescription('Poll message ID')
        .setRequired(true))),

  async execute(interaction) {
    const messageId = interaction.options.getString('message_id', true);
    const poll = getPoll(messageId);
    if (!poll || poll.guildId !== interaction.guild.id) {
      return interaction.editReply({ content: 'That poll was not found in this server.' });
    }

    if (!canManage(interaction, poll)) {
      return interaction.editReply({ content: 'You need Manage Messages or must be the poll creator.' });
    }

    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'close') {
      const ended = await endPoll(interaction.client, messageId);
      return interaction.editReply({ content: ended ? 'Poll closed.' : 'That poll was already closed.' });
    }

    if (subcommand === 'question') {
      if (!poll.active) {
        return interaction.editReply({ content: 'Closed polls cannot be edited.' });
      }

      const question = interaction.options.getString('text', true)
        .replace(/@everyone|@here/g, '[mention removed]')
        .replace(/\s+/g, ' ')
        .trim();
      run('UPDATE polls SET question = ? WHERE messageId = ?', [question, messageId]);
      await refreshPollMessage(interaction.client, messageId);
      return interaction.editReply({ content: 'Poll question updated; votes were kept.' });
    }

    const options = parseOptions(poll.options);
    const votes = all(
      `SELECT userId, optionIndex
       FROM poll_votes
       WHERE messageId = ?
       ORDER BY optionIndex ASC, userId ASC`,
      [messageId]
    );
    const rows = [
      ['user_id', 'option_number', 'option'].join(','),
      ...votes.map(vote => [
        vote.userId,
        Number(vote.optionIndex) + 1,
        `"${String(options[Number(vote.optionIndex)] || 'Unknown').replace(/"/g, '""')}"`
      ].join(','))
    ];
    const file = new AttachmentBuilder(Buffer.from(rows.join('\n'), 'utf8'), {
      name: `poll-${messageId}-votes.csv`
    });

    return interaction.editReply({
      content: `Exported ${votes.length} vote(s).`,
      files: [file]
    });
  }
};

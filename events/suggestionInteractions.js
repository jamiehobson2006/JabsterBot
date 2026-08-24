const {
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionsBitField,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder
} = require('discord.js');

const {
  get,
  run
} = require('../database');

const {
  memberCanManageSuggestions
} = require('../utils/suggestions/managers');

const {
  createAuditEmbed,
  logAudit
} = require('../utils/logger');

function canReviewSuggestions(interaction) {

  return interaction.memberPermissions?.has(
    PermissionsBitField.Flags.Administrator
  ) || memberCanManageSuggestions(
    interaction.member,
    interaction.guild.id
  );
}

function isSuggestionButton(
  interaction
) {
  return (
    interaction.isButton() &&
    [
      'suggest_accept',
      'suggest_deny'
    ].includes(interaction.customId)
  );
}

function getActionFromButton(
  customId
) {
  return customId === 'suggest_accept'
    ? 'accept'
    : 'deny';
}

function getStatusFromAction(
  action
) {
  return action === 'accept'
    ? 'ACCEPTED'
    : 'DENIED';
}

function cleanReason(
  reason
) {
  const cleaned =
    String(reason || '')
      .replace(/@everyone|@here/g, '[mention removed]')
      .replace(/\s+/g, ' ')
      .trim();

  return cleaned ||
    'No reason provided.';
}

async function fetchTextChannel(
  client,
  channelId
) {
  if (!channelId) {
    return null;
  }

  const channel =
    await client.channels
      .fetch(channelId)
      .catch(() => null);

  if (
    !channel ||
    !channel.isTextBased()
  ) {
    return null;
  }

  return channel;
}

async function fetchSuggestionMessage({
  interaction,
  settings,
  messageId
}) {
  if (
    interaction.message?.id === messageId
  ) {
    return interaction.message;
  }

  const channel =
    await fetchTextChannel(
      interaction.client,
      settings?.suggestionChannelId
    );

  if (!channel) {
    return null;
  }

  return channel.messages
    .fetch(messageId)
    .catch(() => null);
}

async function countVotes(
  message
) {
  if (!message) {
    return {
      upvotes: 0,
      downvotes: 0
    };
  }

  const fresh =
    await message.fetch()
      .catch(() => message);

  const upvoteReaction =
    fresh.reactions.cache.get('✅');

  const downvoteReaction =
    fresh.reactions.cache.get('❌');

  return {
    upvotes:
      Math.max(
        (upvoteReaction?.count || 1) - 1,
        0
      ),
    downvotes:
      Math.max(
        (downvoteReaction?.count || 1) - 1,
        0
      )
  };
}

function buildDecisionEmbed({
  message,
  suggestion,
  status,
  moderator,
  reason,
  upvotes,
  downvotes
}) {
  const accepted =
    status === 'ACCEPTED';

  const base =
    message?.embeds?.[0]
      ? EmbedBuilder.from(message.embeds[0])
      : new EmbedBuilder()
          .setTitle('Suggestion')
          .setDescription(suggestion.content);

  const keptFields =
    (base.data.fields || [])
      .filter(field => {
        const name =
          String(field.name || '').toLowerCase();

        return (
          !name.includes('status') &&
          !name.includes('votes') &&
          !name.includes('reviewed') &&
          !name.includes('reason')
        );
      });

  base
    .setColor(
      accepted
        ? 0x57F287
        : 0xED4245
    )
    .setTitle(
      accepted
        ? 'Suggestion Accepted'
        : 'Suggestion Denied'
    )
    .setDescription(
      suggestion.content
    )
    .setFields(keptFields)
    .addFields(
      {
        name: 'Status',
        value:
          accepted
            ? 'Accepted'
            : 'Denied',
        inline: true
      },
      {
        name: 'Reviewed By',
        value: `${moderator}`,
        inline: true
      },
      {
        name: 'Votes',
        value:
          `Yes: ${upvotes} | No: ${downvotes}`,
        inline: true
      },
      {
        name: 'Decision Reason',
        value: reason
      }
    )
    .setFooter({
      text:
        `${status} by ${moderator.tag}`
    })
    .setTimestamp();

  return base;
}

async function handleDecisionButton(
  interaction
) {
  if (!canReviewSuggestions(interaction)) {
    return interaction.reply({
      content:
        'You need Administrator permission or a suggestion manager role.',
      flags: MessageFlags.Ephemeral
    });
  }

  const suggestion =
    get(
      `SELECT *
       FROM suggestions
       WHERE messageId = ?`,
      [interaction.message.id]
    );

  if (!suggestion) {
    return interaction.reply({
      content:
        'Suggestion not found.',
      flags: MessageFlags.Ephemeral
    });
  }

  if (suggestion.status !== 'PENDING') {
    return interaction.reply({
      content:
        `Already ${suggestion.status}.`,
      flags: MessageFlags.Ephemeral
    });
  }

  const action =
    getActionFromButton(
      interaction.customId
    );

  const modal =
    new ModalBuilder()
      .setCustomId(
        `suggest_decision_${action}_${interaction.message.id}`
      )
      .setTitle(
        action === 'accept'
          ? 'Accept Suggestion'
          : 'Deny Suggestion'
      );

  const reasonInput =
    new TextInputBuilder()
      .setCustomId('reason')
      .setLabel('Reason')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Optional reason shown on the suggestion embed')
      .setRequired(false)
      .setMaxLength(500);

  modal.addComponents(
    new ActionRowBuilder()
      .addComponents(reasonInput)
  );

  return interaction.showModal(modal);
}

async function handleDecisionModal(
  interaction
) {
  const parts =
    interaction.customId.split('_');

  const action =
    parts[2];

  const messageId =
    parts.slice(3).join('_');

  const status =
    getStatusFromAction(action);

  await interaction.deferReply({
    flags: MessageFlags.Ephemeral
  });

  if (!canReviewSuggestions(interaction)) {

    return interaction.editReply({
      content:
        'You need Administrator permission or a suggestion manager role.'
    });
  }

  const reason =
    cleanReason(
      interaction.fields.getTextInputValue('reason')
    );

  const suggestion =
    get(
      `SELECT *
       FROM suggestions
       WHERE messageId = ?`,
      [messageId]
    );

  if (!suggestion) {
    return interaction.editReply({
      content:
        'Suggestion not found.'
    });
  }

  if (suggestion.status !== 'PENDING') {
    return interaction.editReply({
      content:
        `Already ${suggestion.status}.`
    });
  }

  const settings =
    get(
      `SELECT suggestionChannelId,
              acceptedSuggestionChannelId,
              deniedSuggestionChannelId
       FROM guild_settings
       WHERE guildId = ?`,
      [interaction.guild.id]
    );

  const suggestionMessage =
    await fetchSuggestionMessage({
      interaction,
      settings,
      messageId
    });

  const votes =
    await countVotes(
      suggestionMessage
    );

  run(
    `UPDATE suggestions
     SET status = ?,
         moderatorId = ?,
         reason = ?,
         decisionAt = ?
     WHERE messageId = ?`,
    [
      status,
      interaction.user.id,
      reason,
      Date.now(),
      messageId
    ]
  );

  const decisionEmbed =
    buildDecisionEmbed({
      message: suggestionMessage,
      suggestion,
      status,
      moderator: interaction.user,
      reason,
      upvotes: votes.upvotes,
      downvotes: votes.downvotes
    });

  if (suggestionMessage) {
    await suggestionMessage.edit({
      embeds: [decisionEmbed],
      components: []
    }).catch(() => null);
  }

  const destinationId =
    status === 'ACCEPTED'
      ? settings?.acceptedSuggestionChannelId
      : settings?.deniedSuggestionChannelId;

  const destination =
    await fetchTextChannel(
      interaction.client,
      destinationId
    );

  if (
    destination &&
    destination.id !== suggestionMessage?.channelId
  ) {
    const copiedEmbed =
      EmbedBuilder.from(decisionEmbed);

    if (suggestionMessage?.url) {
      copiedEmbed.addFields({
        name: 'Original',
        value:
          `[Jump to suggestion](${suggestionMessage.url})`
      });
    }

    await destination.send({
      embeds: [copiedEmbed]
    }).catch(() => null);
  }

  await logAudit(
    interaction.client,
    interaction.guild.id,
    {
      action: `SUGGESTION_${status}`,
      targetId: suggestion.userId,
      executorId: interaction.user.id,
      type: 'SUGGESTIONS',
      metadata: {
        suggestionId: suggestion.id,
        messageId,
        status,
        reason
      },
      embed: createAuditEmbed({
        action: status === 'ACCEPTED'
          ? 'Suggestion Accepted'
          : 'Suggestion Denied',
        target: `<@${suggestion.userId}>`,
        executor: `${interaction.user.tag}\n<@${interaction.user.id}>`,
        reason,
        messageLink: suggestionMessage?.url
          ? `[Jump to suggestion](${suggestionMessage.url})`
          : undefined,
        extra: `Suggestion #${suggestion.id}`,
        color: status === 'ACCEPTED'
          ? 0x57F287
          : 0xED4245
      })
    }
  ).catch(err => console.error('Suggestion decision log error:', err));

  return interaction.editReply({
    content:
      `Suggestion #${suggestion.id} marked as ${status.toLowerCase()}.`
  });
}

module.exports = {
  name: 'interactionCreate',

  async execute(interaction) {
    try {
      if (isSuggestionButton(interaction)) {
        return handleDecisionButton(interaction);
      }

      if (
        interaction.isModalSubmit() &&
        interaction.customId.startsWith('suggest_decision_')
      ) {
        return handleDecisionModal(interaction);
      }

      return null;

    } catch (err) {
      console.error(
        'Suggestion Interaction Error:',
        err
      );

      if (
        interaction.deferred ||
        interaction.replied
      ) {
        return interaction.followUp({
          content:
            'Failed to review suggestion.',
          flags: MessageFlags.Ephemeral
        }).catch(() => null);
      }

      return interaction.reply({
        content:
          'Failed to review suggestion.',
        flags: MessageFlags.Ephemeral
      }).catch(() => null);
    }
  }
};

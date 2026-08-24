const {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionsBitField,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');

const {
  buildChangelogEmbed,
  buildReviewComponents,
  getChangelogEntry,
  getChangelogSettings,
  markChangelogReviewed
} = require('../utils/changelog');

function getEntryId(customId, prefix) {
  const raw = String(customId || '').slice(prefix.length);
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function canReview(interaction) {
  if (interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
    return true;
  }

  const settings = getChangelogSettings(interaction.guild.id);
  return Boolean(settings?.reviewerRoleId && interaction.member?.roles?.cache?.has(settings.reviewerRoleId));
}

function denyModal(id) {
  return new ModalBuilder()
    .setCustomId(`changelog_deny_reason_${id}`)
    .setTitle('Deny Changelog')
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('reason')
        .setLabel('Reason for denial')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1000)
    ));
}

async function finishReview(interaction, id, status, reason) {
  const entry = getChangelogEntry(interaction.guild.id, id);
  if (!entry || entry.status !== 'PENDING') {
    return interaction.reply({ content: 'This changelog is no longer awaiting review.', flags: MessageFlags.Ephemeral });
  }

  const result = markChangelogReviewed({
    id,
    status,
    reviewerId: interaction.user.id,
    reason
  });

  if (!result.changes) {
    return interaction.reply({ content: 'This changelog was reviewed by someone else.', flags: MessageFlags.Ephemeral });
  }

  const reviewed = getChangelogEntry(interaction.guild.id, id);
  const content = status === 'APPROVED'
    ? `Changelog #${id} approved by <@${interaction.user.id}>.`
    : `Changelog #${id} denied by <@${interaction.user.id}>.`;

  if (interaction.message) {
    await interaction.update({
      content,
      embeds: [buildChangelogEmbed(reviewed, { review: true })],
      components: buildReviewComponents(id, true),
      allowedMentions: { parse: [] }
    });
    return;
  }

  await interaction.reply({ content: 'Changelog review saved.', flags: MessageFlags.Ephemeral });
}

module.exports = {
  name: 'interactionCreate',

  async execute(interaction) {
    if (!interaction.inGuild?.()) return;

    try {
      if (interaction.isButton() && interaction.customId.startsWith('changelog_approve_')) {
        if (!canReview(interaction)) {
          return interaction.reply({ content: 'You are not allowed to review changelogs.', flags: MessageFlags.Ephemeral });
        }

        const id = getEntryId(interaction.customId, 'changelog_approve_');
        if (!id) return;
        return finishReview(interaction, id, 'APPROVED', 'Approved');
      }

      if (interaction.isButton() && interaction.customId.startsWith('changelog_deny_')) {
        if (!canReview(interaction)) {
          return interaction.reply({ content: 'You are not allowed to review changelogs.', flags: MessageFlags.Ephemeral });
        }

        const id = getEntryId(interaction.customId, 'changelog_deny_');
        if (!id) return;
        return interaction.showModal(denyModal(id));
      }

      if (interaction.isModalSubmit() && interaction.customId.startsWith('changelog_deny_reason_')) {
        if (!canReview(interaction)) {
          return interaction.reply({ content: 'You are not allowed to review changelogs.', flags: MessageFlags.Ephemeral });
        }

        const id = getEntryId(interaction.customId, 'changelog_deny_reason_');
        if (!id) return;
        const reason = interaction.fields.getTextInputValue('reason').trim();
        const entry = getChangelogEntry(interaction.guild.id, id);
        if (!entry || entry.status !== 'PENDING') {
          return interaction.reply({ content: 'This changelog is no longer awaiting review.', flags: MessageFlags.Ephemeral });
        }

        const result = markChangelogReviewed({
          id,
          status: 'DENIED',
          reviewerId: interaction.user.id,
          reason
        });

        if (!result.changes) {
          return interaction.reply({ content: 'This changelog was reviewed by someone else.', flags: MessageFlags.Ephemeral });
        }

        const reviewed = getChangelogEntry(interaction.guild.id, id);
        const settings = getChangelogSettings(interaction.guild.id);
        const reviewChannel = settings?.reviewChannelId
          ? await interaction.guild.channels.fetch(settings.reviewChannelId).catch(() => null)
          : null;
        const reviewMessage = reviewChannel?.isTextBased() && reviewed.reviewMessageId
          ? await reviewChannel.messages.fetch(reviewed.reviewMessageId).catch(() => null)
          : null;

        if (reviewMessage) {
          await reviewMessage.edit({
            content: `Changelog #${id} denied by <@${interaction.user.id}>.`,
            embeds: [buildChangelogEmbed(reviewed, { review: true })],
            components: buildReviewComponents(id, true),
            allowedMentions: { parse: [] }
          });
        }

        return interaction.reply({ content: 'Changelog denied with your review note.', flags: MessageFlags.Ephemeral });
      }
    } catch (err) {
      console.error('Changelog interaction error:', err);
      if (!interaction.deferred && !interaction.replied) {
        await interaction.reply({ content: 'Could not update that changelog review.', flags: MessageFlags.Ephemeral }).catch(() => null);
      }
    }
  }
};

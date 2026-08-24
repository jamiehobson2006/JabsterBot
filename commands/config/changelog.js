const {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder
} = require('discord.js');

const {
  VERSION_ONE_CONTENT,
  buildChangelogEmbed,
  buildReviewComponents,
  createChangelogEntry,
  getChangelogEntry,
  getChangelogSettings,
  listChangelogEntries,
  markChangelogPublished,
  markChangelogSubmitted,
  setChangelogSettings
} = require('../../utils/changelog');

function adminOnly(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
}

async function getSendableChannel(interaction, id) {
  const channel = await interaction.guild.channels.fetch(id).catch(() => null);
  return channel?.isTextBased() ? channel : null;
}

module.exports = {
  cooldown: 2000,
  ephemeral: true,

  data: new SlashCommandBuilder()
    .setName('changelog')
    .setDescription('Create, review, and publish Jabster Studios changelogs')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(subcommand => subcommand
      .setName('setup')
      .setDescription('Set changelog review and publishing channels')
      .addChannelOption(option => option
        .setName('publish_channel')
        .setDescription('Approved changelogs are posted here')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true))
      .addChannelOption(option => option
        .setName('review_channel')
        .setDescription('Drafts are sent here for approval')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true))
      .addRoleOption(option => option
        .setName('reviewer_role')
        .setDescription('Optional role allowed to approve drafts')))
    .addSubcommand(subcommand => subcommand
      .setName('create')
      .setDescription('Create a changelog draft')
      .addStringOption(option => option.setName('version').setDescription('For example Version 1.1').setMaxLength(64).setRequired(true))
      .addStringOption(option => option.setName('title').setDescription('Update title').setMaxLength(256).setRequired(true))
      .addStringOption(option => option.setName('content').setDescription('Change notes').setMaxLength(4000).setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('seed-v1')
      .setDescription('Create the complete Version 1.0 changelog draft'))
    .addSubcommand(subcommand => subcommand
      .setName('submit')
      .setDescription('Send a draft for review')
      .addIntegerOption(option => option.setName('id').setDescription('Changelog ID').setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('publish')
      .setDescription('Publish an approved changelog')
      .addIntegerOption(option => option.setName('id').setDescription('Changelog ID').setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('view')
      .setDescription('View a changelog entry')
      .addIntegerOption(option => option.setName('id').setDescription('Changelog ID').setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('list')
      .setDescription('List recent changelog entries')
      .addStringOption(option => option
        .setName('status')
        .setDescription('Optional status filter')
        .addChoices(...['ALL', 'DRAFT', 'PENDING', 'APPROVED', 'DENIED', 'PUBLISHED'].map(value => ({ name: value, value }))))),

  async execute(interaction) {
    if (!adminOnly(interaction)) {
      return interaction.editReply({ content: 'Administrator permission is required.' });
    }

    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (subcommand === 'setup') {
      const publishChannel = interaction.options.getChannel('publish_channel', true);
      const reviewChannel = interaction.options.getChannel('review_channel', true);
      const reviewerRole = interaction.options.getRole('reviewer_role');

      for (const channel of [publishChannel, reviewChannel]) {
        const permissions = channel.permissionsFor(interaction.guild.members.me);
        if (!permissions?.has([
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.EmbedLinks
        ])) {
          return interaction.editReply({ content: `I need View Channel, Send Messages, and Embed Links in ${channel}.` });
        }
      }

      setChangelogSettings({
        guildId,
        publishChannelId: publishChannel.id,
        reviewChannelId: reviewChannel.id,
        reviewerRoleId: reviewerRole?.id || null,
        updatedBy: interaction.user.id
      });

      return interaction.editReply({ content: `Changelogs will be reviewed in ${reviewChannel} and published in ${publishChannel}.` });
    }

    if (subcommand === 'list') {
      const entries = listChangelogEntries(guildId, interaction.options.getString('status') || 'ALL');
      const description = entries.length
        ? entries.map(entry => `**#${entry.id} ${entry.version}** - ${entry.title}\n${entry.status} · <t:${Math.floor(entry.createdAt / 1000)}:d>`).join('\n\n')
        : 'No changelog entries have been created.';

      return interaction.editReply({
        embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('Changelog Entries').setDescription(description).setTimestamp()]
      });
    }

    if (subcommand === 'create' || subcommand === 'seed-v1') {
      const id = createChangelogEntry({
        guildId,
        version: subcommand === 'seed-v1' ? 'Version 1.0' : interaction.options.getString('version', true),
        title: subcommand === 'seed-v1' ? 'Everything Added So Far' : interaction.options.getString('title', true),
        content: subcommand === 'seed-v1' ? VERSION_ONE_CONTENT : interaction.options.getString('content', true),
        createdBy: interaction.user.id
      });

      return interaction.editReply({ content: `Changelog draft #${id} created. Use \`/changelog submit id:${id}\` when it is ready for review.` });
    }

    const id = interaction.options.getInteger('id', true);
    const entry = getChangelogEntry(guildId, id);

    if (!entry) {
      return interaction.editReply({ content: 'That changelog entry does not exist in this server.' });
    }

    if (subcommand === 'view') {
      return interaction.editReply({ embeds: [buildChangelogEmbed(entry)] });
    }

    if (subcommand === 'submit') {
      if (entry.status !== 'DRAFT') {
        return interaction.editReply({ content: 'Only draft changelogs can be submitted for review.' });
      }

      const settings = getChangelogSettings(guildId);
      const reviewChannel = await getSendableChannel(interaction, settings?.reviewChannelId);
      if (!reviewChannel) {
        return interaction.editReply({ content: 'Configure a valid review channel with `/changelog setup` first.' });
      }

      const reviewMessage = await reviewChannel.send({
        content: settings.reviewerRoleId ? `<@&${settings.reviewerRoleId}>` : undefined,
        embeds: [buildChangelogEmbed({ ...entry, status: 'PENDING' }, { review: true })],
        components: buildReviewComponents(entry.id),
        allowedMentions: settings.reviewerRoleId ? { roles: [settings.reviewerRoleId], parse: [] } : { parse: [] }
      });

      const result = markChangelogSubmitted(entry.id, reviewMessage.id);
      if (!result.changes) {
        await reviewMessage.delete().catch(() => null);
        return interaction.editReply({ content: 'This draft was changed before it could be submitted. Try again.' });
      }

      return interaction.editReply({ content: `Changelog #${entry.id} was sent to ${reviewChannel} for review.` });
    }

    if (entry.status !== 'APPROVED') {
      return interaction.editReply({ content: 'Only approved changelogs can be published.' });
    }

    const settings = getChangelogSettings(guildId);
    const publishChannel = await getSendableChannel(interaction, settings?.publishChannelId);
    if (!publishChannel) {
      return interaction.editReply({ content: 'Configure a valid publishing channel with `/changelog setup` first.' });
    }

    const published = await publishChannel.send({ embeds: [buildChangelogEmbed(entry)] });
    const result = markChangelogPublished(entry.id, interaction.user.id, published.id);

    if (!result.changes) {
      return interaction.editReply({ content: 'That changelog was already published or its review status changed.' });
    }

    return interaction.editReply({ content: `Changelog #${entry.id} was published in ${publishChannel}.` });
  }
};

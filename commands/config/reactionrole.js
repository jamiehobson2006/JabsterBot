const {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder
} = require('discord.js');

const {
  all,
  get,
  run
} = require('../../database');

const {
  DEFAULT_COLOR,
  parseEmbedColor,
  validHttpsUrl
} = require('../../utils/memberExperience');

const {
  canManageReactionRole,
  parseReactionEmoji,
  reactionEmojiKey
} = require('../../utils/reactionRoles');

const textChannelTypes = [
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement
];

function reactionRolePanelEmbed(options) {

  const embed =
    new EmbedBuilder()
      .setColor(options.color)
      .setTitle(options.title)
      .setDescription(options.description)
      .setTimestamp();

  if (options.thumbnailUrl) {

    embed.setThumbnail(options.thumbnailUrl);
  }

  if (options.imageUrl) {

    embed.setImage(options.imageUrl);
  }

  if (options.footer) {

    embed.setFooter({ text: options.footer });
  }

  return embed;
}

async function getPanelMessage({
  interaction,
  channel,
  messageId
}) {

  const panel =
    get(
      `SELECT *
       FROM reaction_role_panels
       WHERE guildId = ?
       AND channelId = ?
       AND messageId = ?`,
      [interaction.guild.id, channel.id, messageId]
    );

  if (!panel) {

    return {
      panel: null,
      message: null
    };
  }

  const message =
    await channel.messages.fetch(messageId)
      .catch(() => null);

  return {
    panel,
    message
  };
}

function invalidRoleMessage(guild, role) {

  if (role.id === guild.id) {

    return 'The @everyone role cannot be a reaction role.';
  }

  if (!canManageReactionRole(guild, role)) {

    return 'Choose a normal role below my highest role.';
  }

  return null;
}

module.exports = {

  cooldown: 2500,
  ephemeral: true,

  data: new SlashCommandBuilder()
    .setName('reactionrole')
    .setDescription('Create and manage reaction role panels')
    .setDefaultMemberPermissions(
      PermissionFlagsBits.Administrator
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('create')
        .setDescription('Create a customized reaction role panel')
        .addChannelOption(option =>
          option
            .setName('channel')
            .setDescription('Channel for the panel')
            .addChannelTypes(...textChannelTypes)
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName('title')
            .setDescription('Embed title')
            .setMaxLength(256)
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName('description')
            .setDescription('Embed description and role instructions')
            .setMaxLength(4000)
            .setRequired(true)
        )
        .addBooleanOption(option =>
          option
            .setName('exclusive')
            .setDescription('Keep only one role from this panel at a time')
        )
        .addStringOption(option =>
          option
            .setName('color')
            .setDescription('Embed colour in hex, for example #5865F2')
            .setMaxLength(7)
        )
        .addStringOption(option =>
          option
            .setName('thumbnail_url')
            .setDescription('Optional HTTPS thumbnail image URL')
            .setMaxLength(1000)
        )
        .addStringOption(option =>
          option
            .setName('image_url')
            .setDescription('Optional HTTPS full-width image URL')
            .setMaxLength(1000)
        )
        .addStringOption(option =>
          option
            .setName('footer')
            .setDescription('Optional embed footer')
            .setMaxLength(2048)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('add')
        .setDescription('Add an emoji and role to an existing panel')
        .addChannelOption(option =>
          option
            .setName('channel')
            .setDescription('Panel channel')
            .addChannelTypes(...textChannelTypes)
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName('message_id')
            .setDescription('Reaction role panel message ID')
            .setMinLength(17)
            .setMaxLength(20)
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName('emoji')
            .setDescription('Unicode emoji or custom emoji from this server')
            .setMaxLength(100)
            .setRequired(true)
        )
        .addRoleOption(option =>
          option
            .setName('role')
            .setDescription('Role to add with this emoji')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('remove')
        .setDescription('Remove an emoji mapping from a panel')
        .addChannelOption(option =>
          option
            .setName('channel')
            .setDescription('Panel channel')
            .addChannelTypes(...textChannelTypes)
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName('message_id')
            .setDescription('Reaction role panel message ID')
            .setMinLength(17)
            .setMaxLength(20)
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName('emoji')
            .setDescription('Emoji mapping to remove')
            .setMaxLength(100)
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('List roles configured on a panel')
        .addChannelOption(option =>
          option
            .setName('channel')
            .setDescription('Panel channel')
            .addChannelTypes(...textChannelTypes)
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName('message_id')
            .setDescription('Reaction role panel message ID')
            .setMinLength(17)
            .setMaxLength(20)
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('delete')
        .setDescription('Delete a panel configuration')
        .addChannelOption(option =>
          option
            .setName('channel')
            .setDescription('Panel channel')
            .addChannelTypes(...textChannelTypes)
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName('message_id')
            .setDescription('Reaction role panel message ID')
            .setMinLength(17)
            .setMaxLength(20)
            .setRequired(true)
        )
        .addBooleanOption(option =>
          option
            .setName('delete_message')
            .setDescription('Also delete the Discord panel message')
        )
    ),

  async execute(interaction) {

    if (!interaction.memberPermissions?.has(
      PermissionFlagsBits.Administrator
    )) {

      return interaction.editReply({
        content: 'Administrator permission is required.'
      });
    }

    const subcommand =
      interaction.options.getSubcommand();

    if (subcommand === 'create') {

      const channel =
        interaction.options.getChannel('channel', true);

      const color =
        parseEmbedColor(interaction.options.getString('color'));

      if (color === null) {

        return interaction.editReply({
          content: 'Use a six-digit hex colour such as `#5865F2`.'
        });
      }

      const thumbnailUrl =
        validHttpsUrl(interaction.options.getString('thumbnail_url'));

      const imageUrl =
        validHttpsUrl(interaction.options.getString('image_url'));

      if (
        (interaction.options.getString('thumbnail_url') && !thumbnailUrl) ||
        (interaction.options.getString('image_url') && !imageUrl)
      ) {

        return interaction.editReply({
          content: 'Image URLs must use HTTPS.'
        });
      }

      const requiredPermissions = [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AddReactions
      ];

      const permissions =
        channel.permissionsFor(interaction.guild.members.me);

      if (!requiredPermissions.every(permission => permissions?.has(permission))) {

        return interaction.editReply({
          content: 'I need View Channel, Send Messages, Embed Links, Read Message History, and Add Reactions there.'
        });
      }

      const panelOptions = {
        title: interaction.options.getString('title', true),
        description: interaction.options.getString('description', true),
        exclusive: interaction.options.getBoolean('exclusive') ? 1 : 0,
        color: color ?? DEFAULT_COLOR,
        thumbnailUrl,
        imageUrl,
        footer: interaction.options.getString('footer') || null
      };

      const message =
        await channel.send({
          embeds: [reactionRolePanelEmbed(panelOptions)]
        });

      run(
        `INSERT INTO reaction_role_panels (
           messageId, guildId, channelId, title, description, color,
           thumbnailUrl, imageUrl, footer, exclusive, createdBy, createdAt
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          message.id,
          interaction.guild.id,
          channel.id,
          panelOptions.title,
          panelOptions.description,
          panelOptions.color,
          panelOptions.thumbnailUrl,
          panelOptions.imageUrl,
          panelOptions.footer,
          panelOptions.exclusive,
          interaction.user.id,
          Date.now()
        ]
      );

      return interaction.editReply({
        content: `Reaction role panel created in ${channel}. Its message ID is \`${message.id}\`.`,
        allowedMentions: { parse: [] }
      });
    }

    const channel =
      interaction.options.getChannel('channel', true);

    const messageId =
      interaction.options.getString('message_id', true);

    const { panel, message } =
      await getPanelMessage({
        interaction,
        channel,
        messageId
      });

    if (!panel) {

      return interaction.editReply({
        content: 'That message is not a reaction role panel configured by me.'
      });
    }

    if (subcommand === 'list') {

      const mappings =
        all(
          `SELECT emoji, roleId
           FROM reaction_role_mappings
           WHERE messageId = ?
           ORDER BY createdAt ASC`,
          [messageId]
        );

      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(panel.color || DEFAULT_COLOR)
            .setTitle(panel.title)
            .setDescription(
              mappings.length
                ? mappings.map(mapping => `${mapping.emoji} <@&${mapping.roleId}>`).join('\n')
                : 'No reactions have been configured yet.'
            )
            .addFields({
              name: 'Role Behaviour',
              value: panel.exclusive
                ? 'Exclusive: members can keep one role from this panel.'
                : 'Members can keep multiple roles from this panel.'
            })
            .setFooter({ text: `Message ID: ${messageId}` })
        ],
        allowedMentions: { parse: [] }
      });
    }

    if (subcommand === 'delete') {

      run(
        `DELETE FROM reaction_role_mappings
         WHERE messageId = ?`,
        [messageId]
      );

      run(
        `DELETE FROM reaction_role_panels
         WHERE messageId = ?`,
        [messageId]
      );

      if (interaction.options.getBoolean('delete_message') && message) {

        await message.delete('Reaction role panel removed')
          .catch(() => null);
      }

      return interaction.editReply({
        content: 'Reaction role panel configuration deleted.'
      });
    }

    const parsedEmoji =
      parseReactionEmoji(
        interaction.options.getString('emoji', true)
      );

    if (!parsedEmoji) {

      return interaction.editReply({
        content: 'Use a single Unicode emoji or a custom emoji such as `<:name:id>`.'
      });
    }

    if (subcommand === 'remove') {

      const result =
        run(
          `DELETE FROM reaction_role_mappings
           WHERE messageId = ?
           AND emojiKey = ?`,
          [messageId, parsedEmoji.key]
        );

      if (!result.changes) {

        return interaction.editReply({
          content: 'That emoji is not configured on this panel.'
        });
      }

      if (message) {

        const reaction =
          message.reactions.cache.find(item =>
            reactionEmojiKey(item) === parsedEmoji.key
          );

        await reaction?.users.remove(interaction.client.user.id)
          .catch(() => null);
      }

      return interaction.editReply({
        content: `${parsedEmoji.display} was removed from this reaction role panel.`
      });
    }

    if (!message) {

      return interaction.editReply({
        content: 'I could not find the panel message. It may have been deleted.'
      });
    }

    const role =
      interaction.options.getRole('role', true);

    const roleError =
      invalidRoleMessage(interaction.guild, role);

    if (roleError) {

      return interaction.editReply({ content: roleError });
    }

    const result =
      run(
        `INSERT OR IGNORE INTO reaction_role_mappings (
           messageId, emojiKey, emoji, roleId, createdAt
         )
         VALUES (?, ?, ?, ?, ?)`,
        [
          messageId,
          parsedEmoji.key,
          parsedEmoji.display,
          role.id,
          Date.now()
        ]
      );

    if (!result.changes) {

      return interaction.editReply({
        content: 'That emoji is already configured on this panel.'
      });
    }

    try {

      await message.react(parsedEmoji.display);

    } catch (err) {

      run(
        `DELETE FROM reaction_role_mappings
         WHERE messageId = ?
         AND emojiKey = ?`,
        [messageId, parsedEmoji.key]
      );

      console.error('Reaction role emoji error:', err);

      return interaction.editReply({
        content: 'I could not add that emoji. Check that I can use it and have Add Reactions permission.'
      });
    }

    return interaction.editReply({
      content: `${parsedEmoji.display} now gives ${role}.`,
      allowedMentions: { parse: [] }
    });
  }
};

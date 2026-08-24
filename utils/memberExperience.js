const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');

const DEFAULT_COLOR =
  0x5865F2;

const BUTTON_STYLES = {
  Primary: ButtonStyle.Primary,
  Secondary: ButtonStyle.Secondary,
  Success: ButtonStyle.Success,
  Danger: ButtonStyle.Danger
};

const RANDOM_GREETINGS = {
  welcome: [
    'Welcome {user} to **{server}**. You are member #{member_count}.',
    '{user} just joined **{server}**. Make them feel welcome.',
    'Good to have you here, {user}. Welcome to **{server}**.'
  ],
  goodbye: [
    '{username} has left **{server}**. We hope to see them again.',
    'Goodbye {username}. **{server}** is now at {member_count} members.',
    '{username} has headed out. Take care.'
  ]
};

function parseEmbedColor(value) {

  if (!value) {

    return DEFAULT_COLOR;
  }

  const cleaned =
    String(value)
      .trim()
      .replace(/^#/, '');

  if (!/^[0-9a-f]{6}$/i.test(cleaned)) {

    return null;
  }

  return Number.parseInt(cleaned, 16);
}

function validHttpsUrl(value) {

  if (!value) {

    return null;
  }

  try {

    const url =
      new URL(value);

    return url.protocol === 'https:'
      ? url.toString()
      : null;

  } catch {

    return null;
  }
}

function buildVerificationPanel(settings) {

  const embed =
    new EmbedBuilder()
      .setColor(Number(settings.color) || DEFAULT_COLOR)
      .setTitle(settings.title || 'Verify Your Account')
      .setDescription(
        settings.description ||
        'Click the button below to verify.'
      )
      .setTimestamp();

  if (settings.thumbnailUrl) {

    embed.setThumbnail(settings.thumbnailUrl);
  }

  if (settings.imageUrl) {

    embed.setImage(settings.imageUrl);
  }

  if (settings.footer) {

    embed.setFooter({ text: settings.footer });
  }

  const button =
    new ButtonBuilder()
      .setCustomId('verification_complete')
      .setLabel(settings.buttonLabel || 'Verify')
      .setStyle(
        BUTTON_STYLES[settings.buttonStyle] ||
        ButtonStyle.Success
      );

  if (settings.buttonEmoji) {

    button.setEmoji(settings.buttonEmoji);
  }

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder()
        .addComponents(button)
    ]
  };
}

function greetingTemplate(
  type,
  mode,
  customMessage
) {

  if (mode === 'CUSTOM') {

    return customMessage;
  }

  const messages =
    RANDOM_GREETINGS[type] || [];

  return messages[
    Math.floor(Math.random() * messages.length)
  ] || '';
}

function renderGreeting(
  template,
  member
) {

  const replacements = {
    '{user}': `<@${member.id}>`,
    '{username}': member.user.username,
    '{server}': member.guild.name,
    '{member_count}': String(member.guild.memberCount)
  };

  return String(template || '')
    .replace(
      /\{user\}|\{username\}|\{server\}|\{member_count\}/g,
      token => replacements[token]
    )
    .slice(0, 4000);
}

function buildGreetingEmbed({
  settings,
  type,
  member
}) {

  const title =
    settings.title ||
    (
      type === 'welcome'
        ? `Welcome to ${member.guild.name}`
        : type === 'milestone'
          ? `${member.guild.name} Member Milestone`
          : `Goodbye from ${member.guild.name}`
    );

  const template =
    greetingTemplate(
      type,
      settings.mode,
      settings.customMessage
    );

  const embed = new EmbedBuilder()
    .setColor(Number(settings.color) || DEFAULT_COLOR)
    .setTitle(title)
    .setDescription(renderGreeting(template, member))
    .setThumbnail(
      member.user.displayAvatarURL({ size: 256 })
    )
    .setTimestamp();

  if (settings.imageUrl) {
    embed.setImage(settings.imageUrl);
  }

  return embed;
}

module.exports = {
  BUTTON_STYLES,
  DEFAULT_COLOR,
  RANDOM_GREETINGS,
  buildGreetingEmbed,
  buildVerificationPanel,
  parseEmbedColor,
  validHttpsUrl
};

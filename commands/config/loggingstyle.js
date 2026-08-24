const {
  EmbedBuilder,
  SlashCommandBuilder
} = require('discord.js');

const {
  LOG_CATEGORIES,
  getLogDestination,
  setLogPresentation
} = require('../../utils/loggingConfig');

const {
  canConfigureLogging
} = require('../../utils/loggingPanel');

function parseColor(value) {
  if (!value) return null;
  const cleaned = value.trim().replace(/^#/, '');
  return /^[0-9a-f]{6}$/i.test(cleaned)
    ? Number.parseInt(cleaned, 16)
    : null;
}

function categoryOption(option) {
  return option
    .setName('category')
    .setDescription('Logging category')
    .setRequired(true)
    .addChoices(
      Object.entries(LOG_CATEGORIES).map(([value, category]) => ({
        name: category.label,
        value
      }))
    );
}

module.exports = {
  cooldown: 1500,
  ephemeral: true,

  data: new SlashCommandBuilder()
    .setName('loggingstyle')
    .setDescription('Set the colour and presentation of logging categories')
    .addSubcommand(subcommand =>
      subcommand
        .setName('set')
        .setDescription('Set a logging category style')
        .addStringOption(categoryOption)
        .addStringOption(option => option
          .setName('style')
          .setDescription('Embed presentation')
          .setRequired(true)
          .addChoices(
            { name: 'Default', value: 'DEFAULT' },
            { name: 'Branded', value: 'BRANDED' },
            { name: 'Compact', value: 'COMPACT' }
          ))
        .addStringOption(option => option
          .setName('color')
          .setDescription('Optional hex colour, for example #5865F2')
          .setMaxLength(7))
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('view')
        .setDescription('View a logging category presentation')
        .addStringOption(categoryOption)
    ),

  async execute(interaction) {
    if (!canConfigureLogging(interaction)) {
      return interaction.editReply({
        content: 'You need Administrator permission or a logging manager role to configure logging.'
      });
    }

    const subcommand = interaction.options.getSubcommand();
    const category = interaction.options.getString('category', true);
    const destination = getLogDestination(interaction.guild.id, category);

    if (subcommand === 'view') {
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(destination.color || 0x5865F2)
          .setTitle(`${LOG_CATEGORIES[category].label} Logging Style`)
          .addFields(
            { name: 'Style', value: destination.style || 'DEFAULT', inline: true },
            { name: 'Colour', value: destination.color ? `#${Number(destination.color).toString(16).padStart(6, '0').toUpperCase()}` : 'Original embed colour', inline: true },
            { name: 'Channel', value: destination.channelId ? `<#${destination.channelId}>` : 'Not configured', inline: true }
          )
          .setTimestamp()],
        allowedMentions: { parse: [] }
      });
    }

    const colorInput = interaction.options.getString('color');
    const color = parseColor(colorInput);

    if (colorInput && color === null) {
      return interaction.editReply({ content: 'Use a six-digit hex colour such as `#5865F2`.' });
    }

    const style = interaction.options.getString('style', true);
    setLogPresentation({
      guildId: interaction.guild.id,
      type: category,
      color,
      style
    });

    return interaction.editReply({
      content: `${LOG_CATEGORIES[category].label} logs now use the ${style.toLowerCase()} presentation${color ? ` with #${color.toString(16).padStart(6, '0').toUpperCase()}` : ''}.`
    });
  }
};

const {
  ActionRowBuilder,
  EmbedBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder
} = require('discord.js');

const CATEGORY_NAMES = {
  config: 'Configuration',
  fun: 'Fun',
  giveaways: 'Giveaways',
  leveling: 'Leveling',
  moderation: 'Moderation',
  social: 'Social',
  suggestions: 'Suggestions',
  utility: 'Utility'
};

function commandExample(command) {
  const json =
    command.data.toJSON();

  const parts =
    [`/${json.name}`];

  let options =
    json.options || [];

  const group =
    options.find(option => option.type === 2);

  if (group) {
    parts.push(group.name);
    options = group.options || [];
  }

  const subcommand =
    options.find(option => option.type === 1);

  if (subcommand) {
    parts.push(subcommand.name);
    options = subcommand.options || [];
  }

  for (const option of options) {
    if (option.type === 1 || option.type === 2) {
      continue;
    }

    parts.push(
      option.required
        ? `<${option.name}>`
        : `[${option.name}]`
    );
  }

  return parts.join(' ');
}

function categoryCommands(client, category) {
  return [...client.commands.values()]
    .filter(command => command.category === category)
    .sort((left, right) =>
      left.data.name.localeCompare(right.data.name)
    );
}

function categoryEmbeds(client, category) {
  const commands =
    categoryCommands(client, category);

  const name =
    CATEGORY_NAMES[category] ||
    category;

  if (!commands.length) {
    return [
      new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`${name} Commands`)
        .setDescription('No commands are available in this category.')
    ];
  }

  const entries =
    commands.map(command =>
      `**/${command.data.name}** - ${command.data.description}\nExample: \`${commandExample(command)}\``
    );

  const embeds = [];
  let current = '';

  for (const entry of entries) {
    const next =
      current
        ? `${current}\n\n${entry}`
        : entry;

    if (next.length > 3800 && current) {
      embeds.push(current);
      current = entry;
    } else {
      current = next;
    }
  }

  if (current) {
    embeds.push(current);
  }

  return embeds.map((description, index) =>
    new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle(
        `${name} Commands${embeds.length > 1 ? ` (${index + 1}/${embeds.length})` : ''}`
      )
      .setDescription(description)
      .setFooter({
        text: 'Use /help to choose another category'
      })
  );
}

function helpMenu(client) {
  const options =
    Object.entries(CATEGORY_NAMES)
      .filter(([category]) => categoryCommands(client, category).length)
      .map(([value, label]) => ({
        label,
        value,
        description: `View ${label.toLowerCase()} commands`
      }));

  return new ActionRowBuilder()
    .addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('help_category')
        .setPlaceholder('Choose a command category')
        .addOptions(options)
    );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Browse all Jabster Studios commands')
    .addStringOption(option =>
      option
        .setName('category')
        .setDescription('Command category to view')
        .addChoices(
          ...Object.entries(CATEGORY_NAMES).map(([value, name]) => ({
            name,
            value
          }))
        )
    ),

  async execute(interaction, client) {
    const category =
      interaction.options.getString('category');

    if (category) {
      return interaction.editReply({
        embeds: categoryEmbeds(client, category)
      });
    }

    const available =
      Object.entries(CATEGORY_NAMES)
        .filter(([key]) => categoryCommands(client, key).length)
        .map(([, name]) => name)
        .join('\n');

    return interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('Jabster Studios Help')
          .setDescription('Choose a category below to see every command, its description, and an example.')
          .addFields({
            name: 'Categories',
            value: available || 'No commands available.'
          })
      ],
      components: [helpMenu(client)]
    });
  },

  categoryEmbeds,
  helpMenu
};

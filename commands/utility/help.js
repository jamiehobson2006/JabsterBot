const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
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

function categoryEntries(client, category, context = {}) {
  let entries=require('../../utils/commandRegistry').commandEntries(client.commands)
    .filter(entry => category==='all' || entry.category === category);
  const query=String(context.query || '').toLowerCase();
  entries=entries.filter(entry=>`${entry.path} ${entry.description}`.toLowerCase().includes(query));
  if(context.member && context.guild && context.channel) entries=entries.map(entry=>({...entry,
    access:require('../../utils/commandAccess').checkAction({commands:client.commands,path:entry.path,...context})}))
    .filter(entry=>context.includeLocked || entry.access.eligible);
  return entries;
}

function commandExample(entry) {
  const options = entry.options.map(option =>
    option.required ? `<${option.name}>` : `[${option.name}]`);
  return [`/${entry.path}`, ...options].join(' ');
}

function categoryPages(client, category, context = {}) {
  const entries = categoryEntries(client, category,context).map(entry =>
    `**/${entry.path}** - ${entry.description}\nExample: \`${commandExample(entry)}\`${entry.access && !entry.access.eligible?'\nBlocked: '+entry.access.reason:entry.access?.conditional?'\n'+entry.access.reason:''}`);
  const pages = [];
  let current = '';
  for (const entry of entries) {
    const next = current ? `${current}\n\n${entry}` : entry;
    if (next.length > 3800 && current) { pages.push(current); current = entry; }
    else current = next;
  }
  if (current) pages.push(current);
  return pages.length ? pages : ['No commands are available in this category.'];
}

function categoryEmbeds(client, category, requestedPage = 1, context = {}) {
  const pages = categoryPages(client, category,context);
  const page = Math.max(1, Math.min(pages.length, Number(requestedPage) || 1));
  return [new EmbedBuilder().setColor(0x5865F2)
    .setTitle(`${CATEGORY_NAMES[category] || category} Commands`)
    .setDescription(pages[page - 1])
    .setFooter({ text: `Page ${page}/${pages.length} | Use /help to choose another category` })];
}

function categoryPayload(client, category, requestedPage = 1, context = {}) {
  const pages = categoryPages(client, category,context);
  const page = Math.max(1, Math.min(pages.length, Number(requestedPage) || 1));
  const components = pages.length > 1 ? [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`help_page:${category}:${page - 1}${context.viewId?':'+context.viewId:''}`).setLabel('Previous')
      .setStyle(ButtonStyle.Secondary).setDisabled(page === 1),
    new ButtonBuilder().setCustomId(`help_page:${category}:${page + 1}${context.viewId?':'+context.viewId:''}`).setLabel('Next')
      .setStyle(ButtonStyle.Secondary).setDisabled(page === pages.length)
  )] : [];
  return { embeds: categoryEmbeds(client, category, page,context), components, allowedMentions: { parse: [] } };
}

function helpMenu(client,context = {}) {
  const options =
    Object.entries(CATEGORY_NAMES)
      .filter(([category]) => categoryEntries(client, category,context).length)
      .map(([value, label]) => ({
        label,
        value,
        description: `View ${label.toLowerCase()} commands`
      }));

  return new ActionRowBuilder()
    .addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`help_category${context.viewId?':'+context.viewId:''}`)
        .setPlaceholder('Choose a command category')
        .addOptions(options)
    );
}

module.exports = {
  ephemeral:true,
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
    )
    .addIntegerOption(option => option.setName('page').setDescription('Category page').setMinValue(1))
    .addStringOption(option=>option.setName('query').setDescription('Search command names and descriptions').setMaxLength(100))
    .addStringOption(option=>option.setName('command').setDescription('Explain local access to a specific command action').setAutocomplete(true).setMaxLength(100))
    .addBooleanOption(option=>option.setName('include_locked').setDescription('Include blocked commands and explain their requirements')),

  async execute(interaction, client) {
    const category =
      interaction.options.getString('category');
    const member=await interaction.guild.members.fetch({user:interaction.user.id,force:true});
    const context={guild:interaction.guild,member,channel:interaction.channel,query:interaction.options.getString('query') || '',
      includeLocked:interaction.options.getBoolean('include_locked') || false};
    const selected=interaction.options.getString('command');
    if(selected) {
      const found=require('../../utils/commandRegistry').commandNode(client.commands,selected);
      if(!found)return interaction.editReply('That command action is not loaded.');
      const result=require('../../utils/commandAccess').checkAction({commands:client.commands,path:found.name,...context});
      return interaction.editReply({embeds:[new EmbedBuilder().setColor(result.eligible?0x57F287:0xED4245).setTitle(`/${found.name}`)
        .setDescription(`${found.node.description}\n\n**${result.eligible?'Locally eligible':'Blocked'}**\n${result.reason}`)
        .setFooter({text:'Discord integration overrides, selected items, target hierarchy and cooldowns can impose additional checks.'})],allowedMentions:{parse:[]}});
    }

    const {run}=require('../../database');
    context.viewId=require('node:crypto').randomUUID();
    run('DELETE FROM help_views WHERE expiresAt<?',[Date.now()]);
    run('INSERT INTO help_views VALUES(?,?,?,?,?,?)',[context.viewId,interaction.guild.id,member.id,context.query,Number(context.includeLocked),Date.now()+3600000]);
    if (category || context.query) {
      return interaction.editReply(categoryPayload(client, category || 'all', interaction.options.getInteger('page') || 1,context));
    }

    const available =
      Object.entries(CATEGORY_NAMES)
        .filter(([key]) => categoryEntries(client, key,context).length)
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
      components: available?[helpMenu(client,context)]:[]
    });
  },

  categoryEmbeds,
  categoryPayload,
  categoryPages,
  helpMenu
};

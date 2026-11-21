const { SlashCommandBuilder, PermissionFlagsBits: P, ChannelType } = require('discord.js');
const panels = require('../../utils/tickets/panels');
const ticketTypes = require('../../utils/tickets/ticketTypes');
const panelOption = command => command.addStringOption(option => option.setName('panel').setDescription('Named panel')
  .setRequired(true).setMaxLength(32).setAutocomplete(true));
const typeOption = command => command.addStringOption(option => option.setName('type').setDescription('Ticket type')
  .setRequired(true).addChoices(...Object.entries(ticketTypes).map(([value, type]) => ({ name: type.name, value }))));
const data = new SlashCommandBuilder().setName('ticketpanels').setDescription('Manage independently routed named ticket panels.')
  .setDefaultMemberPermissions(P.Administrator).setDMPermission(false);
data.addSubcommand(command => command.setName('create').setDescription('Create an empty named panel; add its ticket types with set.')
  .addStringOption(option => option.setName('name').setDescription('Unique name, e.g. general-help').setRequired(true).setMaxLength(32))
  .addStringOption(option => option.setName('title').setDescription('Panel heading').setMaxLength(150))
  .addStringOption(option => option.setName('description').setDescription('Panel message').setMaxLength(1500)));
data.addSubcommand(command => typeOption(panelOption(command.setName('set').setDescription('Add/update a ticket type and its destination on this panel.')))
  .addChannelOption(option => option.setName('category').setDescription('Destination for this panel and ticket type').addChannelTypes(ChannelType.GuildCategory))
  .addStringOption(option => option.setName('category_id').setDescription('Alternative category ID').setMinLength(16).setMaxLength(22))
  .addRoleOption(option => option.setName('staff_role').setDescription('Staff who can see and handle these tickets'))
  .addBooleanOption(option => option.setName('enabled').setDescription('Offer this type on this panel')));
data.addSubcommand(command => panelOption(command.setName('edit').setDescription('Edit a panel heading, message or enabled state.'))
  .addStringOption(option => option.setName('title').setDescription('Panel heading').setMaxLength(150))
  .addStringOption(option => option.setName('description').setDescription('Panel message').setMaxLength(1500))
  .addBooleanOption(option => option.setName('enabled').setDescription('Enable/disable every posted copy of this panel')));
data.addSubcommand(command => typeOption(panelOption(command.setName('remove').setDescription('Remove one ticket type from this panel only.'))));
data.addSubcommand(command => panelOption(command.setName('show').setDescription('Inspect a panel and its routes.')));
data.addSubcommand(command => command.setName('list').setDescription('List configured panels.')
  .addIntegerOption(option => option.setName('page').setDescription('Page').setMinValue(1)));

module.exports = { data, ephemeral: true, async execute(interaction) {
  const member = await interaction.guild.members.fetch({ user: interaction.user.id, force: true });
  if (!member.permissions.has(P.Administrator)) throw new Error('Administrator permission is required to manage panels.');
  const action = interaction.options.getSubcommand(), guildId = interaction.guild.id;
  const string = key => interaction.options.getString(key);
  if (action === 'create') {
    const panel = panels.create(guildId, member.id, { name: string('name'), title: string('title'), description: string('description') });
    return interaction.editReply(`Panel ${panel.name} created. Add ticket types with /ticket panels set, then post it using /ticket panel panel:${panel.name}.`);
  }
  if (action === 'list') return interaction.editReply({ content: require('../../utils/communityAccess').pageRows(panels.list(guildId), interaction.options.getInteger('page') || 1, 8)
    .map(panel => `**${panel.name}** | ${panel.enabled ? 'Enabled' : 'Disabled'} | ${panels.routes(guildId, panel.id).filter(route => route.enabled).length} ticket types`).join('\n') || 'No named panels on this page.', allowedMentions: { parse: [] } });
  const name = string('panel');
  let panel = panels.byName(guildId, name);
  if (!panel) throw new Error('Panel not found in this server.');
  if (action === 'set') {
    const category = interaction.options.getChannel('category'), id = string('category_id');
    if (id && !/^\d{16,22}$/.test(id)) throw new Error('Copy the numeric ID of a category.');
    if (category && id && category.id !== id) throw new Error('Choose category or category_id, not two different destinations.');
    await panels.setRoute(interaction.guild, name, string('type'), { categoryId: id || category?.id,
      roleId: interaction.options.getRole('staff_role')?.id, enabled: interaction.options.getBoolean('enabled') });
  } else if (action === 'edit') panel = panels.edit(guildId, name, { title: string('title'), description: string('description'), enabled: interaction.options.getBoolean('enabled') });
  else if (action === 'remove') panels.removeRoute(guildId, name, string('type'));
  return interaction.editReply({ content: `**${panel.name}** | ${panel.enabled ? 'Enabled' : 'Disabled'}\n` +
    (panels.routes(guildId, panel.id).map(route => `${ticketTypes[route.type]?.name || route.type}: <#${route.categoryId}> | <@&${route.roleId}> | ${route.enabled ? 'Enabled' : 'Disabled'}`).join('\n') || 'No ticket types configured.') +
    '\nPost or refresh the visible menu with /ticket panel. Existing copies use these saved routes when clicked.', allowedMentions: { parse: [] } });
} };

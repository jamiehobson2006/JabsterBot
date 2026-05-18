const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionsBitField,
  SlashCommandBuilder,
} = require('discord.js');

const { all, get } = require('../../database');

const VERSION = 'Ticket System v3';

const ticketTypes = [
  {
    key: 'support',
    label: 'Support',
    setting: 'supportCategoryId',
    fallbackSetting: 'ticketCategoryId',
    style: ButtonStyle.Primary,
    description: 'Get help from the staff team.',
  },
  {
    key: 'application',
    label: 'Application',
    setting: 'applicationCategoryId',
    style: ButtonStyle.Success,
    description: 'Apply for staff or special roles.',
  },
  {
    key: 'bug',
    label: 'Bug Report',
    setting: 'bugCategoryId',
    style: ButtonStyle.Secondary,
    description: 'Report a bug so staff can investigate it.',
  },
  {
    key: 'giveaway',
    label: 'Giveaway',
    setting: 'giveawayCategoryId',
    style: ButtonStyle.Secondary,
    description: 'Claim giveaway rewards.',
  },
];

function settingValue(settings, type) {
  return settings?.[type.setting] || (type.fallbackSetting ? settings?.[type.fallbackSetting] : null);
}

function enabledTicketTypes(settings) {
  return ticketTypes.filter((type) => Boolean(settingValue(settings, type)));
}

function buildDebug(interaction, settings) {
  const savedRows = all(
    `SELECT guildId, ticketCategoryId, supportCategoryId, applicationCategoryId, bugCategoryId, giveawayCategoryId
     FROM guild_settings
     WHERE ticketCategoryId IS NOT NULL OR supportCategoryId IS NOT NULL
     LIMIT 5`,
  );

  return [
    `${VERSION}`,
    `This server: ${interaction.guild.id}`,
    `Settings row found: ${settings ? 'yes' : 'no'}`,
    `Support saved here: ${settings?.supportCategoryId || settings?.ticketCategoryId || 'none'}`,
    savedRows.length
      ? `Saved ticket guilds: ${savedRows.map((row) => row.guildId).join(', ')}`
      : 'Saved ticket guilds: none',
  ].join('\n');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticketpanel')
    .setDescription('Send the ticket panel to the current channel'),

  async execute(interaction) {
    try {
      if (!interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.editReply({ content: 'You need Administrator permission.' });
      }

      const settings = get('SELECT * FROM guild_settings WHERE guildId = ?', [interaction.guild.id]);
      const enabledTypes = enabledTicketTypes(settings);

      if (!enabledTypes.some((type) => type.key === 'support')) {
        return interaction.editReply({
          content: `Ticket system is not configured. Use \`/setticketchannel\` first.\n\nDebug:\n${buildDebug(interaction, settings)}`,
        });
      }

      const description = enabledTypes
        .map((type) => `**${type.label}**\n${type.description}`)
        .join('\n\n');

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`${VERSION} Support Center`)
        .setDescription(description)
        .addFields({
          name: 'Enabled Types',
          value: enabledTypes.map((type) => type.label).join(', '),
        })
        .setFooter({ text: `Server: ${interaction.guild.name}` })
        .setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        ...enabledTypes.map((type) => new ButtonBuilder()
          .setCustomId(`ticket_${type.key}`)
          .setLabel(type.label)
          .setStyle(type.style)),
      );

      await interaction.channel.send({
        embeds: [embed],
        components: [row],
      });

      return interaction.editReply({ content: `${VERSION} panel sent successfully.` });
    } catch (err) {
      console.error('TicketPanel Error:', err);
      return interaction.editReply({ content: 'Failed to send ticket panel.' });
    }
  },
};

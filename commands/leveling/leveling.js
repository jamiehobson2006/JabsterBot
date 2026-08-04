const {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder
} = require('discord.js');

const {
  run
} = require('../../database');

const {
  getLevelingConfig,
  parseIdList,
  stringifyIdList
} = require('../../utils/levelingConfig');

const levelChannelTypes = [
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement
];

const mutedChannelTypes = [
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildForum,
  ChannelType.GuildVoice,
  ChannelType.GuildCategory
];

function formatMutedChannels(ids) {
  const shownIds = ids.slice(0, 100);
  const list = shownIds.map(id => `<#${id}>`).join('\n');

  return ids.length
    ? `${list}${ids.length > shownIds.length ? `\n...and ${ids.length - shownIds.length} more.` : ''}`
    : 'No channels are muted for XP.';
}

module.exports = {
  cooldown: 3000,

  data: new SlashCommandBuilder()
    .setName('leveling')
    .setDescription('Configure the server leveling system')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(subcommand => subcommand
      .setName('settings')
      .setDescription('View the current leveling settings'))
    .addSubcommand(subcommand => subcommand
      .setName('enable')
      .setDescription('Enable XP earning'))
    .addSubcommand(subcommand => subcommand
      .setName('disable')
      .setDescription('Disable XP earning'))
    .addSubcommand(subcommand => subcommand
      .setName('xp')
      .setDescription('Set XP awarded for eligible messages')
      .addIntegerOption(option => option
        .setName('min')
        .setDescription('Minimum XP per eligible message')
        .setMinValue(1)
        .setMaxValue(1000)
        .setRequired(true))
      .addIntegerOption(option => option
        .setName('max')
        .setDescription('Maximum XP per eligible message')
        .setMinValue(1)
        .setMaxValue(1000)
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('cooldown')
      .setDescription('Set time between XP awards')
      .addIntegerOption(option => option
        .setName('seconds')
        .setDescription('Cooldown in seconds')
        .setMinValue(5)
        .setMaxValue(86400)
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('channel')
      .setDescription('Set where level-up announcements are posted')
      .addChannelOption(option => option
        .setName('channel')
        .setDescription('Announcement channel')
        .addChannelTypes(...levelChannelTypes)
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('channel-reset')
      .setDescription('Post level-up announcements in the message channel'))
    .addSubcommand(subcommand => subcommand
      .setName('message')
      .setDescription('Set the plain-text level-up message')
      .addStringOption(option => option
        .setName('text')
        .setDescription('Uses {user}, {level}, {xp}, and {messages}')
        .setMaxLength(1000)
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('announcement')
      .setDescription('Choose how level-ups are announced')
      .addStringOption(option => option
        .setName('style')
        .setDescription('Announcement style')
        .addChoices(
          { name: 'Styled embed', value: 'EMBED' },
          { name: 'Custom message', value: 'MESSAGE' },
          { name: 'No announcement', value: 'OFF' }
        )
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('mutechannel')
      .setDescription('Stop members earning XP in a channel')
      .addChannelOption(option => option
        .setName('channel')
        .setDescription('Channel or category to mute for XP')
        .addChannelTypes(...mutedChannelTypes)
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('unmutechannel')
      .setDescription('Allow members to earn XP in a channel again')
      .addChannelOption(option => option
        .setName('channel')
        .setDescription('Muted channel or category')
        .addChannelTypes(...mutedChannelTypes)
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('mutedchannels')
      .setDescription('List channels where XP is muted')),

  async execute(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.editReply({ content: 'You need Manage Server permission.' });
    }

    const guildId = interaction.guild.id;
    const subcommand = interaction.options.getSubcommand();
    const config = getLevelingConfig(guildId);
    const mutedChannels = parseIdList(config.ignoredChannels);

    if (subcommand === 'settings') {
      const announcement = config.levelUpStyle === 'OFF'
        ? 'Disabled'
        : config.levelUpStyle === 'MESSAGE'
          ? 'Custom message'
          : 'Styled embed';

      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('Leveling Settings')
          .setDescription('XP is awarded once per cooldown for eligible messages.')
          .addFields(
            { name: 'Status', value: Number(config.enabled) === 1 ? 'Enabled' : 'Disabled', inline: true },
            { name: 'XP per message', value: `${config.xpMin} - ${config.xpMax}`, inline: true },
            { name: 'Cooldown', value: `${config.cooldown}s`, inline: true },
            { name: 'Announcement', value: announcement, inline: true },
            { name: 'Announcement channel', value: config.levelChannelId ? `<#${config.levelChannelId}>` : 'Message channel', inline: true },
            { name: 'Muted channels', value: `${mutedChannels.length}`, inline: true },
            { name: 'Custom message', value: config.levelMessage || 'Not set' }
          )
          .setFooter({ text: 'Jabster Studios Leveling' })
          .setTimestamp()]
      });
    }

    if (subcommand === 'enable' || subcommand === 'disable') {
      const enabled = subcommand === 'enable' ? 1 : 0;
      run('UPDATE leveling_config SET enabled = ? WHERE guildId = ?', [enabled, guildId]);
      return interaction.editReply({ content: `Leveling ${enabled ? 'enabled' : 'disabled'}.` });
    }

    if (subcommand === 'xp') {
      const min = interaction.options.getInteger('min', true);
      const max = interaction.options.getInteger('max', true);

      if (min > max) {
        return interaction.editReply({ content: 'Minimum XP cannot be greater than maximum XP.' });
      }

      run('UPDATE leveling_config SET xpMin = ?, xpMax = ? WHERE guildId = ?', [min, max, guildId]);
      return interaction.editReply({ content: `XP range set to ${min}-${max} per eligible message.` });
    }

    if (subcommand === 'cooldown') {
      const seconds = interaction.options.getInteger('seconds', true);
      run('UPDATE leveling_config SET cooldown = ? WHERE guildId = ?', [seconds, guildId]);
      return interaction.editReply({ content: `XP cooldown set to ${seconds} seconds.` });
    }

    if (subcommand === 'channel') {
      const channel = interaction.options.getChannel('channel', true);
      run('UPDATE leveling_config SET levelChannelId = ? WHERE guildId = ?', [channel.id, guildId]);
      return interaction.editReply({ content: `Level-up announcements will be posted in ${channel}.` });
    }

    if (subcommand === 'channel-reset') {
      run('UPDATE leveling_config SET levelChannelId = NULL WHERE guildId = ?', [guildId]);
      return interaction.editReply({ content: 'Level-up announcements will be posted in the message channel.' });
    }

    if (subcommand === 'message') {
      const text = interaction.options.getString('text', true);
      run('UPDATE leveling_config SET levelMessage = ? WHERE guildId = ?', [text, guildId]);
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0x57F287)
          .setTitle('Level-up Message Updated')
          .setDescription(text)
          .addFields({ name: 'Variables', value: '`{user}` ` {level}` ` {xp}` ` {messages}`' })]
      });
    }

    if (subcommand === 'announcement') {
      const style = interaction.options.getString('style', true);
      run('UPDATE leveling_config SET levelUpStyle = ? WHERE guildId = ?', [style, guildId]);
      const display = { EMBED: 'styled embeds', MESSAGE: 'custom messages', OFF: 'no announcements' }[style];
      return interaction.editReply({ content: `Level-up announcements will use ${display}.` });
    }

    const channel = interaction.options.getChannel('channel');

    if (subcommand === 'mutechannel') {
      if (mutedChannels.includes(channel.id)) {
        return interaction.editReply({ content: `${channel} is already muted for XP.` });
      }

      if (mutedChannels.length >= 100) {
        return interaction.editReply({ content: 'You can mute up to 100 channels or categories for XP.' });
      }

      mutedChannels.push(channel.id);
      run('UPDATE leveling_config SET ignoredChannels = ? WHERE guildId = ?', [stringifyIdList(mutedChannels), guildId]);
      return interaction.editReply({ content: `${channel} is now muted for XP.` });
    }

    if (subcommand === 'unmutechannel') {
      if (!mutedChannels.includes(channel.id)) {
        return interaction.editReply({ content: `${channel} is not muted for XP.` });
      }

      const remaining = mutedChannels.filter(id => id !== channel.id);
      run('UPDATE leveling_config SET ignoredChannels = ? WHERE guildId = ?', [stringifyIdList(remaining), guildId]);
      return interaction.editReply({ content: `${channel} can now award XP again.` });
    }

    if (subcommand === 'mutedchannels') {
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0xED4245)
          .setTitle('XP-Muted Channels')
          .setDescription(formatMutedChannels(mutedChannels))
          .setFooter({ text: `${mutedChannels.length} channel(s) or category/categories muted` })]
      });
    }
  }
};

const {
  EmbedBuilder,
  SlashCommandBuilder,
  ChannelType
} = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('serverinfo')
    .setDescription('View information about the server'),

  async execute(interaction) {
    try {
      // ✅ Ensure reply exists
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply();
      }

      const guild = interaction.guild;

      // 👑 Owner
      const owner = await guild.fetchOwner();

      // 👥 Member counts (NO heavy fetch)
      const total = guild.memberCount;
      const bots = guild.members.cache.filter(m => m.user.bot).size;
      const humans = total - bots;

      // 💬 Channel breakdown
      const textChannels = guild.channels.cache.filter(c => c.type === ChannelType.GuildText).size;
      const voiceChannels = guild.channels.cache.filter(c => c.type === ChannelType.GuildVoice).size;
      const categories = guild.channels.cache.filter(c => c.type === ChannelType.GuildCategory).size;

      // 📊 Other stats
      const rolesCount = guild.roles.cache.size;
      const boostLevel = guild.premiumTier;
      const boosts = guild.premiumSubscriptionCount || 0;

      // 🎨 Clean features
      const features = guild.features.length
        ? guild.features
            .slice(0, 5)
            .map(f => f.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()))
            .join(', ')
        : 'None';

      const embed = new EmbedBuilder()
        .setTitle(`📊 ${guild.name}`)
        .setColor(0x5865F2)
        .setThumbnail(guild.iconURL({ dynamic: true }))
        .addFields(
          {
            name: '👑 Owner',
            value: `<@${owner.id}>`,
            inline: true
          },
          {
            name: '👥 Members',
            value: `Total: **${total}**\nHumans: ${humans}\nBots: ${bots}`,
            inline: true
          },
          {
            name: '💬 Channels',
            value: `Text: ${textChannels}\nVoice: ${voiceChannels}\nCategories: ${categories}`,
            inline: true
          },
          {
            name: '🎭 Roles',
            value: `${rolesCount}`,
            inline: true
          },
          {
            name: '🚀 Boost',
            value: `Level ${boostLevel}\n${boosts} boosts`,
            inline: true
          },
          {
            name: '🛡 Features',
            value: features,
            inline: false
          },
          {
            name: '📅 Created',
            value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:F>`,
            inline: false
          }
        )
        .setFooter({ text: `Server ID: ${guild.id}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

    } catch (err) {
      console.error('ServerInfo Error:', err);

      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({
          content: '❌ Failed to fetch server info.'
        });
      } else {
        return interaction.reply({
          content: '❌ Failed to fetch server info.',
          ephemeral: true
        });
      }
    }
  }
};
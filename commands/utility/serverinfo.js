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

      const guild = interaction.guild;

      // 👑 Owner
      const owner = await guild.fetchOwner();

      // 👥 Member counts (better fallback)
      const total = guild.memberCount;

      const cachedBots = guild.members.cache.filter(m => m.user.bot).size;
      const bots = cachedBots > 0 ? cachedBots : 'Unknown';
      const humans = typeof bots === 'number' ? total - bots : 'Unknown';

      // 💬 Channel breakdown (expanded)
      const channels = guild.channels.cache;

      const textChannels = channels.filter(c => c.type === ChannelType.GuildText).size;
      const voiceChannels = channels.filter(c => c.type === ChannelType.GuildVoice).size;
      const categories = channels.filter(c => c.type === ChannelType.GuildCategory).size;
      const stages = channels.filter(c => c.type === ChannelType.GuildStageVoice).size;
      const threads = channels.filter(c => c.isThread?.()).size;

      // 📊 Other stats
      const rolesCount = guild.roles.cache.size;
      const boostLevel = guild.premiumTier;
      const boosts = guild.premiumSubscriptionCount || 0;

      // 🛡 Extra info
      const verification = guild.verificationLevel;
      const nsfwLevel = guild.nsfwLevel;

      // 🔗 Vanity URL
      const vanity = guild.vanityURLCode
        ? `https://discord.gg/${guild.vanityURLCode}`
        : 'None';

      // 🎨 Features (cleaned)
      const features = guild.features.length
        ? guild.features
            .slice(0, 5)
            .map(f =>
              f
                .toLowerCase()
                .replace(/_/g, ' ')
                .replace(/\b\w/g, l => l.toUpperCase())
            )
            .join(', ')
        : 'None';

      const embed = new EmbedBuilder()
        .setTitle(`📊 ${guild.name}`)
        .setColor(0x5865F2)
        .setThumbnail(guild.iconURL({ dynamic: true, size: 256 }))

        .addFields(
          {
            name: '👑 Owner',
            value: `<@${owner.id}>`,
            inline: true
          },
          {
            name: '👥 Members',
            value:
              `Total: **${total}**\n` +
              `Humans: ${humans}\n` +
              `Bots: ${bots}`,
            inline: true
          },
          {
            name: '💬 Channels',
            value:
              `Text: ${textChannels}\n` +
              `Voice: ${voiceChannels}\n` +
              `Stages: ${stages}\n` +
              `Threads: ${threads}\n` +
              `Categories: ${categories}`,
            inline: true
          },
          {
            name: '🎭 Roles',
            value: `${rolesCount}`,
            inline: true
          },
          {
            name: '🚀 Boost Status',
            value:
              `Level: **${boostLevel}**\n` +
              `Boosts: ${boosts}`,
            inline: true
          },
          {
            name: '🛡 Server Settings',
            value:
              `Verification: ${verification}\n` +
              `NSFW Level: ${nsfwLevel}`,
            inline: true
          },
          {
            name: '✨ Features',
            value: features,
            inline: false
          },
          {
            name: '🔗 Vanity URL',
            value: vanity,
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
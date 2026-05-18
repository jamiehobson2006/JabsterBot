const {
  EmbedBuilder,
  SlashCommandBuilder,
  ChannelType
} = require('discord.js');

module.exports = {

  cooldown: 5000,

  data: new SlashCommandBuilder()

    .setName('serverinfo')

    .setDescription('View information about the server'),

  async execute(interaction) {

    try {

      const guild =
        interaction.guild;

      // ========================
      // 👑 OWNER
      // ========================
      const owner =
        await guild.fetchOwner();

      // ========================
      // 👥 ACCURATE MEMBER FETCH
      // ========================
      await guild.members.fetch().catch(() => {});

      const totalMembers =
        guild.memberCount;

      const botCount =
        guild.members.cache.filter(
          m => m.user.bot
        ).size;

      const humanCount =
        totalMembers - botCount;

      // ========================
      // 💬 CHANNEL COUNTS
      // ========================
      const channels =
        guild.channels.cache;

      const textChannels =
        channels.filter(
          c => c.type === ChannelType.GuildText
        ).size;

      const voiceChannels =
        channels.filter(
          c => c.type === ChannelType.GuildVoice
        ).size;

      const categories =
        channels.filter(
          c => c.type === ChannelType.GuildCategory
        ).size;

      const stages =
        channels.filter(
          c => c.type === ChannelType.GuildStageVoice
        ).size;

      const forums =
        channels.filter(
          c => c.type === ChannelType.GuildForum
        ).size;

      const threads =
        channels.filter(
          c => c.isThread?.()
        ).size;

      // ========================
      // 🎭 ROLES / EMOJIS
      // ========================
      const roleCount =
        guild.roles.cache.size;

      const emojiCount =
        guild.emojis.cache.size;

      const stickerCount =
        guild.stickers.cache.size;

      // ========================
      // 🚀 BOOST INFO
      // ========================
      const boostLevel =
        guild.premiumTier;

      const boosts =
        guild.premiumSubscriptionCount || 0;

      // ========================
      // 🛡 SETTINGS
      // ========================
      function formatText(text) {

        return text
          .toLowerCase()
          .replace(/_/g, ' ')
          .replace(/\b\w/g, l => l.toUpperCase());
      }

      const verification =
        formatText(
          guild.verificationLevel
        );

      const nsfwLevel =
        formatText(
          guild.nsfwLevel
        );

      // ========================
      // ✨ FEATURES
      // ========================
      const features =
        guild.features.length

          ? guild.features

              .slice(0, 8)

              .map(f =>
                formatText(f)
              )

              .join(', ')

          : 'None';

      // ========================
      // 🔗 VANITY URL
      // ========================
      const vanity =
        guild.vanityURLCode

          ? `https://discord.gg/${guild.vanityURLCode}`

          : 'None';

      // ========================
      // 📡 SYSTEM CHANNEL
      // ========================
      const systemChannel =
        guild.systemChannel

          ? `<#${guild.systemChannel.id}>`

          : 'None';

      // ========================
      // 🌙 AFK CHANNEL
      // ========================
      const afkChannel =
        guild.afkChannel

          ? `<#${guild.afkChannel.id}>`

          : 'None';

      // ========================
      // 🎨 EMBED
      // ========================
      const embed =
        new EmbedBuilder()

          .setColor(0x5865F2)

          .setTitle(`📊 ${guild.name}`)

          .setDescription(

            `A thriving community with **${totalMembers.toLocaleString()} members** ` +

            `across **${channels.size} channels**.`
          )

          .setThumbnail(
            guild.iconURL({
              dynamic: true,
              size: 512
            })
          )

          // ✅ SERVER BANNER
          .setImage(
            guild.bannerURL({
              size: 1024
            })
          )

          .addFields(

            {
              name: '👑 Owner',

              value:
                `<@${owner.id}>`,

              inline: true
            },

            {
              name: '👥 Members',

              value:

                `🧑 Humans • ${humanCount.toLocaleString()}\n` +
                `🤖 Bots • ${botCount.toLocaleString()}\n` +
                `📦 Total • ${totalMembers.toLocaleString()}`,

              inline: true
            },

            {
              name: '🚀 Boost Status',

              value:

                `Level ${boostLevel}\n` +
                `${boosts} Boosts`,

              inline: true
            },

            {
              name: '💬 Channels',

              value:

                `💬 Text • ${textChannels}\n` +
                `🔊 Voice • ${voiceChannels}\n` +
                `🎤 Stage • ${stages}\n` +
                `🧵 Threads • ${threads}\n` +
                `📁 Categories • ${categories}\n` +
                `🗨 Forums • ${forums}`,

              inline: true
            },

            {
              name: '🎭 Server Assets',

              value:

                `🎭 Roles • ${roleCount}\n` +
                `😄 Emojis • ${emojiCount}\n` +
                `🧩 Stickers • ${stickerCount}`,

              inline: true
            },

            {
              name: '🛡 Security',

              value:

                `Verification • ${verification}\n` +
                `NSFW Level • ${nsfwLevel}`,

              inline: true
            },

            {
              name: '📡 System Channels',

              value:

                `📢 System • ${systemChannel}\n` +
                `🌙 AFK • ${afkChannel}`,

              inline: false
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
              name: '📅 Server Created',

              value:
                `<t:${Math.floor(guild.createdTimestamp / 1000)}:F>`,

              inline: false
            }
          )

          .setFooter({
            text:
              `Server ID: ${guild.id}`
          })

          .setTimestamp();

      await interaction.editReply({
        embeds: [embed]
      });

    } catch (err) {

      console.error(
        'ServerInfo Error:',
        err
      );

      if (
        interaction.deferred ||
        interaction.replied
      ) {

        return interaction.editReply({
          content:
            '❌ Failed to fetch server info.'
        });
      }

      return interaction.reply({

        content:
          '❌ Failed to fetch server info.',

        ephemeral: true
      });
    }
  }
};
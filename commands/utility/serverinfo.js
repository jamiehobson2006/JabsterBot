const {
  EmbedBuilder,
  SlashCommandBuilder,
  ChannelType
} = require('discord.js');

module.exports = {

  cooldown: 5000,

  data: new SlashCommandBuilder()

    .setName('serverinfo')

    .setDescription(
      'View detailed information about the server'
    ),

  async execute(interaction) {

    try {

      const guild =
        interaction.guild;

      if (!guild) {

        return interaction.editReply({

          content:
            '❌ Guild not found.'
        });
      }

      // ==========================================
      // 👑 OWNER
      // ==========================================
      let ownerText =
        'Unknown';

      try {

        const owner =
          await guild.fetchOwner();

        ownerText =
          `<@${owner.id}>`;

      } catch {}

      // ==========================================
      // 👥 MEMBERS
      // ==========================================
      const totalMembers =
        guild.memberCount || 0;

      const botCount =
        guild.members.cache.filter(
          m => m.user.bot
        ).size;

      const humanCount =
        Math.max(
          totalMembers - botCount,
          0
        );

      // ==========================================
      // 💬 CHANNELS
      // ==========================================
      const channels =
        guild.channels.cache;

      const textChannels =
        channels.filter(
          c =>
            c.type ===
            ChannelType.GuildText
        ).size;

      const voiceChannels =
        channels.filter(
          c =>
            c.type ===
            ChannelType.GuildVoice
        ).size;

      const categoryChannels =
        channels.filter(
          c =>
            c.type ===
            ChannelType.GuildCategory
        ).size;

      const stageChannels =
        channels.filter(
          c =>
            c.type ===
            ChannelType.GuildStageVoice
        ).size;

      const forumChannels =
        channels.filter(
          c =>
            c.type ===
            ChannelType.GuildForum
        ).size;

      // ==========================================
      // 🧵 THREADS
      // ==========================================
      const threadChannels =
        channels.filter(
          c =>

            c.type ===
              ChannelType.PublicThread ||

            c.type ===
              ChannelType.PrivateThread ||

            c.type ===
              ChannelType.AnnouncementThread
        ).size;

      // ==========================================
      // 🚀 BOOSTS
      // ==========================================
      const boostLevel =
        guild.premiumTier || 0;

      const boostCount =
        guild.premiumSubscriptionCount || 0;

      // ==========================================
      // 🎭 OTHER STATS
      // ==========================================
      const roleCount =
        guild.roles.cache.size || 0;

      const emojiCount =
        guild.emojis.cache.size || 0;

      const stickerCount =
        guild.stickers.cache.size || 0;

      // ==========================================
      // 🛡 FORMATTER
      // ==========================================
      function formatText(text) {

        if (!text) {

          return 'Unknown';
        }

        return String(text)

          .toLowerCase()

          .replace(/_/g, ' ')

          .replace(
            /\b\w/g,
            l => l.toUpperCase()
          );
      }

      // ==========================================
      // 🛡 SERVER SETTINGS
      // ==========================================
      const verification =
        formatText(
          guild.verificationLevel
        );

      const nsfw =
        formatText(
          guild.nsfwLevel
        );

      // ==========================================
      // ✨ FEATURES
      // ==========================================
      const featureList =
        guild.features || [];

      const features =
        featureList.length

          ? featureList

              .slice(0, 8)

              .map(f =>
                `• ${formatText(f)}`
              )

              .join('\n')

          : 'None';

      const remainingFeatures =
        Math.max(
          featureList.length - 8,
          0
        );

      // ==========================================
      // 🔗 VANITY URL
      // ==========================================
      let vanity =
        'None';

      try {

        if (
          guild.vanityURLCode
        ) {

          vanity =
            `https://discord.gg/${guild.vanityURLCode}`;
        }

      } catch {}

      // ==========================================
      // 📡 CHANNELS
      // ==========================================
      const systemChannel =
        guild.systemChannel

          ? `<#${guild.systemChannel.id}>`

          : 'None';

      const afkChannel =
        guild.afkChannel

          ? `<#${guild.afkChannel.id}>`

          : 'None';

      // ==========================================
      // 🖼 EMBED
      // ==========================================
      const embed =
        new EmbedBuilder()

          .setColor(0x5865F2)

          .setTitle(
            `📊 ${guild.name}`
          )

          .setDescription(

            `🌍 A community with **${totalMembers.toLocaleString()} members** ` +

            `across **${channels.size} channels**.`
          )

          .setThumbnail(
            guild.iconURL({

              dynamic: true,

              size: 512
            })
          )

          .addFields(

            {
              name: '👑 Owner',

              value: ownerText,

              inline: true
            },

            {
              name: '👥 Members',

              value:

                `🧑 Humans: ${humanCount.toLocaleString()}\n` +

                `🤖 Bots: ${botCount.toLocaleString()}\n` +

                `📦 Total: ${totalMembers.toLocaleString()}`,

              inline: true
            },

            {
              name: '🚀 Boost Status',

              value:

                `Level ${boostLevel}\n` +

                `${boostCount} Boosts`,

              inline: true
            },

            {
              name: '💬 Channels',

              value:

                `💬 Text: ${textChannels}\n` +

                `🔊 Voice: ${voiceChannels}\n` +

                `🎤 Stage: ${stageChannels}\n` +

                `🧵 Threads: ${threadChannels}\n` +

                `🗂 Categories: ${categoryChannels}\n` +

                `🗨 Forums: ${forumChannels}`,

              inline: true
            },

            {
              name: '🎭 Server Assets',

              value:

                `🎭 Roles: ${roleCount}\n` +

                `😄 Emojis: ${emojiCount}\n` +

                `🧩 Stickers: ${stickerCount}`,

              inline: true
            },

            {
              name: '🛡 Security',

              value:

                `Verification: ${verification}\n` +

                `NSFW Level: ${nsfw}`,

              inline: true
            },

            {
              name: '📡 System Channels',

              value:

                `📢 System: ${systemChannel}\n` +

                `🌙 AFK: ${afkChannel}`,

              inline: false
            },

            {
              name: '✨ Features',

              value:

                remainingFeatures > 0

                  ? `${features}\n• +${remainingFeatures} more`

                  : features,

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

                `<t:${Math.floor(
                  guild.createdTimestamp / 1000
                )}:F>\n` +

                `<t:${Math.floor(
                  guild.createdTimestamp / 1000
                )}:R>`,

              inline: false
            }
          )

          .setFooter({

            text:
              `Server ID: ${guild.id} • Requested by ${interaction.user.tag}`
          })

          .setTimestamp();

      // ==========================================
      // 🖼 OPTIONAL BANNER
      // ==========================================
      const banner =
        guild.bannerURL({

          size: 1024
        });

      if (banner) {

        embed.setImage(
          banner
        );
      }

      // ==========================================
      // ✅ RESPONSE
      // ==========================================
      return interaction.editReply({

        embeds: [embed]
      });

    } catch (err) {

      console.error(
        'ServerInfo Error:',
        err
      );

      return interaction.editReply({

        content:
          '❌ Failed to fetch server info.'
      });
    }
  }
};
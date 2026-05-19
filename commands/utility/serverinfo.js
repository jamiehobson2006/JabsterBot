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
      'View information about the server'
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
      let ownerTag = 'Unknown';

      try {

        const owner =
          await guild.fetchOwner();

        ownerTag =
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
        totalMembers - botCount;

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

      // ==========================================
      // 🎨 EMBED
      // ==========================================
      const embed =
        new EmbedBuilder()

          .setColor(0x5865F2)

          .setTitle(
            `📊 ${guild.name}`
          )

          .setThumbnail(
            guild.iconURL({
              dynamic: true
            })
          )

          .addFields(

            {
              name: '👑 Owner',

              value: ownerTag,

              inline: true
            },

            {
              name: '👥 Members',

              value:

                `🧑 Humans: ${humanCount}\n` +

                `🤖 Bots: ${botCount}\n` +

                `📦 Total: ${totalMembers}`,

              inline: true
            },

            {
              name: '💬 Channels',

              value:

                `💬 Text: ${textChannels}\n` +

                `🔊 Voice: ${voiceChannels}`,

              inline: true
            },

            {
              name: '📅 Created',

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

      return interaction.editReply({

        embeds: [embed]
      });

    } catch (err) {

      console.error(
        'SERVERINFO FULL ERROR:',
        err
      );

      return interaction.editReply({

        content:
          `❌ Error:\n\`\`\`${err.message}\`\`\``
      });
    }
  }
};
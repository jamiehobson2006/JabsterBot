const {
  PermissionsBitField,
  EmbedBuilder,
  SlashCommandBuilder
} = require('discord.js');

const { get, run } = require('../../database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('suggestaccept')
    .setDescription('Accept a suggestion')
    .addStringOption(option =>
      option
        .setName('message_id')
        .setDescription('Suggestion message ID')
        .setRequired(true)
    ),

  async execute(interaction) {
    try {
      // ✅ Ensure reply exists
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ ephemeral: true });
      }

      // 🔐 Permission
      if (!interaction.memberPermissions.has(PermissionsBitField.Flags.ManageGuild)) {
        return interaction.editReply({
          content: '❌ You need **Manage Server** permission.'
        });
      }

      const messageId = interaction.options.getString('message_id', true);

      // 🔍 Get suggestion
      const suggestion = await get(
        `SELECT * FROM suggestions WHERE guildId=? AND messageId=?`,
        [interaction.guild.id, messageId]
      );

      if (!suggestion) {
        return interaction.editReply({
          content: '❌ Suggestion not found.'
        });
      }

      // 🚫 Already handled
      if (suggestion.status !== 'PENDING') {
        return interaction.editReply({
          content: `❌ Already **${suggestion.status}**.`
        });
      }

      // 🔄 Get channel
      const settings = await get(
        `SELECT suggestionChannelId FROM guild_settings WHERE guildId=?`,
        [interaction.guild.id]
      );

      const channel = interaction.guild.channels.cache.get(settings?.suggestionChannelId);

      if (!channel || !channel.isTextBased()) {
        return interaction.editReply({
          content: '❌ Suggestion channel not found.'
        });
      }

      const perms = channel.permissionsFor(interaction.guild.members.me);
      if (!perms.has(['SendMessages', 'EmbedLinks'])) {
        return interaction.editReply({
          content: '❌ I cannot edit messages in the suggestion channel.'
        });
      }

      const msg = await channel.messages.fetch(messageId).catch(() => null);

      if (!msg) {
        return interaction.editReply({
          content: '❌ Suggestion message not found.'
        });
      }

      // ========================
      // 🎨 UPDATE EMBED
      // ========================
      let updatedEmbed;

      if (msg.embeds[0]) {
        updatedEmbed = EmbedBuilder.from(msg.embeds[0])
          .setColor(0x57F287)
          .setFooter({
            text: `✅ Accepted by ${interaction.user.tag}`
          });
      } else {
        updatedEmbed = new EmbedBuilder()
          .setColor(0x57F287)
          .setTitle('💡 Suggestion Accepted')
          .setDescription(suggestion.content)
          .setFooter({
            text: `Accepted by ${interaction.user.tag}`
          });
      }

      await msg.edit({
        embeds: [updatedEmbed],
        components: []
      });

      // ========================
      // 💾 UPDATE DATABASE
      // ========================
      await run(
        `UPDATE suggestions 
         SET status='ACCEPTED', moderatorId=? 
         WHERE messageId=?`,
        [interaction.user.id, messageId]
      );

      // ========================
      // ✅ RESPONSE
      // ========================
      await interaction.editReply({
        content: `✅ Suggestion accepted.\n🔗 ${msg.url}`
      });

    } catch (err) {
      console.error('Suggest Accept Error:', err);

      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({
          content: '❌ Failed to accept suggestion.'
        });
      } else {
        return interaction.reply({
          content: '❌ Failed to accept suggestion.',
          ephemeral: true
        });
      }
    }
  }
};
const {
  PermissionsBitField,
  EmbedBuilder,
  SlashCommandBuilder
} = require('discord.js');

const { get, run } = require('../../database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('suggestdeny')
    .setDescription('Deny a suggestion')
    .addStringOption(option =>
      option
        .setName('message_id')
        .setDescription('Suggestion message ID')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Reason for denying')
        .setMaxLength(300)
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
      const reason = interaction.options.getString('reason') || 'No reason provided';

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
          .setColor(0xED4245)
          .setFooter({
            text: `❌ Denied by ${interaction.user.tag}`
          })
          .addFields({
            name: 'Reason',
            value: reason
          });
      } else {
        updatedEmbed = new EmbedBuilder()
          .setTitle('💡 Suggestion Denied')
          .setColor(0xED4245)
          .setDescription(suggestion.content)
          .addFields({
            name: 'Reason',
            value: reason
          })
          .setFooter({
            text: `Denied by ${interaction.user.tag}`
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
         SET status='DENIED', moderatorId=?, reason=? 
         WHERE messageId=?`,
        [interaction.user.id, reason, messageId]
      );

      // ========================
      // ✅ RESPONSE
      // ========================
      await interaction.editReply({
        content: `❌ Suggestion denied.\n🔗 ${msg.url}`
      });

    } catch (err) {
      console.error('Suggest Deny Error:', err);

      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({
          content: '❌ Failed to deny suggestion.'
        });
      } else {
        return interaction.reply({
          content: '❌ Failed to deny suggestion.',
          ephemeral: true
        });
      }
    }
  }
};
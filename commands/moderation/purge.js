const {
  PermissionsBitField,
  EmbedBuilder,
  SlashCommandBuilder
} = require('discord.js');

const { sendLog, createLogEmbed } = require('../../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Delete multiple messages')

    .addIntegerOption(option =>
      option
        .setName('amount')
        .setDescription('Number of messages to delete (1-100)')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100)
    )

    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('Only delete messages from this user')
    )

    .addStringOption(option =>
      option
        .setName('type')
        .setDescription('Filter message type')
        .addChoices(
          { name: 'Humans', value: 'humans' },
          { name: 'Bots', value: 'bots' }
        )
    ),

  async execute(interaction) {
    try {

      // 🔐 User permission
      if (!interaction.memberPermissions.has(PermissionsBitField.Flags.ManageMessages)) {
        return interaction.editReply({
          content: '❌ You need **Manage Messages** permission.'
        });
      }

      const botMember = interaction.guild.members.me;

      // ❌ Bot permission
      if (!botMember.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
        return interaction.editReply({
          content: '❌ I do not have permission to delete messages.'
        });
      }

      const amount = interaction.options.getInteger('amount', true);
      const target = interaction.options.getUser('user');
      const type = interaction.options.getString('type');

      // 🚫 Prevent conflicting filters
      if (target && type) {
        return interaction.editReply({
          content: '❌ You cannot use both **user** and **type** filters together.'
        });
      }

      // 📥 Fetch ONLY what we need
      const messages = await interaction.channel.messages.fetch({ limit: amount });

      let filtered = messages;

      // 👤 Filter by user
      if (target) {
        filtered = filtered.filter(m => m.author.id === target.id);
      }

      // 🤖 Filter type
      if (type === 'bots') {
        filtered = filtered.filter(m => m.author.bot);
      }

      if (type === 'humans') {
        filtered = filtered.filter(m => !m.author.bot);
      }

      const toDelete = filtered.first(amount);

      if (!toDelete.length) {
        return interaction.editReply({
          content: '❌ No messages found matching your filter.'
        });
      }

      // 🧹 Delete
      const deleted = await interaction.channel.bulkDelete(toDelete, true);

      const deletedCount = deleted.size;
      const skipped = toDelete.length - deletedCount;

      if (!deletedCount) {
        return interaction.editReply({
          content: '❌ Messages may be older than 14 days.'
        });
      }

      // 🎨 Public feedback
      const embed = new EmbedBuilder()
        .setColor(0xE67E22)
        .setTitle('Messages Cleared')
        .setDescription(
          target
            ? `Deleted **${deletedCount} messages** from ${target}`
            : type === 'bots'
              ? `Deleted **${deletedCount} bot messages**`
              : type === 'humans'
                ? `Deleted **${deletedCount} human messages**`
                : `Deleted **${deletedCount} messages**`
        )
        .addFields(
          skipped > 0
            ? { name: 'Skipped', value: `${skipped} (older than 14 days)`, inline: true }
            : { name: '\u200b', value: '\u200b', inline: true }
        )
        .setFooter({ text: `By ${interaction.user.tag}` })
        .setTimestamp();

      const msg = await interaction.channel.send({ embeds: [embed] });

      // 🧹 Auto delete public log
      setTimeout(() => {
        msg.delete().catch(() => {});
      }, 5000);

      // ✅ Private confirmation
      await interaction.editReply({
        content: `✅ Deleted ${deletedCount} messages.${skipped ? ` (${skipped} skipped)` : ''}`
      });

      // 📜 Log system (your system 🔥)
      const logEmbed = createLogEmbed({
        action: 'PURGE',
        user: { id: 'CHANNEL', tag: interaction.channel.name },
        moderator: interaction.user,
        reason: `Deleted ${deletedCount} messages`,
        caseId: null
      });

      await sendLog(interaction.client, interaction.guild.id, logEmbed);

    } catch (err) {
      console.error('Purge Error:', err);

      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({
          content: '❌ Failed to purge messages.'
        });
      } else {
        return interaction.reply({
          content: '❌ Failed to purge messages.',
          flags: 64
        });
      }
    }
  }
};
const {
  PermissionsBitField,
  EmbedBuilder,
  SlashCommandBuilder
} = require('discord.js');

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
      // ✅ Defer
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ ephemeral: true });
      }

      // 🔐 Permission
      if (!interaction.memberPermissions.has(PermissionsBitField.Flags.ManageMessages)) {
        return interaction.editReply({
          content: '❌ You need **Manage Messages** permission.'
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

      // 📥 Fetch messages (always max 100 for filtering)
      const messages = await interaction.channel.messages.fetch({ limit: 100 });

      let filtered = messages;

      // 👤 Filter by user
      if (target) {
        filtered = filtered.filter(m => m.author.id === target.id);
      }

      // 🤖 Filter by type
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

      if (!deleted.size) {
        return interaction.editReply({
          content: '❌ Messages may be older than 14 days.'
        });
      }

      // 🎨 Public message
      const embed = new EmbedBuilder()
        .setColor(0xE67E22)
        .setTitle('Messages Cleared')
        .setDescription(
          target
            ? `Deleted **${deleted.size} messages** from ${target}`
            : type === 'bots'
              ? `Deleted **${deleted.size} bot messages**`
              : type === 'humans'
                ? `Deleted **${deleted.size} human messages**`
                : `Deleted **${deleted.size} messages**`
        )
        .setFooter({ text: `By ${interaction.user.tag}` })
        .setTimestamp();

      const msg = await interaction.channel.send({ embeds: [embed] });

      // 🧹 Auto delete log message after 5s
      setTimeout(() => {
        msg.delete().catch(() => {});
      }, 5000);

      // ✅ Private confirmation
      await interaction.editReply({
        content: `✅ Deleted ${deleted.size} messages.`
      });

    } catch (err) {
      console.error('Purge Error:', err);

      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({
          content: '❌ Failed to purge messages.'
        });
      } else {
        return interaction.reply({
          content: '❌ Failed to purge messages.',
          ephemeral: true
        });
      }
    }
  }
};
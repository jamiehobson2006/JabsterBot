const {
  EmbedBuilder,
  SlashCommandBuilder
} = require('discord.js');

// 💘 Deterministic + ORDER-INDEPENDENT
function getCompatibility(id1, id2) {
  const [a, b] = [id1, id2].sort(); // 🔥 ensures same result both ways
  const combined = a + b;

  let hash = 0;

  for (let i = 0; i < combined.length; i++) {
    hash = combined.charCodeAt(i) + ((hash << 5) - hash);
  }

  return Math.abs(hash % 101);
}

// 🎯 Reaction tiers
function getTier(percent) {
  if (percent >= 90) return { text: '💞 Soulmates!', color: 0xED4245 };
  if (percent >= 75) return { text: '💖 Perfect Match!', color: 0xFF73FA };
  if (percent >= 60) return { text: '💕 Strong Connection!', color: 0xF47FFF };
  if (percent >= 40) return { text: '😐 Could work...', color: 0x95A5A6 };
  if (percent >= 20) return { text: '💀 Not looking good...', color: 0x576574 };
  return { text: '🚫 Disaster.', color: 0x2C2F33 };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ship')
    .setDescription('Check compatibility between two users')
    .addUserOption(option =>
      option
        .setName('user1')
        .setDescription('First user')
        .setRequired(true)
    )
    .addUserOption(option =>
      option
        .setName('user2')
        .setDescription('Second user')
        .setRequired(true)
    ),

  async execute(interaction) {
    try {
      // ✅ Ensure reply exists
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply();
      }

      const user1 = interaction.options.getUser('user1', true);
      const user2 = interaction.options.getUser('user2', true);

      // ❌ Same user
      if (user1.id === user2.id) {
        return interaction.editReply({
          content: '💀 You can’t ship someone with themselves... or can you?'
        });
      }

      // 🤖 Bots
      if (user1.bot || user2.bot) {
        return interaction.editReply({
          content: '🤖 Bots don’t do relationships... yet.'
        });
      }

      // 💘 Compatibility
      const percent = getCompatibility(user1.id, user2.id);
      const tier = getTier(percent);

      const embed = new EmbedBuilder()
        .setColor(tier.color)
        .setTitle('💘 Ship Result')
        .setDescription(
          `${user1} ❤️ ${user2}\n\n` +
          `💖 **Compatibility:** \`${percent}%\`\n` +
          `💬 **Status:** ${tier.text}`
        )
        .setFooter({ text: 'Love is unpredictable... or is it?' })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });

    } catch (err) {
      console.error('Ship Command Error:', err);

      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({
          content: '❌ Shipping failed.'
        });
      } else {
        return interaction.reply({
          content: '❌ Shipping failed.',
          ephemeral: true
        });
      }
    }
  }
};
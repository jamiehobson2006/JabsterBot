const {
  PermissionsBitField,
  EmbedBuilder,
  SlashCommandBuilder,
  ChannelType
} = require('discord.js');

const { sendLog, createLogEmbed } = require('../../utils/logger');

// ⏱ Format time nicely
function formatTime(seconds) {
  if (seconds === 0) return 'Disabled';

  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  let parts = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s) parts.push(`${s}s`);

  return parts.join(' ');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('slowmode')
    .setDescription('Set slowmode for this channel')
    .addIntegerOption(option =>
      option
        .setName('seconds')
        .setDescription('0 = disable, max 21600 (6 hours)')
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(21600)
    ),

  async execute(interaction) {
    try {

      // 🔐 User permission
      if (!interaction.memberPermissions.has(PermissionsBitField.Flags.ManageChannels)) {
        return interaction.editReply({
          content: '❌ You need **Manage Channels** permission.'
        });
      }

      const channel = interaction.channel;
      const botMember = interaction.guild.members.me;

      // ❌ Bot permission
      if (!botMember.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
        return interaction.editReply({
          content: '❌ I do not have permission to manage channels.'
        });
      }

      // 🚫 Only allow proper text channels
      if (!channel || channel.type !== ChannelType.GuildText) {
        return interaction.editReply({
          content: '❌ This command can only be used in standard text channels.'
        });
      }

      const seconds = interaction.options.getInteger('seconds', true);

      // ⚠️ No change check
      if (channel.rateLimitPerUser === seconds) {
        return interaction.editReply({
          content: `⚠️ Slowmode is already set to **${formatTime(seconds)}**.`
        });
      }

      // 🔧 Apply slowmode
      await channel.setRateLimitPerUser(seconds).catch(() => {
        throw new Error('Failed to set slowmode');
      });

      const formatted = formatTime(seconds);

      // 🎨 Embed
      const embed = new EmbedBuilder()
        .setTitle(seconds === 0 ? 'Slowmode Disabled' : 'Slowmode Enabled')
        .setColor(seconds === 0 ? 0x57F287 : 0xE67E22)
        .setDescription(
          seconds === 0
            ? 'Slowmode has been removed from this channel.'
            : `Slowmode set to **${formatted}** (${seconds}s)`
        )
        .setFooter({ text: `By ${interaction.user.tag}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

      // 📜 Log
      const log = createLogEmbed({
        action: 'SLOWMODE',
        user: { id: 'CHANNEL', tag: channel.name },
        moderator: interaction.user,
        reason: seconds === 0
          ? 'Disabled slowmode'
          : `Set to ${formatted} (${seconds}s)`
      });

      await sendLog(interaction.client, interaction.guild.id, log);

    } catch (err) {
      console.error('Slowmode Error:', err);

      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({
          content: '❌ Failed to set slowmode. Check my permissions.'
        });
      } else {
        return interaction.reply({
          content: '❌ Failed to set slowmode.',
          ephemeral: true
        });
      }
    }
  }
};
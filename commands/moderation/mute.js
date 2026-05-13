const {
  PermissionsBitField,
  EmbedBuilder,
  SlashCommandBuilder
} = require('discord.js');

const { run } = require('../../database');
const { sendLog, createLogEmbed } = require('../../utils/logger');

// ⏱ Parse duration (supports 1h30m etc.)
function parseDuration(input) {
  const regex = /(\d+)(s|m|h|d)/g;
  let match;
  let total = 0;

  const multipliers = {
    s: 1000,
    m: 60000,
    h: 3600000,
    d: 86400000
  };

  while ((match = regex.exec(input)) !== null) {
    const value = parseInt(match[1]);
    const unit = match[2];
    total += value * multipliers[unit];
  }

  return total || null;
}

// ⏱ Pretty format
function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);

  if (d > 0) return `${d}d`;
  if (h > 0) return `${h}h`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Timeout (mute) a user')
    .addUserOption(option =>
      option.setName('user').setDescription('User to mute').setRequired(true)
    )
    .addStringOption(option =>
      option.setName('duration').setDescription('e.g. 10m, 1h, 1h30m').setRequired(true)
    )
    .addStringOption(option =>
      option.setName('reason').setDescription('Reason').setMaxLength(300)
    ),

  async execute(interaction) {
    try {

      // 🔐 User permission
      if (!interaction.memberPermissions.has(PermissionsBitField.Flags.ModerateMembers)) {
        return interaction.editReply({
          content: '❌ You need **Moderate Members** permission.'
        });
      }

      const botMember = interaction.guild.members.me;

      // ❌ Bot permission check
      if (!botMember.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
        return interaction.editReply({
          content: '❌ I do not have permission to timeout members.'
        });
      }

      const user = interaction.options.getUser('user', true);
      const durationInput = interaction.options.getString('duration', true);
      const reason = interaction.options.getString('reason') || 'No reason provided';

      const duration = parseDuration(durationInput);

      if (!duration) {
        return interaction.editReply({
          content: '❌ Invalid duration. Use `10m`, `1h`, `1h30m`.'
        });
      }

      const max = 28 * 24 * 60 * 60 * 1000;
      if (duration > max) {
        return interaction.editReply({
          content: '❌ Maximum timeout is **28 days**.'
        });
      }

      // 🚫 Checks
      if (user.id === interaction.user.id)
        return interaction.editReply({ content: '❌ You cannot mute yourself.' });

      if (user.id === interaction.client.user.id)
        return interaction.editReply({ content: '❌ You cannot mute the bot.' });

      if (user.id === interaction.guild.ownerId)
        return interaction.editReply({ content: '❌ You cannot mute the server owner.' });

      const member = await interaction.guild.members.fetch(user.id).catch(() => null);

      if (!member)
        return interaction.editReply({ content: '❌ User not found.' });

      // 🔼 Hierarchy
      if (member.roles.highest.position >= interaction.member.roles.highest.position) {
        return interaction.editReply({
          content: '❌ You cannot mute this user (role hierarchy).'
        });
      }

      if (!member.moderatable) {
        return interaction.editReply({
          content: '❌ I cannot mute this user.'
        });
      }

      // ⚠️ Already muted check
      if (member.communicationDisabledUntilTimestamp > Date.now()) {
        return interaction.editReply({
          content: '⚠️ This user is already muted.'
        });
      }

      // 🔇 Apply timeout
      await member.timeout(duration, `${reason} | By ${interaction.user.tag}`);

      const pretty = formatDuration(duration);

      // 📩 DM (optional)
      try {
        await user.send({
          embeds: [
            new EmbedBuilder()
              .setColor(0xED4245)
              .setTitle(`You were muted in ${interaction.guild.name}`)
              .setDescription(`Reason: ${reason}\nDuration: ${pretty}`)
          ]
        });
      } catch {}

      // 📁 Case
      const result = await run(
        `INSERT INTO cases (guildId, userId, moderatorId, action, reason, timestamp)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          interaction.guild.id,
          user.id,
          interaction.user.id,
          'MUTE',
          `${reason} | ${pretty}`,
          Date.now()
        ]
      );

      const caseId = result?.lastInsertRowid ?? 'N/A';

      // ✅ Response
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xED4245)
            .setTitle('User Muted')
            .setDescription(`🔇 **${user.tag}** has been muted`)
            .addFields(
              { name: 'Duration', value: pretty, inline: true },
              { name: 'Case', value: `#${caseId}`, inline: true }
            )
        ]
      });

      // 📜 Log
      const logEmbed = createLogEmbed({
        action: 'MUTE',
        user,
        moderator: interaction.user,
        reason: `${reason}\nDuration: ${pretty}`,
        caseId
      });

      await sendLog(interaction.client, interaction.guild.id, logEmbed);

    } catch (err) {
      console.error('Mute Error:', err);

      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({
          content: '❌ Failed to execute mute.'
        });
      } else {
        return interaction.reply({
          content: '❌ Failed to execute mute.',
          flags: 64
        });
      }
    }
  }
};
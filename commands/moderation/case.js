const {
  EmbedBuilder,
  PermissionsBitField,
  SlashCommandBuilder
} = require('discord.js');

const { get } = require('../../database');

// 🎨 Style helper
function getStyle(action) {

  const a = action.toUpperCase();

  if (a.includes('UNBAN')) {
    return { color: 0x57F287, icon: '🔓', label: 'Unban' };
  }

  if (a.includes('BAN')) {
    return { color: 0x8B0000, icon: '🔨', label: 'Ban' };
  }

  if (a.includes('KICK')) {
    return { color: 0xED4245, icon: '👢', label: 'Kick' };
  }

  // 🔥 MUST BE BEFORE MUTE
  if (a.includes('UNMUTE')) {
    return { color: 0x57F287, icon: '🔊', label: 'Unmute' };
  }

  if (a.includes('MUTE')) {
    return { color: 0xE67E22, icon: '🔇', label: 'Mute' };
  }

  if (a.includes('WARN')) {
    return { color: 0xF1C40F, icon: '⚠️', label: 'Warn' };
  }

  if (a.includes('CLEAR')) {
    return { color: 0x95A5A6, icon: '🧹', label: 'Clear' };
  }

  return {
    color: 0x5865F2,
    icon: '📄',
    label: action
  };
}

// 🧠 Safe user
function safeUser(id) {

  if (!id) return '`Unknown`';

  return `<@${id}> (\`${id}\`)`;
}

// 🧠 Safe text
function trim(text, max = 1000) {

  if (!text) return 'No reason provided';

  return text.length > max
    ? text.slice(0, max) + '...'
    : text;
}

module.exports = {

  cooldown: 2000,

  data: new SlashCommandBuilder()
    .setName('case')
    .setDescription('View a moderation case')

    .addIntegerOption(option =>
      option
        .setName('case_id')
        .setDescription('Case ID')
        .setRequired(true)
        .setMinValue(1)
    ),

  async execute(interaction) {

    try {

      const caseId =
        interaction.options.getInteger('case_id', true);

      // 🔐 Permission
      if (!interaction.memberPermissions.has(
        PermissionsBitField.Flags.ManageGuild
      )) {

        return interaction.editReply({
          content:
            '❌ You need **Manage Server** permission.'
        });
      }

      // 📄 Fetch case
      const c = get(

        `SELECT * FROM cases
         WHERE guildId=? AND id=?`,

        [interaction.guild.id, caseId]
      );

      if (!c) {

        return interaction.editReply({
          content: '❌ Case not found.'
        });
      }

      const {
        color,
        icon,
        label
      } = getStyle(c.action);

      const fields = [

        {
          name: '👤 User',
          value: safeUser(c.userId),
          inline: true
        },

        {
          name: '🛡 Moderator',
          value: safeUser(c.moderatorId),
          inline: true
        },

        {
          name: '📌 Action',
          value: `\`${c.action}\``,
          inline: true
        },

        {
          name: '📄 Reason',
          value: trim(c.reason)
        },

        {
          name: '🕒 Date',
          value:
            `<t:${Math.floor(
              (c.createdAt || Date.now()) / 1000
            )}:F>`
        }
      ];

      // ⏱ Duration support
      if (c.duration) {

        fields.push({
          name: '⏱ Duration',
          value: `${c.duration}`,
          inline: true
        });
      }

      const embed = new EmbedBuilder()

        .setColor(color)

        .setTitle(`${icon} Case #${c.id}`)

        .setDescription(
          `**${label} Action Record**`
        )

        .addFields(fields)

        .setFooter({
          text:
            `Case ID: ${c.id} • Guild: ${interaction.guild.id}`
        })

        .setTimestamp();

      return interaction.editReply({
        embeds: [embed]
      });

    } catch (err) {

      console.error('Case Command Error:', err);

      if (interaction.deferred || interaction.replied) {

        return interaction.editReply({
          content: '❌ Failed to fetch case.'
        });
      }

      return interaction.reply({
        content: '❌ Failed to fetch case.',
        ephemeral: true
      });
    }
  }
};
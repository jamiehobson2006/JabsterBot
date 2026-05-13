const { 
  PermissionsBitField, 
  EmbedBuilder, 
  SlashCommandBuilder,
  ChannelType
} = require('discord.js');

const { sendLog, createLogEmbed } = require('../../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lock')
    .setDescription('Lock the current channel')
    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Reason for locking the channel')
        .setMaxLength(200)
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
      const reason = interaction.options.getString('reason') || 'No reason provided';
      const botMember = interaction.guild.members.me;

      // ❌ Channel type safety
      if (!channel || channel.type !== ChannelType.GuildText) {
        return interaction.editReply({
          content: '❌ You can only lock **text channels**.'
        });
      }

      // ❌ Bot permission check
      const perms = channel.permissionsFor(botMember);
      if (!perms.has(PermissionsBitField.Flags.ManageChannels)) {
        return interaction.editReply({
          content: '❌ I do not have permission to manage this channel.'
        });
      }

      const everyoneRole = interaction.guild.roles.everyone;

      const overwrite = channel.permissionOverwrites.cache.get(everyoneRole.id);

      const alreadyLocked = overwrite?.deny.has(PermissionsBitField.Flags.SendMessages);

      if (alreadyLocked) {
        return interaction.editReply({
          content: '⚠️ This channel is already locked.'
        });
      }

      // 🔒 Lock channel
      await channel.permissionOverwrites.edit(everyoneRole, {
        SendMessages: false
      });

      // 📢 Public message in channel
      await channel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0xED4245)
            .setTitle('🔒 Channel Locked')
            .setDescription(`**Reason:** ${reason}`)
            .setFooter({ text: `Locked by ${interaction.user.tag}` })
            .setTimestamp()
        ]
      });

      // ✅ Private confirmation
      await interaction.editReply({
        content: '✅ Channel locked successfully.'
      });

      // 📜 Log
      const logEmbed = createLogEmbed({
        action: 'LOCK',
        user: { id: 'CHANNEL', tag: channel.name },
        moderator: interaction.user,
        reason,
        caseId: null
      });

      await sendLog(interaction.client, interaction.guild.id, logEmbed);

    } catch (err) {
      console.error('Lock Command Error:', err);

      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({
          content: '❌ Failed to lock channel.'
        });
      } else {
        return interaction.reply({
          content: '❌ Failed to lock channel.',
          flags: 64
        });
      }
    }
  }
};
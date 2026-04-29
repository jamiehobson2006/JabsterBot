const {
  EmbedBuilder,
  SlashCommandBuilder
} = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('poll')
    .setDescription('Create a simple yes/no poll')
    .addStringOption(option =>
      option
        .setName('question')
        .setDescription('Poll question')
        .setRequired(true)
        .setMaxLength(300)
    ),

  async execute(interaction) {
    try {
      // ✅ Ensure reply exists
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ ephemeral: true });
      }

      const question = interaction.options.getString('question', true);
      const channel = interaction.channel;

      // 🔐 Bot permission check
      const perms = channel.permissionsFor(interaction.guild.members.me);

      if (!perms.has(['SendMessages', 'EmbedLinks', 'AddReactions'])) {
        return interaction.editReply({
          content: '❌ I am missing permissions in this channel.'
        });
      }

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('📊 New Poll')
        .setDescription(`**${question}**`)
        .addFields({
          name: 'Options',
          value: '👍 Yes\n👎 No'
        })
        .setFooter({ text: `Poll by ${interaction.user.tag}` })
        .setTimestamp();

      const msg = await channel.send({
        embeds: [embed]
      });

      // 👍 Reactions
      await msg.react('👍');
      await msg.react('👎');

      // ✅ Confirmation (auto-delete)
      const reply = await interaction.editReply({
        content: '✅ Poll created.'
      });

      setTimeout(() => {
        reply.delete().catch(() => {});
      }, 3000);

    } catch (err) {
      console.error('Poll Error:', err);

      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({
          content: '❌ Failed to create poll.'
        });
      } else {
        return interaction.reply({
          content: '❌ Failed to create poll.',
          ephemeral: true
        });
      }
    }
  }
};
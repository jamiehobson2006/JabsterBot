const {
  EmbedBuilder,
  SlashCommandBuilder,
  PermissionsBitField
} = require('discord.js');

const EMOJIS = ['🇦', '🇧', '🇨', '🇩', '🇪'];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('poll')
    .setDescription('Create a custom poll (2–5 options)')

    .addStringOption(option =>
      option
        .setName('question')
        .setDescription('Poll question')
        .setRequired(true)
        .setMaxLength(300)
    )

    .addStringOption(option =>
      option.setName('option1').setDescription('Option 1').setRequired(true)
    )
    .addStringOption(option =>
      option.setName('option2').setDescription('Option 2').setRequired(true)
    )
    .addStringOption(option =>
      option.setName('option3').setDescription('Option 3').setRequired(false)
    )
    .addStringOption(option =>
      option.setName('option4').setDescription('Option 4').setRequired(false)
    )
    .addStringOption(option =>
      option.setName('option5').setDescription('Option 5').setRequired(false)
    )

    .addRoleOption(option =>
      option
        .setName('ping_role')
        .setDescription('Role to ping (Admin only)')
        .setRequired(false)
    ),

  async execute(interaction) {
    try {

      const question = interaction.options.getString('question', true);

      // Collect options
      const options = [
        interaction.options.getString('option1'),
        interaction.options.getString('option2'),
        interaction.options.getString('option3'),
        interaction.options.getString('option4'),
        interaction.options.getString('option5')
      ].filter(Boolean);

      if (options.length < 2) {
        return interaction.editReply({
          content: '❌ You need at least 2 options.'
        });
      }

      const role = interaction.options.getRole('ping_role');

      // 🔐 Role ping restriction
      if (role && !interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.editReply({
          content: '❌ Only administrators can ping roles in polls.'
        });
      }

      const channel = interaction.channel;
      const perms = channel.permissionsFor(interaction.guild.members.me);

      if (!perms.has([
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.EmbedLinks,
        PermissionsBitField.Flags.AddReactions
      ])) {
        return interaction.editReply({
          content: '❌ I am missing permissions in this channel.'
        });
      }

      // Build options text
      const optionText = options
        .map((opt, i) => `${EMOJIS[i]} ${opt}`)
        .join('\n');

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('📊 New Poll')
        .setDescription(`**${question}**\n\n${optionText}`)
        .setFooter({ text: `Poll by ${interaction.user.tag}` })
        .setTimestamp();

      const content = role ? `${role}` : null;

      const msg = await channel.send({
        content,
        embeds: [embed]
      });

      // Add reactions
      for (let i = 0; i < options.length; i++) {
        await msg.react(EMOJIS[i]);
      }

      await interaction.editReply({
        content: '✅ Poll created.'
      });

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
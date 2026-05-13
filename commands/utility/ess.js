const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder
} = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ess')
    .setDescription('Show Endless Summer Simulator info'),

  async execute(interaction) {
    try {

      const embed = new EmbedBuilder()
        .setColor(0xE67E22)
        .setTitle('🌴 Endless Summer Simulator')
        .setDescription(
          '**The ultimate summer grind experience.**\n\n' +
          '🌊 Collect glowing orbs across the map\n' +
          '⚡ Build insane combo streaks\n' +
          '💰 Earn coins and upgrade your power\n' +
          '🔥 Trigger crazy world events\n\n' +
          '**Jump in and start your grind.**'
        )
        .addFields(
          {
            name: '🎮 Features',
            value:
              '• Combo System\n' +
              '• Orb Rarities\n' +
              '• World Events\n' +
              '• Upgrades & Progression',
            inline: true
          },
          {
            name: '🚀 Why Play?',
            value:
              '• Addictive gameplay loop\n' +
              '• Satisfying visuals\n' +
              '• Constant progression\n' +
              '• Chill + competitive',
            inline: true
          }
        )
        .setFooter({ text: 'JabsterStudios • Endless Summer Simulator' })
        .setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('Play Now')
          .setEmoji('🌴')
          .setStyle(ButtonStyle.Link)
          .setURL('https://www.roblox.com/games/130906696817438/Endless-Summer-Simulator'),

        new ButtonBuilder()
          .setLabel('Community')
          .setEmoji('👥')
          .setStyle(ButtonStyle.Link)
          .setURL('https://www.roblox.com/communities/11716549/JabsterStudios#!/about')
      );

      await interaction.editReply({
        embeds: [embed],
        components: [row]
      });

    } catch (err) {
      console.error('ESS Command Error:', err);

      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({
          content: '❌ Failed to load game info.'
        });
      } else {
        return interaction.reply({
          content: '❌ Failed to load game info.',
          ephemeral: true
        });
      }
    }
  }
};
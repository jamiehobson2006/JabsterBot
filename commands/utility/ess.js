const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  SlashCommandBuilder
} = require('discord.js');

const GAME_URL =
  'https://www.roblox.com/games/130906696817438/Endless-Summer-Simulator';

const COMMUNITY_URL =
  'https://www.roblox.com/communities/11716549/JabsterStudios#!/about';

const GAME_IMAGE =
  'https://tr.rbxcdn.com/180DAY-c1db2679dce8dbec7a0f9b84d7dbb3f0/768/432/Image/Webp/noFilter';

module.exports = {
  cooldown: 5000,

  data: new SlashCommandBuilder()
    .setName('ess')
    .setDescription('Show Endless Summer Simulator info'),

  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setColor(0x00A8A8)
      .setTitle('\u{1F334} Endless Summer Simulator')
      .setDescription(
        '**Build huge combos, explore paradise, and keep progressing your way.**\n\n' +
        'Collect orbs, improve your build, discover new areas, complete quests, and join live world events.'
      )
      .addFields(
        {
          name: '\u{2728} Now Available',
          value:
            '- Underwater World\n' +
            '- Expanded Quest System\n' +
            '- New Progression Features\n' +
            '- More World Events',
          inline: true
        },
        {
          name: '\u{1F525} Core Gameplay',
          value:
            '- Combo streaks\n' +
            '- Prestige bonuses\n' +
            '- Upgrades and orb rarities\n' +
            '- Global leaderboards',
          inline: true
        },
        {
          name: '\u{1F30A} Your Summer, Your Progress',
          value:
            'Start on the islands, push your earnings higher, and see how far your progression can go.'
        }
      )
      .setImage(GAME_IMAGE)
      .setThumbnail(GAME_IMAGE)
      .setFooter({ text: 'Jabster Studios | Endless Summer Simulator' })
      .setTimestamp();

    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setLabel('Play Now')
          .setEmoji('\u{1F334}')
          .setStyle(ButtonStyle.Link)
          .setURL(GAME_URL),
        new ButtonBuilder()
          .setLabel('Join Community')
          .setEmoji('\u{1F465}')
          .setStyle(ButtonStyle.Link)
          .setURL(COMMUNITY_URL),
        new ButtonBuilder()
          .setLabel('Favorite Game')
          .setEmoji('\u{2B50}')
          .setStyle(ButtonStyle.Link)
          .setURL(GAME_URL)
      );

    return interaction.editReply({
      embeds: [embed],
      components: [row]
    });
  }
};

const {
    EmbedBuilder,
    SlashCommandBuilder
} = require('discord.js');

module.exports = {

    cooldown: 2000,

    data: new SlashCommandBuilder()
        .setName('coinflip')
        .setDescription('Flip a coin')
        .addStringOption(option =>
            option
                .setName('guess')
                .setDescription(
                    'Choose heads or tails (optional)'
                )
                .addChoices(
                    {
                        name: 'Heads',
                        value: 'heads'
                    },
                    {
                        name: 'Tails',
                        value: 'tails'
                    }
                )
        ),

    async execute(interaction) {

        try {

            const guess =
                interaction.options.getString(
                    'guess'
                );

            // ==========================================
            // 🪙 FLIPPING ANIMATION
            // ==========================================
            await interaction.editReply({

                embeds: [

                    new EmbedBuilder()

                        .setColor(0x5865F2)

                        .setTitle(
                            '🪙 Coin Flip'
                        )

                        .setDescription(
                            '🔄 Flipping the coin...'
                        )
                ]
            });

            await new Promise(resolve =>
                setTimeout(resolve, 1200)
            );

            // ==========================================
            // 🎲 RESULT
            // ==========================================
            let result;

            const edgeChance =
                Math.random();

            if (edgeChance < 0.005) {

                result = 'edge';

            } else {

                result =
                    Math.random() < 0.5
                        ? 'heads'
                        : 'tails';
            }

            // ==========================================
            // 🎨 RESULT DATA
            // ==========================================
            let color = 0xFEE75C;
            let resultEmoji = '🪙';
            let statusText;

            if (result === 'edge') {

                color = 0x9B59B6;

                resultEmoji = '✨';

                statusText =
                    '🌟 The coin somehow landed on its edge. Incredible!';

            } else if (guess) {

                const won =
                    guess === result;

                if (won) {

                    color = 0x57F287;

                    statusText =
                        `🎉 You guessed **${guess}** and got it right!`;

                } else {

                    color = 0xED4245;

                    statusText =
                        `💀 You guessed **${guess}** but it landed on **${result}**.`;
                }

                resultEmoji =
                    result === 'heads'
                        ? '👑'
                        : '🪙';

            } else {

                resultEmoji =
                    result === 'heads'
                        ? '👑'
                        : '🪙';

                statusText =
                    `The coin landed on **${result.toUpperCase()}**.`;
            }

            // ==========================================
            // 🎨 EMBED
            // ==========================================
            const embed =
                new EmbedBuilder()

                    .setColor(color)

                    .setTitle(
                        '🪙 Coin Flip'
                    )

                    .setDescription(

                        `# ${resultEmoji} ${result.toUpperCase()}\n\n` +

                        '━━━━━━━━━━━━━━\n\n' +

                        `${statusText}`
                    )

                    .addFields(
                        {
                            name: '🎲 Result',
                            value:
                                result.toUpperCase(),
                            inline: true
                        },
                        {
                            name: '🎯 Guess',
                            value:
                                guess
                                    ? guess.toUpperCase()
                                    : 'None',
                            inline: true
                        }
                    )

                    .setFooter({
                        text:
                            'Heads or tails?'
                    })

                    .setTimestamp();

            return interaction.editReply({

                embeds: [embed]
            });

        } catch (err) {

            console.error(
                'Coinflip Error:',
                err
            );

            if (
                interaction.deferred ||
                interaction.replied
            ) {

                return interaction.editReply({

                    content:
                        '❌ Coinflip failed.'
                });
            }

            return interaction.reply({

                content:
                    '❌ Coinflip failed.',

                flags: 64
            });
        }
    }
};
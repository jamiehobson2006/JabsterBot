const {
    EmbedBuilder,
    SlashCommandBuilder
} = require('discord.js');

// ==================================================
// 💘 LOADING MESSAGES
// ==================================================
const loadingMessages = [
    '💘 Consulting Cupid...',
    '🏹 Firing love arrows...',
    '❤️ Reading relationship charts...',
    '✨ Checking destiny...',
    '🔮 Analyzing romantic energy...',
    '💞 Calculating compatibility...'
];

// ==================================================
// 💬 SPECIAL MESSAGES
// ==================================================
const soulmateMessages = [
    '✨ The stars have aligned.',
    '👑 A legendary pairing has been discovered.',
    '🌌 Fate itself approves.',
    '💘 Written in the stars.',
    '❤️ This pairing is magical.'
];

// ==================================================
// 💘 COMPATIBILITY
// ==================================================
function getCompatibility(id1, id2) {

    const [a, b] =
        [id1, id2].sort();

    const combined =
        a + b;

    let hash = 0;

    for (
        let i = 0;
        i < combined.length;
        i++
    ) {

        hash =
            combined.charCodeAt(i) +
            ((hash << 5) - hash);
    }

    const raw =
        Math.abs(hash % 101);

    return Math.floor(
        Math.pow(
            raw / 100,
            0.75
        ) * 100
    );
}

// ==================================================
// 🎯 TIERS
// ==================================================
function getTier(percent) {

    if (percent === 100) {

        return {
            text: '👑 Destined Soulmates',
            color: 0xFF4D6D
        };
    }

    if (percent >= 95) {

        return {
            text: '💞 Soulmates!',
            color: 0xED4245
        };
    }

    if (percent >= 75) {

        return {
            text: '💖 Perfect Match!',
            color: 0xFF73FA
        };
    }

    if (percent >= 60) {

        return {
            text: '💕 Strong Connection!',
            color: 0xF47FFF
        };
    }

    if (percent >= 40) {

        return {
            text: '😐 Could Work...',
            color: 0x95A5A6
        };
    }

    if (percent >= 20) {

        return {
            text: '💀 Not Looking Good...',
            color: 0x576574
        };
    }

    return {
        text: '🚫 Absolute Disaster.',
        color: 0x2C2F33
    };
}

// ==================================================
// ❤️ BAR
// ==================================================
function createBar(percent) {

    const total = 10;

    const filled =
        Math.round(
            (percent / 100) * total
        );

    const empty =
        total - filled;

    return (
        '❤️'.repeat(filled) +
        '🖤'.repeat(empty)
    );
}

// ==================================================
// 🏷 SHIP NAME
// ==================================================
function createShipName(name1, name2) {

    const first =
        name1.slice(
            0,
            Math.max(
                2,
                Math.floor(
                    name1.length / 2
                )
            )
        );

    const second =
        name2.slice(
            Math.floor(
                name2.length / 2
            )
        );

    return first + second;
}

module.exports = {

    cooldown: 3000,

    data:
        new SlashCommandBuilder()

            .setName('ship')

            .setDescription(
                'Check compatibility between two users'
            )

            .addUserOption(option =>

                option

                    .setName('user1')

                    .setDescription(
                        'First user'
                    )

                    .setRequired(true)
            )

            .addUserOption(option =>

                option

                    .setName('user2')

                    .setDescription(
                        'Second user'
                    )

                    .setRequired(true)
            ),

    async execute(interaction) {

        try {

            const user1 =
                interaction.options.getUser(
                    'user1',
                    true
                );

            const user2 =
                interaction.options.getUser(
                    'user2',
                    true
                );

            if (user1.id === user2.id) {

                return interaction.editReply({

                    content:
                        '💀 You can’t ship someone with themselves... or can you?'
                });
            }

            if (
                user1.bot ||
                user2.bot
            ) {

                return interaction.editReply({

                    content:
                        '🤖 Bots don’t do relationships... yet.'
                });
            }

            await interaction.editReply({

                content:
                    loadingMessages[
                        Math.floor(
                            Math.random() *
                            loadingMessages.length
                        )
                    ]
            });

            await new Promise(resolve =>
                setTimeout(resolve, 1000)
            );

            // ==========================================
            // 💥 CHAOS EVENT
            // ==========================================
            if (Math.random() < 0.005) {

                return interaction.editReply({

                    embeds: [

                        new EmbedBuilder()

                            .setColor(0x9B59B6)

                            .setTitle(
                                '💥 Compatibility Scanner Failure'
                            )

                            .setDescription(
                                'Result: **404% Compatibility**\n\nThe love calculator has exploded.'
                            )

                            .setTimestamp()
                    ],

                    content: ''
                });
            }

            const percent =
                getCompatibility(
                    user1.id,
                    user2.id
                );

            const tier =
                getTier(percent);

            const bar =
                createBar(percent);

            const shipName =
                createShipName(
                    user1.username,
                    user2.username
                );

            let specialMessage = '';

            if (percent >= 95) {

                specialMessage =
                    soulmateMessages[
                        Math.floor(
                            Math.random() *
                            soulmateMessages.length
                        )
                    ];
            }

            const embed =
                new EmbedBuilder()

                    .setColor(
                        tier.color
                    )

                    .setTitle(
                        '💘 Ship Result'
                    )

                    .setDescription(

                        `${user1} ❤️ ${user2}\n\n` +

                        `🏷 **Ship Name**\n\`${shipName}\`\n\n` +

                        `💖 **Compatibility**\n\`${percent}%\`\n\n` +

                        `${bar}\n\n` +

                        `💬 **Status**\n${tier.text}` +

                        (specialMessage
                            ? `\n\n${specialMessage}`
                            : '')
                    )

                    .setThumbnail(
                        user1.displayAvatarURL({
                            dynamic: true,
                            size: 256
                        })
                    )

                    .setFooter({

                        text:
                            'Love is unpredictable... or is it?'
                    })

                    .setTimestamp();

            return interaction.editReply({

                content: '',

                embeds: [embed]
            });

        } catch (err) {

            console.error(
                'Ship Command Error:',
                err
            );

            if (
                interaction.deferred ||
                interaction.replied
            ) {

                return interaction.editReply({

                    content:
                        '❌ Shipping failed.'
                });
            }

            return interaction.reply({

                content:
                    '❌ Shipping failed.',

                ephemeral: true
            });
        }
    }
};
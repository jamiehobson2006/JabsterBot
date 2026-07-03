const {
    EmbedBuilder,
    SlashCommandBuilder
} = require('discord.js');

// ==================================================
// 😂 LOADING MESSAGES
// ==================================================
const loadingMessages = [
    '😂 Stealing memes...',
    '🧠 Searching Reddit...',
    '📡 Contacting the meme servers...',
    '🔥 Finding something cursed...',
    '🎭 Looking for comedy...',
    '🚀 Launching meme retrieval system...'
];

// ==================================================
// 😂 FETCH MEME
// ==================================================
async function fetchMeme() {

    for (let i = 0; i < 3; i++) {

        try {

            const controller =
                new AbortController();

            const timeout =
                setTimeout(() => {

                    controller.abort();

                }, 5000);

            const res =
                await fetch(
                    'https://meme-api.com/gimme',
                    {
                        signal:
                            controller.signal
                    }
                );

            clearTimeout(timeout);

            if (!res.ok) {
                continue;
            }

            const data =
                await res.json();

            // ==========================================
            // 🛡 VALIDATION
            // ==========================================
            if (
                !data ||
                !data.url ||
                data.nsfw ||
                !data.url.startsWith('http')
            ) {
                continue;
            }

            // Skip videos
            if (
                data.url.endsWith('.mp4') ||
                data.url.endsWith('.gifv')
            ) {
                continue;
            }

            return data;

        } catch (err) {

            console.error(
                'Meme Fetch Error:',
                err
            );
        }
    }

    return null;
}

module.exports = {

    cooldown: 4000,

    data:
        new SlashCommandBuilder()

            .setName('meme')

            .setDescription(
                'Get a random meme'
            ),

    async execute(interaction) {

        try {

            // ==========================================
            // ⚡ LOADING
            // ==========================================
            await interaction.editReply({

                content:
                    loadingMessages[
                        Math.floor(
                            Math.random() *
                            loadingMessages.length
                        )
                    ]
            });

            // ==========================================
            // 🎲 EASTER EGG
            // ==========================================
            if (Math.random() < 0.01) {

                return interaction.editReply({

                    embeds: [

                        new EmbedBuilder()

                            .setColor(0xFEE75C)

                            .setTitle(
                                '😂 Meme Machine Offline'
                            )

                            .setDescription(
                                'The meme machine broke.\n\nPlease laugh manually.'
                            )

                            .setTimestamp()
                    ],

                    content: ''
                });
            }

            // ==========================================
            // 📥 FETCH MEME
            // ==========================================
            const data =
                await fetchMeme();

            if (!data) {

                return interaction.editReply({

                    content:
                        '❌ Failed to fetch a meme.'
                });
            }

            // ==========================================
            // 🎨 EMBED
            // ==========================================
            const embed =
                new EmbedBuilder()

                    .setColor(0x5865F2)

                    .setTitle(
                        data.title || '😂 Meme'
                    )

                    .setURL(
                        data.postLink || null
                    )

                    .setImage(
                        data.url
                    )

                    .addFields(
                        {
                            name: '📍 Subreddit',
                            value:
                                `r/${data.subreddit}`,
                            inline: true
                        },
                        {
                            name: '⬆️ Upvotes',
                            value:
                                `${data.ups || 0}`,
                            inline: true
                        },
                        {
                            name: '💬 Comments',
                            value:
                                `${data.numComments || 0}`,
                            inline: true
                        },
                        {
                            name: '👤 Author',
                            value:
                                data.author || 'Unknown',
                            inline: true
                        }
                    )

                    .setFooter({

                        text:
                            `r/${data.subreddit} • Powered by meme-api`
                    })

                    .setTimestamp();

            // ==========================================
            // 📤 RESPONSE
            // ==========================================
            return interaction.editReply({

                content: '',

                embeds: [embed]
            });

        } catch (err) {

            console.error(
                'Meme Command Error:',
                err
            );

            if (
                interaction.deferred ||
                interaction.replied
            ) {

                return interaction.editReply({

                    content:
                        '❌ Error fetching meme.'
                });
            }

            return interaction.reply({

                content:
                    '❌ Error fetching meme.',

                flags: 64
            });
        }
    }
};
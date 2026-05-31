const {
    EmbedBuilder,
    SlashCommandBuilder
} = require('discord.js');

// ==================================================
// 🤔 LOADING MESSAGES
// ==================================================
const loadingMessages = [
    '🧠 Consulting experts...',
    '📊 Running calculations...',
    '🔬 Performing science...',
    '⚙️ Calibrating rating machine...',
    '📈 Analyzing data...',
    '🤖 Processing opinion...'
];

// ==================================================
// 💬 VERDICTS
// ==================================================
const verdictComments = {
    perfect: [
        'Absolute perfection.',
        'The rating machine is impressed.',
        'Peak performance detected.'
    ],

    legendary: [
        'Exceptional quality.',
        'Among the best.',
        'Very hard to beat.'
    ],

    amazing: [
        'Highly recommended.',
        'A strong result.',
        'Definitely above average.'
    ],

    average: [
        'Nothing special.',
        'Perfectly acceptable.',
        'Could be better.'
    ],

    bad: [
        'Not looking great.',
        'Questionable quality.',
        'Needs improvement.'
    ],

    terrible: [
        'The machine is disappointed.',
        'A disaster.',
        'Please reconsider.'
    ]
};

// ==================================================
// 🎯 REACTIONS
// ==================================================
function getReaction(score) {

    if (score === 100) return '👑 PERFECT';
    if (score >= 95) return '🌟 GOD TIER';
    if (score >= 90) return '🔥 Legendary';
    if (score >= 80) return '💎 Amazing';
    if (score >= 70) return '😎 Great';
    if (score >= 60) return '👍 Pretty Good';
    if (score >= 50) return '🙂 Decent';
    if (score >= 40) return '😐 Average';
    if (score >= 30) return '🤨 Questionable';
    if (score >= 20) return '💀 Rough';
    if (score >= 10) return '🤮 Awful';

    return '🚮 Terrible';
}

// ==================================================
// 💬 COMMENT
// ==================================================
function getComment(score) {

    let pool;

    if (score === 100) {

        pool = verdictComments.perfect;

    } else if (score >= 90) {

        pool = verdictComments.legendary;

    } else if (score >= 75) {

        pool = verdictComments.amazing;

    } else if (score >= 40) {

        pool = verdictComments.average;

    } else if (score >= 20) {

        pool = verdictComments.bad;

    } else {

        pool = verdictComments.terrible;
    }

    return pool[
        Math.floor(
            Math.random() *
            pool.length
        )
    ];
}

// ==================================================
// 🎨 COLORS
// ==================================================
function getColor(score) {

    if (score >= 75) {
        return 0x57F287;
    }

    if (score >= 40) {
        return 0xFEE75C;
    }

    return 0xED4245;
}

// ==================================================
// 🎲 SCORE
// ==================================================
function generateScore() {

    if (Math.random() < 0.01) {
        return 100;
    }

    if (Math.random() < 0.01) {
        return 0;
    }

    return Math.floor(
        (Math.random() + Math.random()) * 50
    );
}

module.exports = {

    cooldown: 2500,

    data:
        new SlashCommandBuilder()

            .setName('rate')

            .setDescription(
                'Rate anything out of 100'
            )

            .addStringOption(option =>

                option

                    .setName('thing')

                    .setDescription(
                        'What do you want rated?'
                    )

                    .setRequired(true)

                    .setMaxLength(100)
            ),

    async execute(interaction) {

        try {

            const thing =
                interaction.options
                    .getString(
                        'thing',
                        true
                    )
                    .replace(
                        /@/g,
                        '@\u200b'
                    );

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

            const score =
                generateScore();

            const reaction =
                getReaction(score);

            const comment =
                getComment(score);

            const color =
                getColor(score);

            const embed =
                new EmbedBuilder()

                    .setColor(color)

                    .setTitle(
                        '⭐ Rating Machine'
                    )

                    .setDescription(

                        `## ${thing}\n\n` +

                        '━━━━━━━━━━━━━━\n\n' +

                        `### 📊 Score\n` +
                        `${score}/100\n\n` +

                        `### 🏆 Verdict\n` +
                        `${reaction}\n\n` +

                        `*${comment}*`
                    )

                    .addFields({
                        name: '📈 Rating',
                        value: reaction,
                        inline: true
                    })

                    .setFooter({
                        text:
                            'Totally scientific rating system.'
                    })

                    .setTimestamp();

            return interaction.editReply({

                content: '',

                embeds: [embed]
            });

        } catch (err) {

            console.error(
                'Rate Command Error:',
                err
            );

            if (
                interaction.deferred ||
                interaction.replied
            ) {

                return interaction.editReply({

                    content:
                        '❌ Failed to rate.'
                });
            }

            return interaction.reply({

                content:
                    '❌ Failed to rate.',

                ephemeral: true
            });
        }
    }
};
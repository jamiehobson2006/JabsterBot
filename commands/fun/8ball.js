const {
    EmbedBuilder,
    SlashCommandBuilder
} = require('discord.js');

const responses = {
    positive: [
        'Yes.',
        'Definitely!',
        'Without a doubt.',
        'Signs point to yes.',
        'It is certain.',
        'Outlook good.',
        'Absolutely.',
        'You can count on it.',
        'The odds are in your favor.',
        'The future looks bright.',
        'Everything suggests yes.',
        'Success awaits.',
        'You should go for it.',
        'I see a positive outcome.',
        'Fortune favors you.',
        'The answer is a strong yes.',
        'All signs are aligned.',
        'The stars agree.',
        'Very likely.',
        'Your chances are excellent.'
    ],

    neutral: [
        'Maybe...',
        'Ask again later.',
        'Better not tell you now.',
        'Possibly.',
        'The future is unclear.',
        'I cannot predict that yet.',
        'Concentrate and ask again.',
        'The answer is hidden.',
        'Time will tell.',
        'The outcome is uncertain.',
        'Too many possibilities exist.',
        'It could go either way.',
        'The signs are mixed.',
        'Try asking differently.',
        'Nothing is decided yet.',
        'Clouds obscure the future.',
        'The answer remains unknown.',
        'Patience is required.',
        'Perhaps.',
        'The universe is undecided.'
    ],

    negative: [
        'No.',
        'I doubt it.',
        'Very unlikely.',
        'Don’t count on it.',
        'My sources say no.',
        'No chance.',
        'Outlook not so good.',
        'Highly doubtful.',
        'The signs are against you.',
        'Not this time.',
        'The answer is negative.',
        'I would not rely on it.',
        'The odds are low.',
        'A poor outcome is likely.',
        'The future says no.',
        'Almost certainly not.',
        'That path seems blocked.',
        'Not looking promising.',
        'Unlikely to happen.',
        'I would advise against it.'
    ]
};

const rareResponses = [
    '🌟 The stars align perfectly.',
    '👀 You already know the answer.',
    '💀 The 8-ball refuses to answer.',
    '🎱 ERROR 404: Future not found.',
    '🤫 I was told not to reveal this.',
    '🐈 Ask the cat instead.',
    '🛸 The aliens say yes.',
    '⚠️ Reality is currently buffering.'
];

function getRandomResponse() {

    if (Math.random() < 0.01) {
        return {
            category: 'rare',
            confidence: '???',
            response: rareResponses[
                Math.floor(
                    Math.random() *
                    rareResponses.length
                )
            ]
        };
    }

    const roll = Math.random();

    let category;

    if (roll < 0.50) {
        category = 'neutral';
    } else if (roll < 0.80) {
        category = 'positive';
    } else {
        category = 'negative';
    }

    const response =
        responses[category][
            Math.floor(
                Math.random() *
                responses[category].length
            )
        ];

    let confidence = 'Unknown';

    if (category === 'positive') {
        confidence = 'High';
    } else if (category === 'negative') {
        confidence = 'Low';
    }

    return {
        category,
        confidence,
        response
    };
}

function getColor(category) {

    switch (category) {

        case 'positive':
            return 0x57F287;

        case 'negative':
            return 0xED4245;

        case 'rare':
            return 0x9B59B6;

        default:
            return 0xFEE75C;
    }
}

module.exports = {

    cooldown: 3000,

    data: new SlashCommandBuilder()
        .setName('8ball')
        .setDescription('Ask the magic 8-ball a question')
        .addStringOption(option =>
            option
                .setName('question')
                .setDescription('Your question')
                .setRequired(true)
                .setMaxLength(200)
        ),

    async execute(interaction) {

        try {

            const question =
                interaction.options.getString(
                    'question',
                    true
                );

            await interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0x5865F2)
                        .setTitle('🎱 Magic 8-Ball')
                        .setDescription(
                            '🔄 Shaking the 8-ball...\n\nConsulting the universe...'
                        )
                ]
            });

            await new Promise(resolve =>
                setTimeout(resolve, 1500)
            );

            const result =
                getRandomResponse();

            const embed =
                new EmbedBuilder()
                    .setColor(
                        getColor(result.category)
                    )
                    .setTitle('🎱 Magic 8-Ball')
                    .addFields(
                        {
                            name: '❓ Question',
                            value: question
                        },
                        {
                            name: '🔮 Prediction',
                            value: result.response
                        },
                        {
                            name: '📊 Confidence',
                            value: result.confidence,
                            inline: true
                        }
                    )
                    .setFooter({
                        text: 'The 8-ball sees all... maybe.'
                    })
                    .setTimestamp();

            return interaction.editReply({
                embeds: [embed]
            });

        } catch (err) {

            console.error(
                '8Ball Error:',
                err
            );

            return interaction.editReply({
                content:
                    '❌ The 8-ball broke... try again.'
            });
        }
    }
};
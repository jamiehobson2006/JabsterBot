const {
PermissionsBitField,
ChannelType,
EmbedBuilder,
SlashCommandBuilder
} = require('discord.js');

const {
run
} = require('../../database');

module.exports = {

cooldown: 5000,

data: new SlashCommandBuilder()
.setName('suggestchannel')

.setDescription(
  'Set the suggestion channel for this server'
)

.addChannelOption(option =>

  option

    .setName('channel')

    .setDescription(
      'The channel where suggestions will be sent'
    )

    .addChannelTypes(

      ChannelType.GuildText,

      ChannelType.GuildAnnouncement
    )

    .setRequired(true)
),

async execute(interaction) {
  try {

  // ==========================================
  // 🔐 PERMISSION CHECK
  // ==========================================
  if (

    !interaction.memberPermissions.has(

      PermissionsBitField.Flags.ManageGuild
    )
  ) {

    return interaction.editReply({

      content:
        '❌ You need **Manage Server** permission.'
    });
  }

  // ==========================================
  // 📺 CHANNEL
  // ==========================================
  const channel =
    interaction.options.getChannel(
      'channel',
      true
    );

  const botMember =
    interaction.guild.members.me;

  // ==========================================
  // 🤖 BOT PERMISSIONS
  // ==========================================
  const perms =
    channel.permissionsFor(
      botMember
    );

  const missing = [];

  if (

    !perms?.has(
      PermissionsBitField.Flags.ViewChannel
    )
  ) {

    missing.push(
      'View Channel'
    );
  }

  if (

    !perms?.has(
      PermissionsBitField.Flags.SendMessages
    )
  ) {

    missing.push(
      'Send Messages'
    );
  }

  if (

    !perms?.has(
      PermissionsBitField.Flags.EmbedLinks
    )
  ) {

    missing.push(
      'Embed Links'
    );
  }

  if (

    !perms?.has(
      PermissionsBitField.Flags.AddReactions
    )
  ) {

    missing.push(
      'Add Reactions'
    );
  }

  if (

    !perms?.has(
      PermissionsBitField.Flags.SendMessagesInThreads
    )
  ) {

    missing.push(
      'Send Messages In Threads'
    );
  }

  if (

    !perms?.has(
      PermissionsBitField.Flags.ReadMessageHistory
    )
  ) {

    missing.push(
      'Read Message History'
    );
  }

  if (missing.length) {

    return interaction.editReply({

      content:

        `❌ Missing permissions in ${channel}:\n\n` +

        `• ${missing.join('\n• ')}`
    });
  }

  // ==========================================
  // 💾 SAVE
  // ==========================================
  run(

    `INSERT INTO guild_settings

    (

      guildId,
      suggestionChannelId

    )

    VALUES (?, ?)

    ON CONFLICT(guildId)

    DO UPDATE SET

    suggestionChannelId =
    excluded.suggestionChannelId`,

    [

      interaction.guild.id,

      channel.id
    ]
  );

  // ==========================================
  // 📩 TEST MESSAGE
  // ==========================================
  try {

    await channel.send({

      embeds: [

        new EmbedBuilder()

          .setColor(0x5865F2)

          .setTitle(
            '💡 Suggestions Enabled'
          )

          .setDescription(

            'This channel is now configured for suggestions.\n\n' +

            'Users can now submit:\n\n' +

            '• Suggestions\n' +
            '• Community ideas\n' +
            '• Feature requests\n' +
            '• Feedback\n' +
            '• Discussion threads'
          )

          .setFooter({

            text:
              `Configured by ${interaction.user.tag}`
          })

          .setTimestamp()
      ]

    });

  } catch (messageError) {

    console.warn(
      'Failed to send suggestion setup message:',
      messageError
    );
  }

  // ==========================================
  // 🎨 RESPONSE EMBED
  // ==========================================
  const embed =
    new EmbedBuilder()

      .setColor(0x57F287)

      .setTitle(
        '💡 Suggestion Channel Configured'
      )

      .setDescription(

        `Suggestions will now be sent in ${channel}`
      )

      .addFields(

        {

          name: 'Enabled Features',

          value:

            '• Suggestion submissions\n' +
            '• Voting reactions\n' +
            '• Community feedback\n' +
            '• Suggestion analytics\n' +
            '• Discussion threads',

          inline: false
        },

        {

          name: 'Configured By',

          value:
            `${interaction.user}`,

          inline: true
        },

        {

          name: 'Channel',

          value:
            `${channel}`,

          inline: true
        }
      )

      .setFooter({

        text:
          `Guild ID: ${interaction.guild.id}`
      })

      .setTimestamp();

  // ==========================================
  // 📤 RESPONSE
  // ==========================================
  return interaction.editReply({

    embeds: [embed]
  });

} catch (err) {

  console.error(
    'SuggestChannel Error:',
    err
  );

  if (

    interaction.deferred ||

    interaction.replied
  ) {

    return interaction.editReply({

      content:
        '❌ Failed to set suggestion channel.'
    });
  }

  return interaction.reply({

    content:
      '❌ Failed to set suggestion channel.',

    ephemeral: true
  });
}

}
};
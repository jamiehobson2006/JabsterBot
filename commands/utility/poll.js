const {
  EmbedBuilder,
  SlashCommandBuilder,
  PermissionsBitField
} = require('discord.js');

const EMOJIS = ['🇦', '🇧', '🇨', '🇩', '🇪'];

// ========================
// ⏱ PARSE DURATION
// ========================
function parseDuration(input) {

  if (!input) return null;

  const match =
    input.match(/^(\d+)(s|m|h|d)$/i);

  if (!match) return null;

  const value =
    parseInt(match[1]);

  const unit =
    match[2].toLowerCase();

  const multipliers = {

    s: 1000,
    m: 60000,
    h: 3600000,
    d: 86400000
  };

  return value * multipliers[unit];
}

// ========================
// 📊 PROGRESS BAR
// ========================
function createBar(percent) {

  const total = 10;

  const filled =
    Math.round(
      (percent / 100) * total
    );

  const empty =
    total - filled;

  return (
    '🟩'.repeat(filled) +
    '⬛'.repeat(empty)
  );
}

// ========================
// 📈 BUILD RESULTS
// ========================
function buildResults(options, counts) {

  const totalVotes =
    counts.reduce((a, b) => a + b, 0);

  return options.map((option, i) => {

    const votes =
      counts[i];

    const percent =
      totalVotes > 0

        ? Math.round(
            (votes / totalVotes) * 100
          )

        : 0;

    return (
      `${EMOJIS[i]} • ${option}\n` +
      `${createBar(percent)} ${percent}% (${votes} votes)`
    );

  }).join('\n\n');
}

module.exports = {

  cooldown: 5000,

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
      option
        .setName('option1')
        .setDescription('Option 1')
        .setRequired(true)
    )

    .addStringOption(option =>
      option
        .setName('option2')
        .setDescription('Option 2')
        .setRequired(true)
    )

    .addStringOption(option =>
      option
        .setName('option3')
        .setDescription('Option 3')
    )

    .addStringOption(option =>
      option
        .setName('option4')
        .setDescription('Option 4')
    )

    .addStringOption(option =>
      option
        .setName('option5')
        .setDescription('Option 5')
    )

    .addStringOption(option =>
      option
        .setName('duration')
        .setDescription(
          'Poll duration (example: 30s, 5m, 1h, 1d)'
        )
    )

    .addRoleOption(option =>
      option
        .setName('ping_role')
        .setDescription('Role to ping (Admin only)')
    ),

  async execute(interaction) {

    try {

      const question =
        interaction.options.getString(
          'question',
          true
        );

      const durationInput =
        interaction.options.getString(
          'duration'
        );

      const duration =
        parseDuration(durationInput);

      // ========================
      // ⏱ INVALID TIME
      // ========================
      if (
        durationInput &&
        !duration
      ) {

        return interaction.editReply({
          content:
            '❌ Invalid duration. Use formats like `30s`, `5m`, `1h`, `1d`.'
        });
      }

      // ========================
      // 📥 OPTIONS
      // ========================
      const options = [

        interaction.options.getString('option1'),

        interaction.options.getString('option2'),

        interaction.options.getString('option3'),

        interaction.options.getString('option4'),

        interaction.options.getString('option5')

      ]
      .filter(Boolean)
      .map(opt => opt.trim());

      // ========================
      // 🚫 DUPLICATES
      // ========================
      const unique =
        new Set(
          options.map(
            o => o.toLowerCase()
          )
        );

      if (
        unique.size !== options.length
      ) {

        return interaction.editReply({
          content:
            '❌ Poll options must be unique.'
        });
      }

      // ========================
      // 👥 ROLE PING
      // ========================
      const role =
        interaction.options.getRole(
          'ping_role'
        );

      if (
        role &&
        !interaction.memberPermissions.has(
          PermissionsBitField.Flags.Administrator
        )
      ) {

        return interaction.editReply({
          content:
            '❌ Only administrators can ping roles.'
        });
      }

      if (
        role &&
        (
          role.managed ||
          role.id === interaction.guild.roles.everyone.id
        )
      ) {

        return interaction.editReply({
          content:
            '❌ That role cannot be pinged.'
        });
      }

      // ========================
      // 🤖 BOT PERMISSIONS
      // ========================
      const perms =
        interaction.channel.permissionsFor(
          interaction.guild.members.me
        );

      if (
        !perms.has([

          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.EmbedLinks,
          PermissionsBitField.Flags.AddReactions,
          PermissionsBitField.Flags.ReadMessageHistory

        ])
      ) {

        return interaction.editReply({
          content:
            '❌ I am missing permissions in this channel.'
        });
      }

      // ========================
      // 📊 INITIAL RESULTS
      // ========================
      const initialCounts =
        new Array(options.length).fill(0);

      const resultsText =
        buildResults(
          options,
          initialCounts
        );

      // ========================
      // 🎨 EMBED
      // ========================
      const embed =
        new EmbedBuilder()

          .setColor(0x5865F2)

          .setTitle('📊 Community Poll')

          .setDescription(
            `## ${question}\n\n${resultsText}`
          )

          .addFields({

            name: '🗳️ Voting',

            value:
              duration

                ? `Poll ends <t:${Math.floor((Date.now() + duration) / 1000)}:R>`

                : 'No end time set'
          })

          .setThumbnail(
            interaction.user.displayAvatarURL({
              dynamic: true
            })
          )

          .setFooter({
            text:
              `Poll by ${interaction.user.tag}`
          })

          .setTimestamp();

      // ========================
      // 📤 SEND POLL
      // ========================
      const msg =
        await interaction.channel.send({

          content:
            role ? `${role}` : null,

          embeds: [embed]
        });

      // ========================
      // 👍 ADD REACTIONS
      // ========================
      for (
        let i = 0;
        i < options.length;
        i++
      ) {

        await msg.react(
          EMOJIS[i]
        );
      }

      // ========================
      // 🔄 LIVE RESULTS
      // ========================
      const interval =
        setInterval(async () => {

          try {

            const fetched =
              await msg.fetch();

            const counts = [];

            for (
              let i = 0;
              i < options.length;
              i++
            ) {

              const reaction =
                fetched.reactions.cache.get(
                  EMOJIS[i]
                );

              counts.push(
                Math.max(
                  (reaction?.count || 1) - 1,
                  0
                )
              );
            }

            const updated =
              EmbedBuilder.from(
                fetched.embeds[0]
              );

            updated.setDescription(
              `## ${question}\n\n` +
              buildResults(
                options,
                counts
              )
            );

            await fetched.edit({
              embeds: [updated]
            });

          } catch {}
      }, 5000);

      // ========================
      // ⏱ POLL END
      // ========================
      if (duration) {

        setTimeout(async () => {

          clearInterval(interval);

          try {

            const fetched =
              await msg.fetch();

            const counts = [];

            for (
              let i = 0;
              i < options.length;
              i++
            ) {

              const reaction =
                fetched.reactions.cache.get(
                  EMOJIS[i]
                );

              counts.push(
                Math.max(
                  (reaction?.count || 1) - 1,
                  0
                )
              );
            }

            const highest =
              Math.max(...counts);

            const winners =
              options.filter(
                (_, i) =>
                  counts[i] === highest
              );

            const finalEmbed =
              EmbedBuilder.from(
                fetched.embeds[0]
              );

            finalEmbed

              .setColor(0x57F287)

              .addFields({

                name: '🏆 Poll Ended',

                value:
                  winners.length === 1

                    ? `Winner: **${winners[0]}**`

                    : `Tie between: **${winners.join(', ')}**`
              });

            await fetched.edit({
              embeds: [finalEmbed]
            });

          } catch {}

        }, duration);
      }

      // ========================
      // ✅ RESPONSE
      // ========================
      await interaction.editReply({
        content:
          '✅ Poll created successfully.'
      });

      // ========================
      // 🗑 AUTO DELETE
      // ========================
      setTimeout(() => {

        interaction
          .deleteReply()
          .catch(() => {});

      }, 3000);

    } catch (err) {

      console.error(
        'Poll Error:',
        err
      );

      if (
        interaction.deferred ||
        interaction.replied
      ) {

        return interaction.editReply({
          content:
            '❌ Failed to create poll.'
        });
      }

      return interaction.reply({

        content:
          '❌ Failed to create poll.',

        flags: 64
      });
    }
  }
};
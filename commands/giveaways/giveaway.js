const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField
} = require('discord.js');

const {
  run
} = require('../../database');

// ==================================================
// ⏱ DURATION PARSER
// ==================================================
function parseDuration(input) {

  const match =
    input.match(
      /^(\d+)(s|m|h|d)$/i
    );

  if (!match) {
    return null;
  }

  const value =
    parseInt(match[1]);

  const unit =
    match[2].toLowerCase();

  switch (unit) {

    case 's':
      return value * 1000;

    case 'm':
      return value * 60000;

    case 'h':
      return value * 3600000;

    case 'd':
      return value * 86400000;

    default:
      return null;
  }
}

module.exports = {

  cooldown: 5000,

  data: new SlashCommandBuilder()

    .setName('giveaway')

    .setDescription(
      'Create a giveaway'
    )

    // ==========================================
    // 🎁 BASIC
    // ==========================================
    .addStringOption(option =>

      option

        .setName('prize')

        .setDescription(
          'Giveaway prize'
        )

        .setRequired(true)
    )

    .addStringOption(option =>

      option

        .setName('duration')

        .setDescription(
          'Example: 1h, 2d, 30m'
        )

        .setRequired(true)
    )

    .addIntegerOption(option =>

      option

        .setName('winners')

        .setDescription(
          'Number of winners'
        )

        .setMinValue(1)

        .setMaxValue(20)

        .setRequired(true)
    )

    .addStringOption(option =>

      option

        .setName('description')

        .setDescription(
          'Optional giveaway description'
        )

        .setRequired(false)
    )

    // ==========================================
    // 📨 INVITES
    // ==========================================
    .addIntegerOption(option =>

      option

        .setName('min_invites')

        .setDescription(
          'Required invites'
        )

        .setMinValue(0)

        .setRequired(false)
    )

    // ==========================================
    // 💬 MESSAGE REQUIREMENTS
    // ==========================================
    .addIntegerOption(option =>

      option

        .setName('weekly_messages')

        .setDescription(
          'Required weekly messages'
        )

        .setMinValue(0)

        .setRequired(false)
    )

    .addIntegerOption(option =>

      option

        .setName('monthly_messages')

        .setDescription(
          'Required monthly messages'
        )

        .setMinValue(0)

        .setRequired(false)
    )

    .addIntegerOption(option =>

      option

        .setName('total_messages')

        .setDescription(
          'Required total messages'
        )

        .setMinValue(0)

        .setRequired(false)
    )

    // ==========================================
    // 🎭 ROLE REQUIREMENTS
    // ==========================================
    .addRoleOption(option =>

      option

        .setName('required_role')

        .setDescription(
          'Required role'
        )

        .setRequired(false)
    )

    .addRoleOption(option =>

      option

        .setName('blacklist_role')

        .setDescription(
          'Blacklisted role'
        )

        .setRequired(false)
    )

    // ==========================================
    // 🎁 BONUS ENTRIES
    // ==========================================
    .addRoleOption(option =>

      option

        .setName('bonus_role')

        .setDescription(
          'Role that gets bonus entries'
        )

        .setRequired(false)
    )

    .addIntegerOption(option =>

      option

        .setName('bonus_entries')

        .setDescription(
          'Extra entries for the bonus role'
        )

        .setMinValue(1)

        .setMaxValue(100)

        .setRequired(false)
    )

    // ==========================================
    // 🚀 BOOSTING
    // ==========================================
    .addBooleanOption(option =>

      option

        .setName('must_boost')

        .setDescription(
          'Must be boosting server'
        )

        .setRequired(false)
    ),

  async execute(interaction) {

    try {

      // ==========================================
      // 🔐 PERMISSIONS
      // ==========================================
      if (

        !interaction.memberPermissions.has(

          PermissionsBitField.Flags.ManageGuild
        )
      ) {

        return interaction.editReply({

          content:
            '❌ You need Manage Server permission.'
        });
      }

      // ==========================================
      // 🎁 OPTIONS
      // ==========================================
      const prize =
        interaction.options.getString(
          'prize',
          true
        );

      const durationInput =
        interaction.options.getString(
          'duration',
          true
        );

      const winners =
        interaction.options.getInteger(
          'winners',
          true
        );

      const description =
        interaction.options.getString(
          'description'
        ) || null;

      // ==========================================
      // ⏱ PARSE DURATION
      // ==========================================
      const duration =
        parseDuration(
          durationInput
        );

      if (!duration) {

        return interaction.editReply({

          content:

            '❌ Invalid duration.\n' +

            'Examples: `30m`, `1h`, `2d`'
        });
      }

      // ==========================================
      // ⏱ LIMITS
      // ==========================================
      const MIN_DURATION =
        60000;

      const MAX_DURATION =
        7776000000;

      if (duration < MIN_DURATION) {

        return interaction.editReply({

          content:
            '❌ Minimum duration is 1 minute.'
        });
      }

      if (duration > MAX_DURATION) {

        return interaction.editReply({

          content:
            '❌ Maximum duration is 90 days.'
        });
      }

      const endsAt =
        Date.now() + duration;

      // ==========================================
      // 🧠 REQUIREMENTS
      // ==========================================
      const requirements = {

        minInvites:
          interaction.options.getInteger(
            'min_invites'
          ) || 0,

        weeklyMessages:
          interaction.options.getInteger(
            'weekly_messages'
          ) || 0,

        monthlyMessages:
          interaction.options.getInteger(
            'monthly_messages'
          ) || 0,

        totalMessages:
          interaction.options.getInteger(
            'total_messages'
          ) || 0,

        mustBoost:
          interaction.options.getBoolean(
            'must_boost'
          ) || false,

        requiredRoles: [],

        blacklistedRoles: [],

        bonusRoles: []
      };

      // ==========================================
      // 🎭 REQUIRED ROLE
      // ==========================================
      const requiredRole =
        interaction.options.getRole(
          'required_role'
        );

      if (requiredRole) {

        requirements.requiredRoles.push(
          requiredRole.id
        );
      }

      // ==========================================
      // 🚫 BLACKLIST ROLE
      // ==========================================
      const blacklistRole =
        interaction.options.getRole(
          'blacklist_role'
        );

      if (blacklistRole) {

        requirements.blacklistedRoles.push(
          blacklistRole.id
        );
      }

      // ==========================================
      // 🚫 ROLE CONFLICT
      // ==========================================
      if (

        requiredRole &&

        blacklistRole &&

        requiredRole.id === blacklistRole.id
      ) {

        return interaction.editReply({

          content:

            '❌ A role cannot be both required and blacklisted.'
        });
      }

      // ==========================================
      // 🎁 BONUS ROLE
      // ==========================================
      const bonusRole =
        interaction.options.getRole(
          'bonus_role'
        );

      const bonusEntries =
        interaction.options.getInteger(
          'bonus_entries'
        );

      // ==========================================
      // 🚫 INVALID BONUS SETUP
      // ==========================================
      if (

        (bonusRole && !bonusEntries) ||

        (!bonusRole && bonusEntries)
      ) {

        return interaction.editReply({

          content:

            '❌ Bonus role and bonus entries must both be provided.'
        });
      }

      if (
        bonusRole &&
        bonusEntries
      ) {

        requirements.bonusRoles.push({

          roleId:
            bonusRole.id,

          entries:
            bonusEntries
        });
      }

      // ==========================================
      // 🎨 EMBED
      // ==========================================
      const embed =
        new EmbedBuilder()

          .setColor(0x5865F2)

          .setTitle(
            '🎉 Giveaway'
          )

          .setDescription(

            `## ${prize}\n\n` +

            `${description || '*No description provided.*'}\n\n` +

            `⏰ Ends: <t:${Math.floor(
              endsAt / 1000
            )}:R>\n` +

            `🏆 Winners: **${winners}**\n` +

            `🎯 Hosted by: ${interaction.user}\n\n` +

            `👥 Entries: **0**`
          )

          .addFields({

            name: '🎯 Requirements',

            value:

              buildRequirementText(
                requirements
              )
          })

          .setFooter({

            text:
              'Click the buttons below to join or leave'
          })

          .setTimestamp();

      // ==========================================
      // 🎟 BUTTONS
      // ==========================================
      const row =
        new ActionRowBuilder()

          .addComponents(

            new ButtonBuilder()

              .setCustomId(
                'giveaway_join'
              )

              .setLabel(
                '🎉 Join Giveaway'
              )

              .setStyle(
                ButtonStyle.Success
              ),

            new ButtonBuilder()

              .setCustomId(
                'giveaway_leave'
              )

              .setLabel(
                '❌ Leave Giveaway'
              )

              .setStyle(
                ButtonStyle.Danger
              )
          );

      // ==========================================
      // 📤 SEND
      // ==========================================
      const message =
        await interaction.channel.send({

          embeds: [embed],

          components: [row]
        });

      // ==========================================
      // 💾 SAVE
      // ==========================================
      run(

        `INSERT INTO giveaways (

          messageId,
          guildId,
          channelId,
          hostId,

          prize,
          description,

          winners,

          endsAt,

          requirements,

          createdAt,

          ended

        )

        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,

        [

          message.id,

          interaction.guild.id,

          interaction.channel.id,

          interaction.user.id,

          prize,

          description,

          winners,

          endsAt,

          JSON.stringify(
            requirements
          ),

          Date.now(),

          0
        ]
      );

      // ==========================================
      // ✅ RESPONSE
      // ==========================================
      await interaction.editReply({

        content:
          '✅ Giveaway created successfully.'
      });

    } catch (err) {

      console.error(
        'Giveaway Error:',
        err
      );

      return interaction.editReply({

        content:
          '❌ Failed to create giveaway.'
      });
    }
  }
};

// ==================================================
// 🧠 REQUIREMENT TEXT
// ==================================================
function buildRequirementText(
  req
) {

  const lines = [];

  if (req.minInvites) {

    lines.push(
      `📨 ${req.minInvites}+ invites`
    );
  }

  if (req.weeklyMessages) {

    lines.push(
      `💬 ${req.weeklyMessages}+ weekly messages`
    );
  }

  if (req.monthlyMessages) {

    lines.push(
      `🗓 ${req.monthlyMessages}+ monthly messages`
    );
  }

  if (req.totalMessages) {

    lines.push(
      `📈 ${req.totalMessages}+ total messages`
    );
  }

  if (req.mustBoost) {

    lines.push(
      '🚀 Must be boosting'
    );
  }

  if (
    req.requiredRoles?.length
  ) {

    lines.push(

      `🎭 Required Roles:\n` +

      req.requiredRoles

        .map(id => `<@&${id}>`)

        .join(', ')
    );
  }

  if (
    req.blacklistedRoles?.length
  ) {

    lines.push(

      `🚫 Blacklisted Roles:\n` +

      req.blacklistedRoles

        .map(id => `<@&${id}>`)

        .join(', ')
    );
  }

  if (
    req.bonusRoles?.length
  ) {

    for (const role of req.bonusRoles) {

      lines.push(

        `🎁 <@&${role.roleId}> = +${role.entries} entries`
      );
    }
  }

  if (!lines.length) {

    return 'None';
  }

  return lines.join('\n');
}
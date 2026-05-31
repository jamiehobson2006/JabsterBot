const {
  EmbedBuilder
} = require('discord.js');

const {
  findUsedInvite
} = require('../utils/giveaways/cache');

const {
  get,
  run
} = require('../database');

module.exports = {

  name: 'guildMemberAdd',

  async execute(member) {

    try {

      const guild =
        member.guild;

      // ==========================================
      // 📨 FIND USED INVITE
      // ==========================================
      const usedInvite =
        await findUsedInvite(member);

      const inviterId =
        usedInvite?.inviterId || null;

      const inviteCode =
        usedInvite?.code || 'Unknown';

      // ==========================================
      // 🕵️ ACCOUNT AGE
      // ==========================================
      const accountAge =
        Date.now() -
        member.user.createdTimestamp;

      const ageDays =
        Math.floor(

          accountAge /

          (1000 * 60 * 60 * 24)
        );

      // ==========================================
      // 🚨 ADVANCED ALT DETECTION
      // ==========================================
      const suspiciousFlags = [];

      if (ageDays < 7) {

        suspiciousFlags.push(
          'New Account'
        );
      }

      if (
        member.user.avatar === null
      ) {

        suspiciousFlags.push(
          'Default Avatar'
        );
      }

      if (
        /\d{4,}/.test(
          member.user.username
        )
      ) {

        suspiciousFlags.push(
          'Suspicious Username'
        );
      }

      const isFake =
        suspiciousFlags.length > 0;

      // ==========================================
      // 💾 SAVE INVITE
      // ==========================================
      run(

        `INSERT INTO invites
        (
          guildId,
          userId,
          inviterId,
          inviteCode,
          uses,
          joinedAt,
          fake
        )

        VALUES (?, ?, ?, ?, ?, ?, ?)

        ON CONFLICT(guildId, userId)

        DO UPDATE SET

          inviterId = excluded.inviterId,
          inviteCode = excluded.inviteCode,
          uses = excluded.uses,
          joinedAt = excluded.joinedAt,
          fake = excluded.fake`,

        [

          guild.id,

          member.id,

          inviterId,

          inviteCode,

          usedInvite?.uses || 0,

          Date.now(),

          isFake ? 1 : 0
        ]
      );

      // ==========================================
      // 📊 UPDATE INVITER STATS
      // ==========================================
      if (inviterId) {

        run(

          `INSERT INTO invite_stats
          (
            guildId,
            userId,
            invites,
            fake
          )

          VALUES (?, ?, ?, ?)

          ON CONFLICT(guildId, userId)

          DO UPDATE SET

            invites = invites + 1,
            fake = fake + excluded.fake`,

          [

            guild.id,

            inviterId,

            1,

            isFake ? 1 : 0
          ]
        );
      }

      // ==========================================
      // 📡 INVITE LOG CHANNEL
      // ==========================================
      const settings =
        get(

          `SELECT inviteChannelId
          FROM guild_settings
          WHERE guildId = ?`,

          [guild.id]
        );

      if (
        !settings?.inviteChannelId
      ) {

        return;
      }

      // ==========================================
      // 📺 FETCH CHANNEL SAFELY
      // ==========================================
      const channel =
        await guild.channels

          .fetch(
            settings.inviteChannelId
          )

          .catch(() => null);

      if (
        !channel ||
        !channel.isTextBased()
      ) {

        return;
      }

      // ==========================================
      // 📊 INVITER STATS
      // ==========================================
      let inviterStats =
        null;

      if (inviterId) {

        inviterStats =
          get(

            `SELECT *
            FROM invite_stats
            WHERE guildId = ?
            AND userId = ?`,

            [

              guild.id,

              inviterId
            ]
          );
      }

      // ==========================================
      // 🎨 EMBED
      // ==========================================
      const embed =
        new EmbedBuilder()

          .setColor(

            isFake

              ? 0xED4245

              : 0x57F287
          )

          .setAuthor({

            name:
              member.user.tag,

            iconURL:
              member.user.displayAvatarURL({

                dynamic: true
              })
          })

          .setThumbnail(

            member.user.displayAvatarURL({

              dynamic: true,

              size: 256
            })
          )

          .setTitle(

            isFake

              ? '⚠️ Suspicious Member Joined'

              : '📥 Member Joined'
          )

          .addFields(

            {

              name:
                '👤 User',

              value:
                `${member}`,

              inline: true
            },

            {

              name:
                '🆔 User ID',

              value:
                `\`${member.id}\``,

              inline: true
            },

            {

              name:
                '📅 Account Created',

              value:

                `<t:${Math.floor(
                  member.user.createdTimestamp / 1000
                )}:R>`,

              inline: true
            },

            {

              name:
                '📨 Invited By',

              value:

                inviterId

                  ? `<@${inviterId}>`

                  : 'Unknown',

              inline: true
            },

            {

              name:
                '🔗 Invite Code',

              value:
                `\`${inviteCode}\``,

              inline: true
            },

            {

              name:
                '📊 Inviter Stats',

              value:

                inviterStats

                  ? `Total: ${inviterStats.invites || 0}\n` +

                    `Fake: ${inviterStats.fake || 0}\n` +

                    `Leaves: ${inviterStats.leaves || 0}`

                  : 'No stats',

              inline: true
            }
          )

          .setFooter({

            text:

              isFake

                ? `⚠️ ${suspiciousFlags.join(' • ')}`

                : `Account age: ${ageDays} day(s)`
          })

          .setTimestamp();

      // ==========================================
      // 🚨 ALT WARNING
      // ==========================================
      if (isFake) {

        embed.setDescription(

          '⚠️ This member may be suspicious.\n\n' +

          suspiciousFlags

            .map(
              flag => `• ${flag}`
            )

            .join('\n')
        );
      }

      // ==========================================
      // 📤 SEND LOG
      // ==========================================
      await channel.send({

        embeds: [embed]
      });

    } catch (err) {

      console.error(
        'GuildMemberAdd Error:',
        err
      );
    }
  }
};
const {
  EmbedBuilder
} = require('discord.js');

const {
  get,
  run
} = require('../database');

const {
  createMemberLeaveEmbed,
  sendLog
} = require('../utils/logger');

const {
  sendGreeting
} = require('../utils/greetings');

module.exports = {

  name: 'guildMemberRemove',

  async execute(member, client) {

    try {

      const guild =
        member.guild;

      await sendLog(
        client,
        guild.id,
        'MEMBERS',
        createMemberLeaveEmbed(member)
      );

      await sendGreeting({
        client,
        member,
        type: 'goodbye'
      });

      // ==========================================
      // 🔍 GET INVITE DATA
      // ==========================================
      const inviteData =
        get(

          `SELECT *
          FROM invites
          WHERE guildId = ?
          AND userId = ?`,

          [

            guild.id,

            member.id
          ]
        );

      if (!inviteData) {

        return;
      }

      const inviterId =
        inviteData.inviterId;

      const wasFake =
        Boolean(
          inviteData.fake
        );

      // ==========================================
      // ⏱ JOIN DATA
      // ==========================================
      const joinedAt =
        inviteData.joinedAt || Date.now();

      const leftAt =
        Date.now();

      const stayDuration =
        leftAt - joinedAt;

      // ==========================================
      // 🚨 FAST LEAVE DETECTION
      // ==========================================
      const fastLeave =
        stayDuration <
        (1000 * 60 * 30);

      // ==========================================
      // 💾 MARK LEFT
      // ==========================================
      run(

        `UPDATE invites

        SET leftAt = ?

        WHERE guildId = ?
        AND userId = ?`,

        [

          leftAt,

          guild.id,

          member.id
        ]
      );

      // ==========================================
      // 📊 UPDATE STATS
      // ==========================================
      if (inviterId) {

        run(

          `INSERT INTO invite_stats
          (
            guildId,
            userId,
            leaves
          )

          VALUES (?, ?, ?)

          ON CONFLICT(guildId, userId)

          DO UPDATE SET

            leaves = leaves + 1`,

          [

            guild.id,

            inviterId,

            1
          ]
        );
      }

      // ==========================================
      // 📡 LOG CHANNEL
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
      // ⏱ STAY TIME FORMAT
      // ==========================================
      const days =
        Math.floor(

          stayDuration /

          (1000 * 60 * 60 * 24)
        );

      const hours =
        Math.floor(

          stayDuration /

          (1000 * 60 * 60)
        );

      const minutes =
        Math.floor(

          stayDuration /

          (1000 * 60)
        );

      let stayText =
        `${minutes} minute(s)`;

      if (hours >= 1) {

        stayText =
          `${hours} hour(s)`;
      }

      if (days >= 1) {

        stayText =
          `${days} day(s)`;
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

          .setColor(0xED4245)

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
            '📤 Member Left'
          )

          .addFields(

            {

              name:
                '👤 User',

              value:
                `${member.user}`,

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
                '📨 Invited By',

              value:

                inviterId

                  ? `<@${inviterId}>`

                  : 'Unknown',

              inline: true
            },

            {

              name:
                '⏱ Stayed For',

              value:
                stayText,

              inline: true
            },

            {

              name:
                '⚠️ Fake Account',

              value:
                wasFake
                  ? 'Yes'
                  : 'No',

              inline: true
            },

            {

              name:
                '🚨 Fast Leave',

              value:
                fastLeave
                  ? 'Yes'
                  : 'No',

              inline: true
            },

            {

              name:
                '📊 Inviter Stats',

              value:

                inviterStats

                  ? `Invites: ${inviterStats.invites || 0}\n` +

                    `Leaves: ${inviterStats.leaves || 0}\n` +

                    `Fake: ${inviterStats.fake || 0}`

                  : 'No stats',

              inline: true
            },

            {

              name:
                '📅 Joined',

              value:
                `<t:${Math.floor(joinedAt / 1000)}:R>`,

              inline: true
            },

            {

              name:
                '📤 Left',

              value:
                `<t:${Math.floor(leftAt / 1000)}:R>`,

              inline: true
            }
          )

          .setFooter({

            text:
              'Invite Tracking System'
          })

          .setTimestamp();

      // ==========================================
      // 🚨 FAST LEAVE WARNING
      // ==========================================
      if (fastLeave) {

        embed.setDescription(

          '⚠️ User left shortly after joining.\n' +

          'Potential fake invite or alt account.'
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
        'GuildMemberRemove Error:',
        err
      );
    }
  }
};

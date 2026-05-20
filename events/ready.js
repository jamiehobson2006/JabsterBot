const {
  ActivityType,
  PermissionsBitField
} = require('discord.js');

const {
  loadGuildInvites
} = require('../utils/cache');

module.exports = {

  name: 'clientReady',

  once: true,

  async execute(client) {

    try {

      // ==========================================
      // 🚀 STARTUP INFO
      // ==========================================
      console.log('━━━━━━━━━━━━━━━━━━━━━━');

      console.log(
        `✅ Logged in as ${client.user.tag}`
      );

      console.log(
        `🌍 Servers: ${client.guilds.cache.size}`
      );

      console.log(
        `👥 Cached Users: ${client.users.cache.size}`
      );

      console.log(
        `📦 Commands: ${client.commands.size}`
      );

      console.log(
        `🆔 Bot ID: ${client.user.id}`
      );

      console.log('━━━━━━━━━━━━━━━━━━━━━━');

      // ==========================================
      // ⏳ DELAY SYSTEM LOAD
      // ==========================================
      await new Promise(resolve =>

        setTimeout(resolve, 3000)
      );

      // ==========================================
      // 📨 CACHE INVITES
      // ==========================================
      console.log(
        '📨 Loading invite caches...'
      );

      let cachedGuilds = 0;
      let failedGuilds = 0;

      for (
        const guild of
        client.guilds.cache.values()
      ) {

        try {

          // ======================================
          // 🛡 FETCH BOT MEMBER
          // ======================================
          const me =
            guild.members.me ||

            await guild.members
              .fetchMe()
              .catch(() => null);

          if (!me) {

            console.log(

              `⚠️ Failed fetching bot member in ${guild.name}`
            );

            failedGuilds++;

            continue;
          }

          // ======================================
          // 🛡 CHECK PERMISSIONS
          // ======================================
          if (
            !me.permissions.has(
              PermissionsBitField.Flags.ManageGuild
            )
          ) {

            console.log(

              `⚠️ Missing ManageGuild in ${guild.name}`
            );

            failedGuilds++;

            continue;
          }

          // ======================================
          // 📨 LOAD INVITES
          // ======================================
          await loadGuildInvites(
            guild
          );

          cachedGuilds++;

        } catch (err) {

          failedGuilds++;

          console.error(

            `❌ Failed caching invites for ${guild.name}:`,

            err
          );
        }
      }

      console.log(

        `✅ Invite cache loaded for ${cachedGuilds} guild(s)`
      );

      if (failedGuilds > 0) {

        console.log(

          `⚠️ Failed loading ${failedGuilds} guild(s)`
        );
      }

      // ==========================================
      // 🤖 DYNAMIC STATUS SYSTEM
      // ==========================================
      const statuses = [

        () =>
          `🎟 Managing tickets`,

        () =>
          `📨 Tracking invites`,

        () =>
          `🛡 Moderating servers`,

        () =>
          `🌍 ${client.guilds.cache.size} servers`,

        () =>
          `👥 ${client.users.cache.size.toLocaleString()} users`,

        () =>
          `📦 ${client.commands.size} commands`
      ];

      let index = 0;

      // ==========================================
      // 🔄 UPDATE PRESENCE
      // ==========================================
      async function updatePresence() {

        try {

          const status =
            statuses[index]();

          await client.user.setPresence({

            activities: [

              {

                name: status,

                type:
                  ActivityType.Watching
              }
            ],

            status: 'online'
          });

          index++;

          if (
            index >= statuses.length
          ) {

            index = 0;
          }

        } catch (err) {

          console.error(
            'Presence Update Error:',
            err
          );
        }
      }

      // ==========================================
      // 🚀 INITIAL STATUS
      // ==========================================
      await updatePresence();

      // ==========================================
      // ⏱ STATUS ROTATION
      // ==========================================
      setInterval(

        updatePresence,

        15000
      );

      // ==========================================
      // ✅ READY COMPLETE
      // ==========================================
      console.log(
        '━━━━━━━━━━━━━━━━━━━━━━'
      );

      console.log(
        '✅ Systems initialized'
      );

      console.log(
        '🤖 Bot is fully operational'
      );

      console.log(
        '━━━━━━━━━━━━━━━━━━━━━━'
      );

    } catch (err) {

      console.error(
        '❌ Ready Event Error:',
        err
      );
    }
  }
};
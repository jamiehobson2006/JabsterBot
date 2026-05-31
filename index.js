const {

  Client,

  GatewayIntentBits,

  Collection,

  Partials,

  ActivityType,

  Options,

  PermissionFlagsBits

} = require('discord.js');

const fs =
  require('fs');

const path =
  require('path');

require('dotenv').config();

require('./database');

const {

  startGiveawayLoop

} = require('./utils/giveaways/giveawayLoop');

const {
  loadGuildInvites
} = require('./utils/giveaways/cache');

const socialMonitor =
  require('./utils/socialMonitor');

// ==================================================
// 🔐 TOKEN CHECK
// ==================================================
if (!process.env.TOKEN) {

  throw new Error(
    '❌ TOKEN missing in .env'
  );
}

// ==================================================
// 🏗 BUILD INFO
// ==================================================
const BOT_BUILD =
  'Ticket System v3';

// ==================================================
// 🤖 CLIENT
// ==================================================
const client =
  new Client({

    intents: [

      GatewayIntentBits.Guilds,

      GatewayIntentBits.GuildMembers,

      GatewayIntentBits.GuildMessages,

      GatewayIntentBits.MessageContent,

      GatewayIntentBits.GuildModeration,

      GatewayIntentBits.GuildMessageReactions,

      GatewayIntentBits.GuildVoiceStates,

      GatewayIntentBits.GuildPresences,

      GatewayIntentBits.GuildInvites
    ],

    partials: [

      Partials.Message,

      Partials.Channel,

      Partials.User,

      Partials.Reaction,

      Partials.GuildMember
    ],

    makeCache:
      Options.cacheWithLimits({

        MessageManager: 200,

        PresenceManager: 50
      }),

    sweepers: {

      messages: {

        interval: 300,

        lifetime: 600
      },

      users: {

        interval: 3600,

        filter: () =>
          user => user.bot
      }
    }
  });

// ==================================================
// 📦 COMMAND COLLECTION
// ==================================================
client.commands =
  new Collection();

// ==================================================
// 📂 SAFE FILES
// ==================================================
function getJsFiles(
  folderPath
) {

  try {

    if (
      !fs.existsSync(
        folderPath
      )
    ) {

      return [];
    }

    return fs.readdirSync(
      folderPath
    )

      .filter(file =>
        file.endsWith('.js')
      );

  } catch (err) {

    console.error(
      `Failed reading folder ${folderPath}:`,
      err
    );

    return [];
  }
}

// ==================================================
// 📦 LOAD COMMANDS
// ==================================================
function loadCommands() {

  const commandsPath =
    path.join(
      __dirname,
      'commands'
    );

  if (
    !fs.existsSync(
      commandsPath
    )
  ) {

    console.warn(
      '⚠️ Commands folder missing'
    );

    return;
  }

  const folders =
    fs.readdirSync(
      commandsPath
    );

  let loaded = 0;

  let failed = 0;

  for (
    const folder of folders
  ) {

    const folderPath =
      path.join(
        commandsPath,
        folder
      );

    // ==========================================
    // 🚫 SKIP NON-FOLDERS
    // ==========================================
    if (

      !fs.statSync(
        folderPath
      ).isDirectory()
    ) {

      continue;
    }

    const files =
      getJsFiles(
        folderPath
      );

    for (
      const file of files
    ) {

      try {

        const filePath =
          path.join(
            folderPath,
            file
          );

        delete require.cache[
          require.resolve(
            filePath
          )
        ];

        const command =
          require(filePath);

        // ======================================
        // 🛡 VALIDATION
        // ======================================
        if (

          !command ||

          !command.data ||

          !command.execute
        ) {

          console.warn(

            `⚠️ Skipped invalid command ${file}`
          );

          failed++;

          continue;
        }

        // ======================================
        // 🚫 DUPLICATE
        // ======================================
        if (

          client.commands.has(
            command.data.name
          )
        ) {

          console.warn(

            `⚠️ Duplicate command skipped: ${command.data.name}`
          );

          failed++;

          continue;
        }

        client.commands.set(

          command.data.name,

          command
        );

        loaded++;

        console.log(

          `✅ Loaded command /${command.data.name}`
        );

      } catch (err) {

        failed++;

        console.error(

          `❌ Failed loading command ${file}:`,

          err
        );
      }
    }
  }

  console.log(
    `✅ Loaded ${loaded} commands`
  );

  if (
    failed > 0
  ) {

    console.log(
      `⚠️ Failed ${failed} command(s)`
    );
  }
}

// ==================================================
// 📂 LOAD EVENTS
// ==================================================
function loadEvents() {

  const eventsPath =
    path.join(
      __dirname,
      'events'
    );

  if (
    !fs.existsSync(
      eventsPath
    )
  ) {

    console.warn(
      '⚠️ Events folder missing'
    );

    return;
  }

  const files =
    getJsFiles(
      eventsPath
    );

  let loaded = 0;

  let failed = 0;

  for (
    const file of files
  ) {

    try {

      const filePath =
        path.join(
          eventsPath,
          file
        );

      delete require.cache[
        require.resolve(
          filePath
        )
      ];

      const event =
        require(filePath);

      // ========================================
      // 🛡 VALIDATION
      // ========================================
      if (

        !event ||

        !event.name ||

        !event.execute
      ) {

        console.warn(

          `⚠️ Invalid event ${file}`
        );

        failed++;

        continue;
      }

      // ========================================
      // 📡 REGISTER
      // ========================================
      if (event.once) {

        client.once(

          event.name,

          (...args) =>

            event.execute(
              ...args,
              client
            )
        );

      } else {

        client.on(

          event.name,

          (...args) =>

            event.execute(
              ...args,
              client
            )
        );
      }

      loaded++;

      console.log(
        `✅ Loaded event ${event.name}`
      );

    } catch (err) {

      failed++;

      console.error(

        `❌ Failed loading event ${file}:`,

        err
      );
    }
  }

  console.log(
    `✅ Loaded ${loaded} events`
  );

  if (
    failed > 0
  ) {

    console.log(
      `⚠️ Failed ${failed} event(s)`
    );
  }
}

// ==================================================
// 🚀 READY
// ==================================================
client.once(

  'clientReady',

  async () => {

    try {

      console.log('━━━━━━━━━━━━━━━━━━━━━━');

      console.log(

        `✅ Logged in as ${client.user.tag}`
      );

      console.log(
        `🏗 Build: ${BOT_BUILD}`
      );

      console.log(

        `🌍 Servers: ${client.guilds.cache.size}`
      );

      console.log(

        `👥 Users: ${client.users.cache.size}`
      );

      console.log(

        `📦 Commands: ${client.commands.size}`
      );

      console.log(
        '━━━━━━━━━━━━━━━━━━━━━━'
      );

      // ======================================
      // ⏳ STARTUP DELAY
      // ======================================
      await new Promise(
        resolve =>

          setTimeout(
            resolve,
            3000
          )
      );

      // ======================================
      // 📨 LOAD INVITES
      // ======================================
      console.log(
        '📨 Loading invite cache...'
      );

      let cachedGuilds = 0;

      for (
        const guild of
        client.guilds.cache.values()
      ) {

        try {

          const me =
            guild.members.me;

          if (

            !me ||

            !me.permissions.has(
               PermissionFlagsBits.ManageGuild
            )
          ) {

            continue;
          }

          await loadGuildInvites(
            guild
          );

          cachedGuilds++;

        } catch (err) {

          console.error(

            `Failed caching invites for ${guild.name}:`,

            err
          );
        }
      }

      console.log(

        `✅ Invite cache loaded for ${cachedGuilds} guild(s)`
      );

     startGiveawayLoop(
  client
);

console.log(
  '✅ Giveaway loop started'
);

socialMonitor.start(
  client
);

console.log(
  '✅ Social monitor started'
);

      console.log(
        '✅ Giveaway loop started'
      );

      // ======================================
      // 🎮 BOT ACTIVITY
      // ======================================
      client.user.setPresence({

        activities: [

          {
            name: 'games made by JabsterStudios on roblox',
            type: ActivityType.Playing
          }
        ],

        status: 'online'
      });

      console.log(
        '✅ Systems initialized'
      );

    } catch (err) {

      console.error(
        'Ready event error:',
        err
      );
    }
  }
);

// ==================================================
// ❌ GLOBAL ERROR HANDLING
// ==================================================
process.on(

  'unhandledRejection',

  err => {

    console.error(
      '❌ Unhandled Rejection:',
      err
    );
  }
);

process.on(

  'uncaughtException',

  err => {

    console.error(
      '❌ Uncaught Exception:',
      err
    );
  }
);

// ==================================================
// 🛑 GRACEFUL SHUTDOWN
// ==================================================
async function shutdown(
  signal
) {

  console.log(
    `🛑 ${signal} received`
  );

  try {

    await client.destroy();

  } catch {}

  process.exit(0);
}

process.on(
  'SIGINT',
  () => shutdown('SIGINT')
);

process.on(
  'SIGTERM',
  () => shutdown('SIGTERM')
);

// ==================================================
// 🔧 INIT
// ==================================================
loadCommands();

loadEvents();

// ==================================================
// 🔑 LOGIN
// ==================================================
client.login(
  process.env.TOKEN
);

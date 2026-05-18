const {

  Client,

  GatewayIntentBits,

  Collection,

  Partials,

  ActivityType

} = require('discord.js');

const fs = require('fs');
const path = require('path');

require('dotenv').config();

const {
  all,
  run
} = require('./database');

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
const client = new Client({

  intents: [

    GatewayIntentBits.Guilds,

    GatewayIntentBits.GuildMembers,

    GatewayIntentBits.GuildMessages,

    GatewayIntentBits.MessageContent,

    GatewayIntentBits.GuildModeration,

    GatewayIntentBits.GuildMessageReactions,

    GatewayIntentBits.GuildVoiceStates,

    GatewayIntentBits.GuildPresences
  ],

  partials: [

    Partials.Message,

    Partials.Channel,

    Partials.User,

    Partials.Reaction
  ],

  sweepers: {

    messages: {

      interval: 300,

      lifetime: 600
    },

    users: {

      interval: 3600,

      filter: () => user => user.bot
    }
  }
});

// ==================================================
// 📦 COMMAND COLLECTION
// ==================================================
client.commands =
  new Collection();

// ==================================================
// 📦 LOAD COMMANDS
// ==================================================
function loadCommands() {

  const commandsPath =
    path.join(__dirname, 'commands');

  if (
    !fs.existsSync(commandsPath)
  ) {

    console.warn(
      '⚠️ Commands folder missing'
    );

    return;
  }

  const folders =
    fs.readdirSync(commandsPath);

  let loaded = 0;

  for (const folder of folders) {

    const folderPath =
      path.join(commandsPath, folder);

    const files =
      fs.readdirSync(folderPath)

        .filter(f =>
          f.endsWith('.js')
        );

    for (const file of files) {

      try {

        const filePath =
          path.join(folderPath, file);

        delete require.cache[
          require.resolve(filePath)
        ];

        const command =
          require(filePath);

        if (
          !command.data ||
          !command.execute
        ) {

          console.warn(
            `⚠️ Skipped invalid command ${file}`
          );

          continue;
        }

        client.commands.set(
          command.data.name,
          command
        );

        loaded++;

      } catch (err) {

        console.error(

          `❌ Failed loading ${file}:`,

          err
        );
      }
    }
  }

  console.log(
    `✅ Loaded ${loaded} commands`
  );
}

// ==================================================
// 📂 LOAD EVENTS
// ==================================================
function loadEvents() {

  const eventsPath =
    path.join(__dirname, 'events');

  if (
    !fs.existsSync(eventsPath)
  ) {

    console.warn(
      '⚠️ Events folder missing'
    );

    return;
  }

  const files =
    fs.readdirSync(eventsPath)

      .filter(f =>
        f.endsWith('.js')
      );

  let loaded = 0;

  for (const file of files) {

    try {

      const filePath =
        path.join(eventsPath, file);

      delete require.cache[
        require.resolve(filePath)
      ];

      const event =
        require(filePath);

      if (
        !event.name ||
        !event.execute
      ) {

        console.warn(
          `⚠️ Invalid event ${file}`
        );

        continue;
      }

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

    } catch (err) {

      console.error(

        `❌ Failed loading event ${file}:`,

        err
      );
    }
  }

  console.log(
    `✅ Loaded ${loaded} events`
  );
}

// ==================================================
// 🚀 READY
// ==================================================
client.once(

  'clientReady',

  async () => {

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

    console.log('━━━━━━━━━━━━━━━━━━━━━━');

    // ==========================================
    // ⏳ STARTUP DELAY
    // ==========================================
    await new Promise(res =>
      setTimeout(res, 3000)
    );

    // ==========================================
    // 🎮 PRESENCE
    // ==========================================
    client.user.setPresence({

      activities: [

        {

          name:
            'tickets & moderation',

          type:
            ActivityType.Watching
        }
      ],

      status: 'online'
    });

    console.log(
      '✅ Systems initialized'
    );
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
process.on('SIGINT', () => {

  console.log(
    '🛑 Shutting down bot...'
  );

  client.destroy();

  process.exit(0);
});

process.on('SIGTERM', () => {

  console.log(
    '🛑 Process terminated'
  );

  client.destroy();

  process.exit(0);
});

// ==================================================
// 🔧 INIT
// ==================================================
loadCommands();

loadEvents();

// ==================================================
// 🔑 LOGIN
// ==================================================
client.login(process.env.TOKEN);
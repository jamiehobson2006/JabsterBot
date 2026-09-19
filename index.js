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

const {
  initDatabase,
  startDatabaseCleanup,
  startDatabaseBackups,
  checkpointDatabase
} = require('./database');

initDatabase();
startDatabaseCleanup();
startDatabaseBackups();

const {

  startGiveawayLoop

} = require('./utils/giveaways/giveawayLoop');

const {
  loadGuildInvites
} = require('./utils/giveaways/cache');

const socialMonitor =
  require('./utils/socialMonitor');

const freeGameMonitor =
  require('./utils/freeGames');

const {
  startPollService
} = require('./utils/polls');

const StaffListService =
  require('./services/StaffListService');

const StaffRotaService =
  require('./services/StaffRotaService');

const LevelingService =
  require('./utils/LevelingService');

const {
  startClosedTicketCleanup
} = require('./utils/tickets/closedTicketCleanup');

const {
  startTicketTargetLoop
} = require('./utils/ticketTargets');

const {
  cleanupTempVoiceRooms
} = require('./utils/tempVoice');

const DailyFactService =
  require('./services/DailyFactService');

const {
  DailyInteractionService
} = require('./services/DailyInteractionService');

const {
  TicketSlaService
} = require('./services/TicketSlaService');

const {
  startFeedbackPublisher
} = require('./utils/ticketFeedback');

const {
  recoverStaleSuggestionReviews
} = require('./utils/suggestions/recovery');

const {
  recoverStaleApplicationReviews
} = require('./utils/tickets/applicationReview');

const {
  recoverStaleDailyFactReviews
} = require('./events/dailyFactInteractions');

if (!process.env.TOKEN) {

  throw new Error(
    '❌ TOKEN missing in .env'
  );
}

const BOT_BUILD =
  'Ticket System v3';

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

      GatewayIntentBits.GuildScheduledEvents,

      GatewayIntentBits.GuildPresences,

      GatewayIntentBits.GuildInvites,
      GatewayIntentBits.GuildExpressions,
      GatewayIntentBits.DirectMessages
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

let shuttingDown = false;

function shutdown(signal, exitCode = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.log(`Received ${signal}; saving database before shutdown.`);

  try {
    checkpointDatabase();
  } catch (err) {
    console.error('Database checkpoint during shutdown failed:', err);
  }

  client.destroy();
  process.exit(exitCode);
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

client.commands =
  new Collection();

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

    throw err;
  }
}

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
    throw new Error('Commands folder is missing; startup aborted.');
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

        command.category =
          command.category ||
          folder;

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
    throw new Error(`Failed to load ${failed} command(s); startup aborted.`);
  }
}

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
    throw new Error('Events folder is missing; startup aborted.');
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

      const invoke = (...args) => {
        Promise.resolve(event.execute(...args, client)).catch(err => {
          console.error(`Event error (${event.name} from ${file}):`, err);
        });
      };

      if (event.once) {

        client.once(

          event.name,

          invoke
        );

      } else {

        client.on(

          event.name,

          invoke
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
    throw new Error(`Failed to load ${failed} event(s); startup aborted.`);
  }
}

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

      await new Promise(
        resolve =>

          setTimeout(
            resolve,
            3000
          )
      );

      const recoveredSuggestions = recoverStaleSuggestionReviews();
      const recoveredApplications = recoverStaleApplicationReviews();
      const recoveredFacts = recoverStaleDailyFactReviews();
      if (recoveredSuggestions || recoveredApplications || recoveredFacts) {
        console.log(
          `Recovered interrupted reviews: ${recoveredSuggestions} suggestion(s), ` +
          `${recoveredApplications} application(s), ${recoveredFacts} daily fact(s)`
        );
      }

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

          const inviteCache =
            await loadGuildInvites(
            guild
          );

          if (inviteCache) {

            cachedGuilds++;
          }

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

freeGameMonitor.start(
  client
);

console.log(
  '✅ Free game watch started'
);

DailyFactService.start(
  client
);

console.log(
  '✅ Daily Fact Service Started'
);

DailyInteractionService.start(
  client
);

console.log(
  '✅ Daily Interaction Service Started'
);

TicketSlaService.start(
  client
);

console.log(
  '✅ Ticket SLA service started'
);

startFeedbackPublisher(
  client
);

console.log(
  '✅ Ticket feedback publisher started'
);

startPollService(
  client
);

console.log(
  '✅ Poll service started'
);

StaffListService.start(
  client
);

StaffRotaService.start(client);

LevelingService.start(client);

console.log(
  '✅ Staff list and rota services started'
);

startClosedTicketCleanup(
  client
);

console.log(
  '✅ Closed ticket cleanup started'
);

startTicketTargetLoop(
  client
);

cleanupTempVoiceRooms(client)
  .catch(err => console.error('Temporary voice cleanup error:', err));

console.log(
  '✅ Ticket targets and temporary voice recovery started'
);

      client.user.setPresence({

        activities: [

          {
            name: 'games made by Jabster Studios on Roblox',
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

process.on(

  'unhandledRejection',

  err => {

    console.error(
      '❌ Unhandled Rejection:',
      err
    );

    // A rejected API request should be logged, not take every scheduled system offline.
    // Individual command and service handlers already surface their own failures.
  }
);

process.on(

  'uncaughtException',

  err => {

    console.error(
      '❌ Uncaught Exception:',
      err
    );

    shutdown('uncaught exception', 1);
  }
);

async function main() {
  loadCommands();
  loadEvents();
  await client.login(process.env.TOKEN);
}

main().catch(err => {
  console.error('Startup failed:', err);
  shutdown('startup failure', 1);
});

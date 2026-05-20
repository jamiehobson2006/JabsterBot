require('dotenv').config();

const fs =
  require('fs');

const path =
  require('path');

const {
  PermissionFlagsBits,
  REST,
  Routes
} = require('discord.js');

// ==================================================
// 🔐 ENV
// ==================================================
const TOKEN =
  process.env.TOKEN;

const CLIENT_ID =
  process.env.CLIENT_ID;

const DEV_GUILD_ID =
  process.env.DEV_GUILD_ID || null;

// ==================================================
// 🛡 ENV VALIDATION
// ==================================================
if (!TOKEN) {

  throw new Error(
    '❌ TOKEN missing in .env'
  );
}

if (!CLIENT_ID) {

  throw new Error(
    '❌ CLIENT_ID missing in .env'
  );
}

// ==================================================
// 📡 DEBUG
// ==================================================
console.log('━━━━━━━━━━━━━━━━━━━━━━');

console.log(
  '🚀 Deploying Commands'
);

console.log('━━━━━━━━━━━━━━━━━━━━━━');

console.log(
  'Client ID:',
  CLIENT_ID
);

console.log(
  'Mode:',
  DEV_GUILD_ID
    ? 'Development'
    : 'Global'
);

if (DEV_GUILD_ID) {

  console.log(
    'Dev Guild:',
    DEV_GUILD_ID
  );
}

console.log('━━━━━━━━━━━━━━━━━━━━━━');

// ==================================================
// 🔐 DEFAULT PERMISSIONS
// ==================================================
const permissionDefaults = {

  // ==============================================
  // 🔨 MODERATION
  // ==============================================
  ban:
    PermissionFlagsBits.BanMembers,

  unban:
    PermissionFlagsBits.BanMembers,

  kick:
    PermissionFlagsBits.KickMembers,

  mute:
    PermissionFlagsBits.ModerateMembers,

  unmute:
    PermissionFlagsBits.ModerateMembers,

  warn:
    PermissionFlagsBits.ModerateMembers,

  warnings:
    PermissionFlagsBits.ModerateMembers,

  clearwarns:
    PermissionFlagsBits.ModerateMembers,

  case:
    PermissionFlagsBits.ManageGuild,

  cases:
    PermissionFlagsBits.ManageGuild,

  history:
    PermissionFlagsBits.ManageGuild,

  editcase:
    PermissionFlagsBits.ManageGuild,

  modlogs:
    PermissionFlagsBits.ManageGuild,

  modlogremove:
    PermissionFlagsBits.ManageGuild,

  purge:
    PermissionFlagsBits.ManageMessages,

  role:
    PermissionFlagsBits.ManageRoles,

  slowmode:
    PermissionFlagsBits.ManageChannels,

  lock:
    PermissionFlagsBits.ManageChannels,

  unlock:
    PermissionFlagsBits.ManageChannels,

  poll:
    PermissionFlagsBits.ManageMessages,

  // ==============================================
  // 🎟 TICKETS
  // ==============================================
  setmodlogs:
    PermissionFlagsBits.ManageGuild,

  suggestchannel:
    PermissionFlagsBits.ManageGuild,

  setadminrole:
    PermissionFlagsBits.Administrator,

  setstaffrole:
    PermissionFlagsBits.Administrator,

  setgiveawayrole:
    PermissionFlagsBits.Administrator,

  setticketchannel:
    PermissionFlagsBits.Administrator,

  settranscriptchannel:
    PermissionFlagsBits.Administrator,

  ticketpanel:
    PermissionFlagsBits.Administrator,

  ticketsetup:
    PermissionFlagsBits.Administrator,

  ticketpanelv3:
    PermissionFlagsBits.Administrator,

  ticketdebug:
    PermissionFlagsBits.Administrator,

  ticketstats:
    PermissionFlagsBits.Administrator,

  // ==============================================
  // 🎉 GIVEAWAYS
  // ==============================================
  giveaway:
    PermissionFlagsBits.ManageGuild,

  greroll:
    PermissionFlagsBits.ManageGuild,

  gend:
    PermissionFlagsBits.ManageGuild,

  gdelete:
    PermissionFlagsBits.ManageGuild,

  glist:
    PermissionFlagsBits.ManageGuild,

  gstats:
    PermissionFlagsBits.ManageGuild,

  ginfo:
    PermissionFlagsBits.ManageGuild,

  gblacklist:
    PermissionFlagsBits.ManageGuild,

  gunblacklist:
    PermissionFlagsBits.ManageGuild,

  // ==============================================
  // 📨 INVITES
  // ==============================================
  invites:
    PermissionFlagsBits.ManageGuild,

  invitetop:
    PermissionFlagsBits.ManageGuild,

  setinvitechannel:
    PermissionFlagsBits.ManageGuild
};

// ==================================================
// 📦 COMMAND STORAGE
// ==================================================
const commands = [];

const loadedNames =
  new Set();

const failedCommands =
  [];

// ==================================================
// 📂 COMMANDS PATH
// ==================================================
const foldersPath =
  path.join(
    __dirname,
    'commands'
  );

// ==================================================
// 🚫 MISSING FOLDER
// ==================================================
if (
  !fs.existsSync(
    foldersPath
  )
) {

  throw new Error(
    '❌ Commands folder missing'
  );
}

// ==================================================
// 📂 LOAD COMMAND FOLDERS
// ==================================================
const commandFolders =
  fs.readdirSync(
    foldersPath
  );

for (
  const folder of commandFolders
) {

  const commandsPath =
    path.join(
      foldersPath,
      folder
    );

  // ==============================================
  // 🚫 SKIP NON-FOLDERS
  // ==============================================
  if (

    !fs.statSync(
      commandsPath
    ).isDirectory()
  ) {

    continue;
  }

  // ==============================================
  // 📂 COMMAND FILES
  // ==============================================
  const commandFiles =
    fs.readdirSync(
      commandsPath
    )

      .filter(file =>
        file.endsWith('.js')
      );

  for (
    const file of commandFiles
  ) {

    try {

      const filePath =
        path.join(
          commandsPath,
          file
        );

      // ==========================================
      // 🧹 CLEAR CACHE
      // ==========================================
      delete require.cache[
        require.resolve(
          filePath
        )
      ];

      const command =
        require(filePath);

      // ==========================================
      // 🛡 VALIDATION
      // ==========================================
      if (

        !command ||

        !command.data ||

        !command.execute
      ) {

        console.warn(

          `⚠️ Invalid command skipped: ${file}`
        );

        failedCommands.push(file);

        continue;
      }

      // ==========================================
      // 🧠 JSON
      // ==========================================
      const commandJson =
        command.data.toJSON();

      // ==========================================
      // 🚫 INVALID NAME
      // ==========================================
      if (
        !commandJson.name
      ) {

        console.warn(

          `⚠️ Missing command name: ${file}`
        );

        failedCommands.push(file);

        continue;
      }

      // ==========================================
      // 🚫 DUPLICATES
      // ==========================================
      if (

        loadedNames.has(
          commandJson.name
        )
      ) {

        console.warn(

          `⚠️ Duplicate command skipped: ${commandJson.name}`
        );

        failedCommands.push(
          commandJson.name
        );

        continue;
      }

      loadedNames.add(
        commandJson.name
      );

      // ==========================================
      // 🔐 DEFAULT PERMISSIONS
      // ==========================================
      const defaultPermission =
        permissionDefaults[
          commandJson.name
        ];

      if (
        defaultPermission !== undefined
      ) {

        commandJson.default_member_permissions =
          defaultPermission.toString();
      }

      // ==========================================
      // 🚫 DM DISABLED DEFAULT
      // ==========================================
      if (
        command.dmPermission === false
      ) {

        commandJson.dm_permission =
          false;
      }

      // ==========================================
      // 📦 STORE
      // ==========================================
      commands.push(
        commandJson
      );

      console.log(

        `✅ Loaded /${commandJson.name}`
      );

    } catch (err) {

      console.error(

        `❌ Failed loading command ${file}:`,

        err
      );

      failedCommands.push(
        file
      );
    }
  }
}

// ==================================================
// 🚫 NO COMMANDS
// ==================================================
if (
  !commands.length
) {

  throw new Error(
    '❌ No commands loaded.'
  );
}

// ==================================================
// 📊 SUMMARY
// ==================================================
console.log('━━━━━━━━━━━━━━━━━━━━━━');

console.log(
  `📦 Loaded Commands: ${commands.length}`
);

console.log(
  `❌ Failed Commands: ${failedCommands.length}`
);

if (
  failedCommands.length
) {

  console.log(
    'Failed:',
    failedCommands.join(', ')
  );
}

console.log('━━━━━━━━━━━━━━━━━━━━━━');

// ==================================================
// 🚀 REST CLIENT
// ==================================================
const rest =
  new REST({

    version: '10'

  }).setToken(TOKEN);

// ==================================================
// 🚀 DEPLOY
// ==================================================
(async () => {

  try {

    console.log('━━━━━━━━━━━━━━━━━━━━━━');

    console.log(

      `📦 Deploying ${commands.length} commands...`
    );

    // ==========================================
    // ⚡ DEVELOPMENT MODE
    // ==========================================
    if (DEV_GUILD_ID) {

      console.log(
        '🧹 Clearing old guild commands...'
      );

      await rest.put(

        Routes.applicationGuildCommands(

          CLIENT_ID,

          DEV_GUILD_ID
        ),

        {

          body: []
        }
      );

      console.log(
        '✅ Old guild commands cleared'
      );

      console.log(
        '⚡ Deploying guild commands...'
      );

      await rest.put(

        Routes.applicationGuildCommands(

          CLIENT_ID,

          DEV_GUILD_ID
        ),

        {

          body: commands
        }
      );

      console.log(

        `✅ Commands deployed to guild ${DEV_GUILD_ID}`
      );
    }

    // ==========================================
    // 🌍 GLOBAL MODE
    // ==========================================
    else {

      console.log(
        '🌍 Clearing old global commands...'
      );

      await rest.put(

        Routes.applicationCommands(
          CLIENT_ID
        ),

        {

          body: []
        }
      );

      console.log(
        '✅ Old global commands cleared'
      );

      console.log(
        '🌍 Deploying global commands...'
      );

      await rest.put(

        Routes.applicationCommands(
          CLIENT_ID
        ),

        {

          body: commands
        }
      );

      console.log(
        '✅ Global commands deployed'
      );
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━');

    console.log(
      '✅ Deploy complete'
    );

    console.log('━━━━━━━━━━━━━━━━━━━━━━');

  } catch (error) {

    console.error(
      '❌ Deploy Error:',
      error
    );
  }

})();
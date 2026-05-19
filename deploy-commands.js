require('dotenv').config();

const fs = require('fs');
const path = require('path');

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
// 🛡 SAFETY CHECKS
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
console.log('🚀 Deploying Commands');
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

  modlogs:
    PermissionFlagsBits.ManageGuild,

  history:
    PermissionFlagsBits.ManageGuild,

  editcase:
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

  ticketstats:
    PermissionFlagsBits.Administrator
};

// ==================================================
// 📦 LOAD COMMANDS
// ==================================================
const commands = [];

const loadedNames =
  new Set();

const foldersPath =
  path.join(
    __dirname,
    'commands'
  );

const commandFolders =
  fs.readdirSync(
    foldersPath
  );

for (const folder of commandFolders) {

  const commandsPath =
    path.join(
      foldersPath,
      folder
    );

  const commandFiles =
    fs.readdirSync(
      commandsPath
    )

      .filter(file =>
        file.endsWith('.js')
      );

  for (const file of commandFiles) {

    try {

      const filePath =
        path.join(
          commandsPath,
          file
        );

      delete require.cache[
        require.resolve(filePath)
      ];

      const command =
        require(filePath);

      // ==========================================
      // 🛡 VALIDATION
      // ==========================================
      if (
        !command.data ||
        !command.execute
      ) {

        console.warn(
          `⚠️ Invalid command skipped: ${file}`
        );

        continue;
      }

      const commandJson =
        command.data.toJSON();

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
    }
  }
}

// ==================================================
// 🚫 NO COMMANDS
// ==================================================
if (!commands.length) {

  throw new Error(
    '❌ No commands loaded.'
  );
}

// ==================================================
// 🚀 REST
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

      // 🧹 Clear old global commands
      console.log(
        '🧹 Clearing old global commands...'
      );

      await rest.put(

        Routes.applicationCommands(
          CLIENT_ID
        ),

        { body: [] }
      );

      console.log(
        '✅ Old global commands cleared'
      );

      // 🚀 Deploy guild commands
      console.log(
        '⚡ Deploying guild commands...'
      );

      await rest.put(

        Routes.applicationGuildCommands(

          CLIENT_ID,

          DEV_GUILD_ID
        ),

        { body: commands }
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
        '🌍 Deploying global commands...'
      );

      await rest.put(

        Routes.applicationCommands(
          CLIENT_ID
        ),

        { body: commands }
      );

      console.log(
        '✅ Global commands deployed'
      );
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━');

  } catch (error) {

    console.error(
      '❌ Deploy Error:',
      error
    );
  }

})();
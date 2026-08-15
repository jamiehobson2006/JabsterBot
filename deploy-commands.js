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

const TOKEN =
  process.env.TOKEN;

const CLIENT_ID =
  process.env.CLIENT_ID;

const guildCommandCleanupIds =
  [
    process.env.DEV_GUILD_ID,
    process.env.GUILD_ID,
    ...(process.env.LEGACY_GUILD_IDS || '')
      .split(',')
      .map(id => id.trim())
  ].filter(Boolean);

if (!TOKEN) {
  throw new Error('TOKEN missing in .env');
}

if (!CLIENT_ID) {
  throw new Error('CLIENT_ID missing in .env');
}

const permissionDefaults = {
  ban: PermissionFlagsBits.BanMembers,
  unban: PermissionFlagsBits.BanMembers,
  kick: PermissionFlagsBits.KickMembers,
  mute: PermissionFlagsBits.ModerateMembers,
  unmute: PermissionFlagsBits.ModerateMembers,
  warn: PermissionFlagsBits.ModerateMembers,
  warnings: PermissionFlagsBits.ModerateMembers,
  clearwarns: PermissionFlagsBits.ModerateMembers,
  case: PermissionFlagsBits.ManageGuild,
  cases: PermissionFlagsBits.ManageGuild,
  history: PermissionFlagsBits.ManageGuild,
  editcase: PermissionFlagsBits.ManageGuild,
  modlogs: PermissionFlagsBits.ManageGuild,
  modlogremove: PermissionFlagsBits.ManageGuild,
  purge: PermissionFlagsBits.ManageMessages,
  role: PermissionFlagsBits.ManageRoles,
  slowmode: PermissionFlagsBits.ManageChannels,
  lock: PermissionFlagsBits.ManageChannels,
  unlock: PermissionFlagsBits.ManageChannels,
  poll: PermissionFlagsBits.ManageMessages,
  setmodlogs: PermissionFlagsBits.ManageGuild,
  suggestchannel: PermissionFlagsBits.ManageGuild,
  suggestionmanager: PermissionFlagsBits.Administrator,
  verification: PermissionFlagsBits.Administrator,
  reactionrole: PermissionFlagsBits.Administrator,
  greetings: PermissionFlagsBits.Administrator,
  setadminrole: PermissionFlagsBits.Administrator,
  setstaffrole: PermissionFlagsBits.Administrator,
  setgiveawayrole: PermissionFlagsBits.Administrator,
  setticketchannel: PermissionFlagsBits.Administrator,
  settranscriptchannel: PermissionFlagsBits.Administrator,
  linkblock: PermissionFlagsBits.ManageGuild,
  ticketpanel: PermissionFlagsBits.Administrator,
  ticketsetup: PermissionFlagsBits.Administrator,
  ticketpanelv3: PermissionFlagsBits.Administrator,
  ticketdebug: PermissionFlagsBits.Administrator,
  ticketstats: PermissionFlagsBits.Administrator,
  ticketfeedback: PermissionFlagsBits.Administrator,
  stafflist: PermissionFlagsBits.Administrator,
  giveaway: PermissionFlagsBits.ManageGuild,
  greroll: PermissionFlagsBits.ManageGuild,
  gend: PermissionFlagsBits.ManageGuild,
  gdelete: PermissionFlagsBits.ManageGuild,
  glist: PermissionFlagsBits.ManageGuild,
  gstats: PermissionFlagsBits.ManageGuild,
  ginfo: PermissionFlagsBits.ManageGuild,
  gblacklist: PermissionFlagsBits.ManageGuild,
  gunblacklist: PermissionFlagsBits.ManageGuild,
  invites: PermissionFlagsBits.ManageGuild,
  invitetop: PermissionFlagsBits.ManageGuild,
  setinvitechannel: PermissionFlagsBits.ManageGuild,
  dailyfact: PermissionFlagsBits.ManageGuild,
  leveling: PermissionFlagsBits.ManageGuild,
  levelreward: PermissionFlagsBits.ManageGuild,
  socialadd: PermissionFlagsBits.ManageGuild,
  socialremove: PermissionFlagsBits.ManageGuild
};

async function getGuildCommandCleanupIds(rest) {

  const ids =
    new Set(guildCommandCleanupIds);

  try {

    const guilds =
      await rest.get(
        Routes.userGuilds()
      );

    for (const guild of guilds) {

      if (guild?.id) {
        ids.add(guild.id);
      }
    }

  } catch (err) {

    console.warn(
      'Could not fetch current bot guilds for guild-command cleanup:',
      err.message
    );
  }

  return [...ids];
}

function loadCommands() {

  const commands = [];
  const loadedNames = new Set();
  const failedCommands = [];
  const foldersPath =
    path.join(__dirname, 'commands');

  if (!fs.existsSync(foldersPath)) {
    throw new Error('Commands folder missing');
  }

  const commandFolders =
    fs.readdirSync(foldersPath);

  for (const folder of commandFolders) {

    const commandsPath =
      path.join(foldersPath, folder);

    if (!fs.statSync(commandsPath).isDirectory()) {
      continue;
    }

    const commandFiles =
      fs.readdirSync(commandsPath)
        .filter(file => file.endsWith('.js'));

    for (const file of commandFiles) {

      const filePath =
        path.join(commandsPath, file);

      try {

        delete require.cache[
          require.resolve(filePath)
        ];

        const command =
          require(filePath);

        if (
          !command ||
          !command.data ||
          !command.execute
        ) {

          console.warn(`Skipped invalid command file: ${file}`);
          failedCommands.push(file);
          continue;
        }

        const commandJson =
          command.data.toJSON();

        if (!commandJson.name) {

          console.warn(`Skipped command with missing name: ${file}`);
          failedCommands.push(file);
          continue;
        }

        if (loadedNames.has(commandJson.name)) {

          console.warn(`Skipped duplicate command: ${commandJson.name}`);
          failedCommands.push(commandJson.name);
          continue;
        }

        loadedNames.add(commandJson.name);

        const defaultPermission =
          permissionDefaults[commandJson.name];

        if (defaultPermission !== undefined) {

          commandJson.default_member_permissions =
            defaultPermission.toString();
        }

        if (command.dmPermission === false) {
          commandJson.dm_permission = false;
        }

        commands.push(commandJson);

      } catch (err) {

        console.error(
          `Failed loading command ${file}:`,
          err
        );

        failedCommands.push(file);
      }
    }
  }

  if (!commands.length) {
    throw new Error('No commands loaded.');
  }

  return {
    commands,
    failedCommands
  };
}

async function deploy() {

  const {
    commands,
    failedCommands
  } = loadCommands();

  console.log('Deploying Discord slash commands');
  console.log(`Mode: Global`);
  console.log(`Loaded commands: ${commands.length}`);
  console.log(`Failed commands: ${failedCommands.length}`);

  if (failedCommands.length) {
    console.log(`Failed: ${failedCommands.join(', ')}`);
  }

  const rest =
    new REST({
      version: '10'
    }).setToken(TOKEN);

  const cleanupGuildIds =
    await getGuildCommandCleanupIds(rest);

  if (!cleanupGuildIds.length) {
    console.log(
      'No guild command cleanup targets found'
    );
  }

  for (const guildId of cleanupGuildIds) {

    console.log(`Clearing guild commands for ${guildId}`);

    await rest.put(

      Routes.applicationGuildCommands(
        CLIENT_ID,
        guildId
      ),

      {
        body: []
      }
    );
  }

  console.log(`Deploying ${commands.length} global commands`);

  const result =
    await Promise.race([

      rest.put(

        Routes.applicationCommands(
          CLIENT_ID
        ),

        {
          body: commands
        }
      ),

      new Promise((_, reject) =>
        setTimeout(
          () => reject(
            new Error('Deploy timed out after 30 seconds')
          ),
          30000
        )
      )
    ]);

  console.log(
    `Discord returned ${result.length} global commands`
  );

  console.log('Deploy complete');
}

deploy().catch(error => {

  console.error('Deploy error:');
  console.error(error);

  if (error.rawError) {
    console.error(
      'Raw error:',
      JSON.stringify(error.rawError, null, 2)
    );
  }

  if (error.errors) {
    console.error(
      'Validation errors:',
      JSON.stringify(error.errors, null, 2)
    );
  }

  process.exit(1);
});

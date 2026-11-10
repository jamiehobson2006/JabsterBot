require('./utils/safeLogging').installSafeLogging();
require('dotenv').config();

const {
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
  const registry = require('./utils/commandRegistry').loadCommandRegistry({ fresh: true });
  return { commands: registry.definitions, failedCommands: [] };
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
    throw new Error(
      `Deployment aborted because command loading failed: ${failedCommands.join(', ')}`
    );
  }
  require('./utils/commandValidation').validateGlobalCommands(commands);

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

    try {
      await rest.put(
        Routes.applicationGuildCommands(CLIENT_ID, guildId),
        { body: [] }
      );
    } catch (error) {
      console.warn(`Could not clear guild commands for ${guildId}: ${error.message}`);
    }
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

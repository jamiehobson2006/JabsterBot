require('dotenv').config(); // ✅ make sure this is FIRST

const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');

// 🔐 CONFIG
const TOKEN = process.env.TOKEN || 'YOUR_BOT_TOKEN';

// ✅ YOUR CLIENT ID ADDED HERE
const CLIENT_ID = process.env.CLIENT_ID || '1497394527571415181';

// ⚡ DEV MODE
const GUILD_ID = process.env.GUILD_ID || null;

// 🔍 DEBUG (VERY IMPORTANT)
console.log('CLIENT_ID:', CLIENT_ID);
console.log('TOKEN LOADED:', !!TOKEN);

// ❌ Safety check
if (!TOKEN || TOKEN === 'YOUR_BOT_TOKEN') {
  throw new Error('❌ TOKEN is missing or invalid');
}

if (!CLIENT_ID || CLIENT_ID === 'YOUR_CLIENT_ID') {
  throw new Error('❌ CLIENT_ID is missing');
}

// ========================
// 📦 LOAD COMMANDS
// ========================
const commands = [];

const foldersPath = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(foldersPath);

for (const folder of commandFolders) {
  const commandsPath = path.join(foldersPath, folder);
  const commandFiles = fs
    .readdirSync(commandsPath)
    .filter(file => file.endsWith('.js'));

  for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);

    if ('data' in command && 'execute' in command) {
      commands.push(command.data.toJSON());
    } else {
      console.warn(`⚠️ Missing "data" or "execute" in ${file}`);
    }
  }
}

// ========================
// 🚀 DEPLOY
// ========================
const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  try {
    console.log(`🔄 Deploying ${commands.length} commands...`);

    if (GUILD_ID) {
      await rest.put(
        Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
        { body: commands }
      );

      console.log(`✅ Commands deployed to guild ${GUILD_ID}`);
    } else {
      await rest.put(
        Routes.applicationCommands(CLIENT_ID),
        { body: commands }
      );

      console.log(`✅ Global commands deployed`);
    }

  } catch (error) {
    console.error('❌ Deploy error:', error);
  }
})();
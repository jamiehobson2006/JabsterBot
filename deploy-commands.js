require('dotenv').config(); // âœ… make sure this is FIRST

const fs = require('fs');
const path = require('path');
const { PermissionFlagsBits, REST, Routes } = require('discord.js');

// ðŸ” CONFIG
const TOKEN = process.env.TOKEN || process.env.Token || 'YOUR_BOT_TOKEN';

// âœ… YOUR CLIENT ID ADDED HERE
const CLIENT_ID = process.env.CLIENT_ID || '1497394527571415181';

// âš¡ DEV MODE
const GUILD_ID = process.env.GUILD_ID || null;

// ðŸ” DEBUG (VERY IMPORTANT)
console.log('CLIENT_ID:', CLIENT_ID);
console.log('TOKEN LOADED:', !!TOKEN);

// âŒ Safety check
if (!TOKEN || TOKEN === 'YOUR_BOT_TOKEN') {
  throw new Error('âŒ TOKEN is missing or invalid');
}

if (!CLIENT_ID || CLIENT_ID === 'YOUR_CLIENT_ID') {
  throw new Error('âŒ CLIENT_ID is missing');
}

// ========================
// ðŸ“¦ LOAD COMMANDS
// ========================
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
  modlogs: PermissionFlagsBits.ManageGuild,
  history: PermissionFlagsBits.ManageGuild,
  editcase: PermissionFlagsBits.ManageGuild,
  modlogremove: PermissionFlagsBits.ManageGuild,
  purge: PermissionFlagsBits.ManageMessages,
  role: PermissionFlagsBits.ManageRoles,
  slowmode: PermissionFlagsBits.ManageChannels,
  lock: PermissionFlagsBits.ManageChannels,
  unlock: PermissionFlagsBits.ManageChannels,
  poll: PermissionFlagsBits.ManageMessages,
  setmodlogs: PermissionFlagsBits.ManageGuild,
  suggestchannel: PermissionFlagsBits.ManageGuild,
  setadminrole: PermissionFlagsBits.Administrator,
  setstaffrole: PermissionFlagsBits.Administrator,
  setgiveawayrole: PermissionFlagsBits.Administrator,
  setticketchannel: PermissionFlagsBits.Administrator,
  settranscriptchannel: PermissionFlagsBits.Administrator,
  ticketpanel: PermissionFlagsBits.Administrator,
  ticketstats: PermissionFlagsBits.Administrator,
};

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
            const commandJson = command.data.toJSON();
      const defaultPermission = permissionDefaults[commandJson.name];
      if (defaultPermission !== undefined) {
        commandJson.default_member_permissions = defaultPermission.toString();
      }
      commands.push(commandJson);
    } else {
      console.warn(`âš ï¸ Missing "data" or "execute" in ${file}`);
    }
  }
}

// ========================
// ðŸš€ DEPLOY
// ========================
const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  try {
    console.log(`ðŸ”„ Deploying ${commands.length} commands...`);

    if (GUILD_ID) {
      await rest.put(
        Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
        { body: commands }
      );

      console.log(`âœ… Commands deployed to guild ${GUILD_ID}`);
    } else {
      await rest.put(
        Routes.applicationCommands(CLIENT_ID),
        { body: commands }
      );

      console.log(`âœ… Global commands deployed`);
    }

  } catch (error) {
    console.error('âŒ Deploy error:', error);
  }
})();


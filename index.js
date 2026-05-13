const { Client, GatewayIntentBits, Collection, Partials } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const { all, run } = require('./database');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.User
  ]
});

// ========================
// 📦 COMMANDS
// ========================
client.commands = new Collection();

function loadCommands() {
  const commandsPath = path.join(__dirname, 'commands');

  if (!fs.existsSync(commandsPath)) return;

  const folders = fs.readdirSync(commandsPath);

  for (const folder of folders) {
    const folderPath = path.join(commandsPath, folder);
    const files = fs.readdirSync(folderPath).filter(f => f.endsWith('.js'));

    for (const file of files) {
      try {
        const filePath = path.join(folderPath, file);

        delete require.cache[require.resolve(filePath)];

        const command = require(filePath);

        if (!command.data || !command.execute) {
          console.log(`⚠️ Skipped ${file}`);
          continue;
        }

        client.commands.set(command.data.name, command);

      } catch (err) {
        console.error(`❌ Failed loading ${file}:`, err);
      }
    }
  }

  console.log(`✅ Loaded ${client.commands.size} commands`);
}

// ========================
// 📂 EVENTS
// ========================
function loadEvents() {
  const eventsPath = path.join(__dirname, 'events');

  if (!fs.existsSync(eventsPath)) return;

  const files = fs.readdirSync(eventsPath).filter(f => f.endsWith('.js'));

  for (const file of files) {
    try {
      const filePath = path.join(eventsPath, file);

      delete require.cache[require.resolve(filePath)];

      const event = require(filePath);

      if (!event.name || !event.execute) continue;

      if (event.once) {
        client.once(event.name, (...args) => event.execute(...args, client));
      } else {
        client.on(event.name, (...args) => event.execute(...args, client));
      }

    } catch (err) {
      console.error(`❌ Failed loading event ${file}:`, err);
    }
  }

  console.log(`✅ Loaded ${files.length} events`);
}

// ========================
// 🔊 AUTO UNMUTE SYSTEM
// ========================
function startMuteLoop() {
  setInterval(async () => {
    try {
      const now = Date.now();

      const expired = all(
        `SELECT * FROM mutes WHERE endTime <= ? LIMIT 50`,
        [now]
      );

      if (!expired.length) return;

      for (const mute of expired) {
        const guild = client.guilds.cache.get(mute.guildId);
        if (!guild) continue;

        const member = await guild.members.fetch(mute.userId).catch(() => null);
        const role = guild.roles.cache.find(r => r.name === 'Muted');

        if (member && role && member.roles.cache.has(role.id)) {
          await member.roles.remove(role).catch(() => {});
        }

        run(
          `DELETE FROM mutes WHERE guildId=? AND userId=?`,
          [mute.guildId, mute.userId]
        );
      }

      console.log(`🔊 Processed ${expired.length} expired mutes`);

    } catch (err) {
      console.error('❌ Auto-unmute error:', err);
    }
  }, 15000);
}

// ========================
// 🚀 READY
// ========================
client.once('clientReady', async () => {
  console.log(`🚀 Logged in as ${client.user.tag}`);

  await new Promise(res => setTimeout(res, 3000));

  console.log('✅ Systems initialized');

  startMuteLoop();
});

// ========================
// ❌ GLOBAL ERROR HANDLING
// ========================
process.on('unhandledRejection', err => {
  console.error('❌ Unhandled Promise Rejection:', err);
});

process.on('uncaughtException', err => {
  console.error('❌ Uncaught Exception:', err);
});

// ========================
// 🔧 INIT
// ========================
loadCommands();
loadEvents();

// ========================
// 🔑 LOGIN
// ========================
client.login(process.env.TOKEN);
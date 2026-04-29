require('dotenv').config();

const { REST, Routes } = require('discord.js');
const fs = require('fs');

const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;
const token = process.env.TOKEN;

// ========================
// 📦 LOAD COMMANDS
// ========================
const commands = [];
const folders = fs.readdirSync('./commands');

for (const folder of folders) {
  const files = fs.readdirSync(`./commands/${folder}`)
    .filter(file => file.endsWith('.js'));

  for (const file of files) {
    try {
      const command = require(`./commands/${folder}/${file}`);

      if (!command.data) {
        console.log(`⚠️ Skipped ${file} (no .data)`);
        continue;
      }

      const json = command.data.toJSON();
      commands.push(json);

      console.log(`✅ Loaded ${json.name}`);

    } catch (err) {
      console.error(`❌ Failed loading ${file}:`, err);
    }
  }
}

console.log(`\n📦 Total commands: ${commands.length}`);

// ========================
// 🚀 DEPLOY (FAST + CLEAN)
// ========================
(async () => {
  try {
    if (!clientId || !guildId || !token) {
      console.error('❌ Missing CLIENT_ID, GUILD_ID, or TOKEN in .env');
      return;
    }

    const rest = new REST({ version: '10', timeout: 15000 }).setToken(token);

    console.log('\n🚀 Deploying commands...\n');

    const data = await rest.put(
      Routes.applicationGuildCommands(clientId, guildId),
      { body: commands }
    );

    console.log(`✅ SUCCESS: ${data.length} commands deployed`);

  } catch (err) {
    console.error('❌ Deploy failed:', err);
  }
})();
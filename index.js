require('dotenv').config();

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  PermissionsBitField,
} = require('discord.js');

const Database = require('better-sqlite3');
const db = new Database('./database.db');

// ✅ Performance + stability
db.pragma('journal_mode = WAL');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
});

// ✅ FIXED DATABASE FUNCTIONS (SYNC)
function run(sql, params = []) {
  return db.prepare(sql).run(params);
}

function get(sql, params = []) {
  return db.prepare(sql).get(params);
}

function all(sql, params = []) {
  return db.prepare(sql).all(params);
}

const legacyGuildId = process.env.GUILD_ID || 'legacy';

async function initDatabase() {
  run(`CREATE TABLE IF NOT EXISTS warns (
    guildId TEXT NOT NULL,
    userId TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guildId, userId)
  )`);

  run(`CREATE TABLE IF NOT EXISTS mutes (
    guildId TEXT NOT NULL,
    userId TEXT NOT NULL,
    endTime INTEGER NOT NULL,
    PRIMARY KEY (guildId, userId)
  )`);

  run(`CREATE TABLE IF NOT EXISTS cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guildId TEXT NOT NULL,
    userId TEXT NOT NULL,
    moderatorId TEXT NOT NULL,
    action TEXT NOT NULL,
    reason TEXT NOT NULL,
    timestamp INTEGER NOT NULL
  )`);
}

// ---------------- BASIC COMMANDS (TEST CORE WORKING FIRST) ----------------

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === 'ping') {
      await interaction.reply(`Pong! ${client.ws.ping}ms`);
    }

    if (interaction.commandName === 'game') {
      await interaction.reply({
        content: 'Play Endless Summer Simulator:\nhttps://www.roblox.com/games/130906696817438/Endless-Summer-Simulator',
      });
    }

    if (interaction.commandName === 'warn') {
      if (!interaction.memberPermissions.has(PermissionsBitField.Flags.ModerateMembers)) {
        return interaction.reply({ content: 'No permission.', ephemeral: true });
      }

      const user = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason') || 'No reason provided';

      run(
        `INSERT INTO warns (guildId, userId, count)
         VALUES (?, ?, 1)
         ON CONFLICT(guildId, userId)
         DO UPDATE SET count = count + 1`,
        [interaction.guild.id, user.id]
      );

      const result = run(
        `INSERT INTO cases (guildId, userId, moderatorId, action, reason, timestamp)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [interaction.guild.id, user.id, interaction.user.id, 'WARN', reason, Date.now()]
      );

      await interaction.reply(`Warned ${user.tag} | Case #${result.lastInsertRowid}`);
    }

    if (interaction.commandName === 'modlogs') {
      const rows = all(
        `SELECT * FROM cases WHERE guildId = ? ORDER BY id DESC LIMIT 10`,
        [interaction.guild.id]
      );

      if (!rows.length) {
        return interaction.reply({ content: 'No logs found.', ephemeral: true });
      }

      const embed = new EmbedBuilder()
        .setTitle('Mod Logs')
        .setColor('Blurple');

      for (const row of rows) {
        embed.addFields({
          name: `Case #${row.id} | ${row.action}`,
          value: `User: <@${row.userId}>\nModerator: <@${row.moderatorId}>\nReason: ${row.reason}`,
        });
      }

      await interaction.reply({ embeds: [embed], ephemeral: true });
    }

  } catch (err) {
    console.error(err);
    if (interaction.replied) {
      await interaction.followUp({ content: 'Error occurred.', ephemeral: true });
    } else {
      await interaction.reply({ content: 'Error occurred.', ephemeral: true });
    }
  }
});

// ---------------- START ----------------

async function main() {
  if (!process.env.TOKEN) {
    throw new Error('Missing TOKEN');
  }

  initDatabase();
  await client.login(process.env.TOKEN);
}

main();
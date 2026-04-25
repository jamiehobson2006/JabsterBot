require('dotenv').config();

const {
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
} = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('game')
    .setDescription('Get the Endless Summer Simulator game link.'),

  new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Warn a server member.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((option) => option
      .setName('user')
      .setDescription('The member to warn.')
      .setRequired(true))
    .addStringOption((option) => option
      .setName('reason')
      .setDescription('Why this warning is being issued.')),

  new SlashCommandBuilder()
    .setName('modlogs')
    .setDescription('Show moderation logs with reasons, moderators, and dates.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((option) => option
      .setName('user')
      .setDescription('Only show logs for this user.'))
    .addStringOption((option) => option
      .setName('action')
      .setDescription('Only show this type of moderation log.')
      .addChoices(
        { name: 'Warns', value: 'WARN' },
        { name: 'Mutes', value: 'MUTE' },
        { name: 'Unmutes', value: 'UNMUTE' },
        { name: 'Kicks', value: 'KICK' },
        { name: 'Bans', value: 'BAN' },
        { name: 'Unbans', value: 'UNBAN' },
        { name: 'Clears', value: 'CLEAR' },
        { name: 'Slowmode', value: 'SLOWMODE' },
        { name: 'Locks', value: 'LOCK' },
        { name: 'Unlocks', value: 'UNLOCK' },
      ))
    .addIntegerOption((option) => option
      .setName('limit')
      .setDescription('How many logs to show.')
      .setMinValue(1)
      .setMaxValue(25)),

  new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Temporarily mute a server member.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((option) => option
      .setName('user')
      .setDescription('The member to mute.')
      .setRequired(true))
    .addStringOption((option) => option
      .setName('duration')
      .setDescription('Duration, such as 10s, 5m, 1h, or 1d.')
      .setRequired(true))
    .addStringOption((option) => option
      .setName('reason')
      .setDescription('Why this mute is being issued.')),

  new SlashCommandBuilder()
    .setName('unmute')
    .setDescription('Remove a member mute.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((option) => option
      .setName('user')
      .setDescription('The member to unmute.')
      .setRequired(true)),

  new SlashCommandBuilder()
    .setName('case')
    .setDescription('View a moderation case.')
    .addIntegerOption((option) => option
      .setName('id')
      .setDescription('The case ID.')
      .setRequired(true)
      .setMinValue(1)),

  new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Delete recent messages from this channel.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption((option) => option
      .setName('amount')
      .setDescription('How many messages to delete.')
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(100)),

  new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a server member.')
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption((option) => option
      .setName('user')
      .setDescription('The member to kick.')
      .setRequired(true))
    .addStringOption((option) => option
      .setName('reason')
      .setDescription('Why this kick is being issued.')),

  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a user from the server.')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption((option) => option
      .setName('user')
      .setDescription('The user to ban.')
      .setRequired(true))
    .addIntegerOption((option) => option
      .setName('delete_days')
      .setDescription('How many days of messages to delete.')
      .setMinValue(0)
      .setMaxValue(7))
    .addStringOption((option) => option
      .setName('reason')
      .setDescription('Why this ban is being issued.')),

  new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Unban a user by their Discord user ID.')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addStringOption((option) => option
      .setName('user_id')
      .setDescription('The banned user ID.')
      .setRequired(true))
    .addStringOption((option) => option
      .setName('reason')
      .setDescription('Why this unban is being issued.')),

  new SlashCommandBuilder()
    .setName('slowmode')
    .setDescription('Set slowmode for this channel.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addIntegerOption((option) => option
      .setName('seconds')
      .setDescription('Slowmode delay in seconds. Use 0 to turn it off.')
      .setRequired(true)
      .setMinValue(0)
      .setMaxValue(21600)),

  new SlashCommandBuilder()
    .setName('lock')
    .setDescription('Stop everyone from sending messages in this channel.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  new SlashCommandBuilder()
    .setName('unlock')
    .setDescription('Allow everyone to send messages in this channel again.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  new SlashCommandBuilder()
    .setName('nick')
    .setDescription('Change or clear a member nickname.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames)
    .addUserOption((option) => option
      .setName('user')
      .setDescription('The member to rename.')
      .setRequired(true))
    .addStringOption((option) => option
      .setName('nickname')
      .setDescription('New nickname. Leave blank to clear it.')
      .setMaxLength(32)),

  new SlashCommandBuilder()
    .setName('avatar')
    .setDescription('Show a user avatar.')
    .addUserOption((option) => option
      .setName('user')
      .setDescription('The user to show.')),

  new SlashCommandBuilder()
    .setName('userinfo')
    .setDescription('Show useful information about a user.')
    .addUserOption((option) => option
      .setName('user')
      .setDescription('The user to show.')),

  new SlashCommandBuilder()
    .setName('serverinfo')
    .setDescription('Show useful information about this server.'),

  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check the bot latency.'),

  new SlashCommandBuilder()
    .setName('uptime')
    .setDescription('Show how long the bot has been online.'),

  new SlashCommandBuilder()
    .setName('poll')
    .setDescription('Create a reaction poll.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addStringOption((option) => option
      .setName('question')
      .setDescription('The poll question.')
      .setRequired(true)
      .setMaxLength(250))
    .addStringOption((option) => option
      .setName('option1')
      .setDescription('First option.')
      .setRequired(true)
      .setMaxLength(100))
    .addStringOption((option) => option
      .setName('option2')
      .setDescription('Second option.')
      .setRequired(true)
      .setMaxLength(100))
    .addStringOption((option) => option
      .setName('option3')
      .setDescription('Third option.')
      .setMaxLength(100))
    .addStringOption((option) => option
      .setName('option4')
      .setDescription('Fourth option.')
      .setMaxLength(100)),

  new SlashCommandBuilder()
    .setName('say')
    .setDescription('Make the bot send a message in this channel.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addStringOption((option) => option
      .setName('message')
      .setDescription('The message to send.')
      .setRequired(true)
      .setMaxLength(1800)),

  new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Send an announcement embed to a channel.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((option) => option
      .setName('channel')
      .setDescription('Where to send the announcement.')
      .setRequired(true))
    .addStringOption((option) => option
      .setName('title')
      .setDescription('Announcement title.')
      .setRequired(true)
      .setMaxLength(250))
    .addStringOption((option) => option
      .setName('message')
      .setDescription('Announcement message.')
      .setRequired(true)
      .setMaxLength(2000)),

  new SlashCommandBuilder()
    .setName('servericon')
    .setDescription('Show this server icon.'),

  new SlashCommandBuilder()
    .setName('roleinfo')
    .setDescription('Show useful information about a role.')
    .addRoleOption((option) => option
      .setName('role')
      .setDescription('The role to inspect.')
      .setRequired(true)),

  new SlashCommandBuilder()
    .setName('membercount')
    .setDescription('Show the server member count.'),

  new SlashCommandBuilder()
    .setName('invite')
    .setDescription('Get the bot invite link.'),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show the interactive command help menu.')
    .addStringOption((option) => option
      .setName('category')
      .setDescription('Open a specific help category.')
      .addChoices(
        { name: 'Moderation', value: 'moderation' },
        { name: 'Economy', value: 'economy' },
        { name: 'Fun', value: 'fun' },
        { name: 'Utility', value: 'utility' },
        { name: 'Suggestions', value: 'suggestions' },
        { name: 'Social Alerts', value: 'social' },
      )),

  new SlashCommandBuilder()
    .setName('suggest')
    .setDescription('Send a suggestion to the suggestions channel.')
    .addStringOption((option) => option
      .setName('suggestion')
      .setDescription('Your suggestion.')
      .setRequired(true)
      .setMaxLength(1000)),

  new SlashCommandBuilder()
    .setName('suggestaccept')
    .setDescription('Mark a suggestion as accepted.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((option) => option
      .setName('message_id')
      .setDescription('The suggestion message ID.')
      .setRequired(true))
    .addStringOption((option) => option
      .setName('reason')
      .setDescription('Why this suggestion was accepted.')
      .setMaxLength(1000)),

  new SlashCommandBuilder()
    .setName('suggestdeny')
    .setDescription('Mark a suggestion as denied.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((option) => option
      .setName('message_id')
      .setDescription('The suggestion message ID.')
      .setRequired(true))
    .addStringOption((option) => option
      .setName('reason')
      .setDescription('Why this suggestion was denied.')
      .setMaxLength(1000)),

  new SlashCommandBuilder()
    .setName('suggestconsider')
    .setDescription('Mark a suggestion as being considered.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((option) => option
      .setName('message_id')
      .setDescription('The suggestion message ID.')
      .setRequired(true))
    .addStringOption((option) => option
      .setName('reason')
      .setDescription('Why this suggestion is being considered.')
      .setMaxLength(1000)),

  new SlashCommandBuilder()
    .setName('8ball')
    .setDescription('Ask the magic 8 ball a question.')
    .addStringOption((option) => option
      .setName('question')
      .setDescription('Your question.')
      .setRequired(true)
      .setMaxLength(300)),

  new SlashCommandBuilder()
    .setName('coinflip')
    .setDescription('Flip a coin.'),

  new SlashCommandBuilder()
    .setName('roll')
    .setDescription('Roll a dice.')
    .addIntegerOption((option) => option
      .setName('sides')
      .setDescription('How many sides the dice has.')
      .setMinValue(2)
      .setMaxValue(1000)),

  new SlashCommandBuilder()
    .setName('rate')
    .setDescription('Rate anything from 0 to 100.')
    .addStringOption((option) => option
      .setName('thing')
      .setDescription('What should I rate?')
      .setRequired(true)
      .setMaxLength(200)),

  new SlashCommandBuilder()
    .setName('ship')
    .setDescription('Check the match percentage between two users.')
    .addUserOption((option) => option
      .setName('first')
      .setDescription('The first user.')
      .setRequired(true))
    .addUserOption((option) => option
      .setName('second')
      .setDescription('The second user.')
      .setRequired(true)),

  new SlashCommandBuilder()
    .setName('joke')
    .setDescription('Tell a random joke.'),

  new SlashCommandBuilder()
    .setName('compliment')
    .setDescription('Give someone a compliment.')
    .addUserOption((option) => option
      .setName('user')
      .setDescription('Who should get the compliment?')),

  new SlashCommandBuilder()
    .setName('roast')
    .setDescription('Give someone a playful roast.')
    .addUserOption((option) => option
      .setName('user')
      .setDescription('Who should get roasted?')),

  new SlashCommandBuilder()
    .setName('choose')
    .setDescription('Choose one option from a comma-separated list.')
    .addStringOption((option) => option
      .setName('choices')
      .setDescription('Example: pizza, burgers, tacos')
      .setRequired(true)
      .setMaxLength(500)),

  new SlashCommandBuilder()
    .setName('reverse')
    .setDescription('Reverse text.')
    .addStringOption((option) => option
      .setName('text')
      .setDescription('Text to reverse.')
      .setRequired(true)
      .setMaxLength(1000)),

  new SlashCommandBuilder()
    .setName('meme')
    .setDescription('Send a random meme.'),

  new SlashCommandBuilder()
    .setName('cat')
    .setDescription('Send a random cat picture.'),

  new SlashCommandBuilder()
    .setName('dog')
    .setDescription('Send a random dog picture.'),

  new SlashCommandBuilder()
    .setName('fox')
    .setDescription('Send a random fox picture.'),

  new SlashCommandBuilder()
    .setName('duck')
    .setDescription('Send a random duck picture.'),

  new SlashCommandBuilder()
    .setName('fact')
    .setDescription('Send a random fact.')
    .addStringOption((option) => option
      .setName('kind')
      .setDescription('Choose a fact type.')
      .addChoices(
        { name: 'Random', value: 'random' },
        { name: 'Cat', value: 'cat' },
        { name: 'Dog', value: 'dog' },
      )),

  new SlashCommandBuilder()
    .setName('balance')
    .setDescription('Check your coin balance or someone else\'s.')
    .addUserOption((option) => option
      .setName('user')
      .setDescription('The user to check.')),

  new SlashCommandBuilder()
    .setName('transactions')
    .setDescription('Show recent economy balance changes.')
    .addUserOption((option) => option
      .setName('user')
      .setDescription('The user to check.'))
    .addIntegerOption((option) => option
      .setName('limit')
      .setDescription('How many transactions to show.')
      .setMinValue(1)
      .setMaxValue(20)),

  new SlashCommandBuilder()
    .setName('daily')
    .setDescription('Claim your daily economy reward.'),

  new SlashCommandBuilder()
    .setName('work')
    .setDescription('Work once per hour to earn coins.'),

  new SlashCommandBuilder()
    .setName('pay')
    .setDescription('Pay coins to another user.')
    .addUserOption((option) => option
      .setName('user')
      .setDescription('The user to pay.')
      .setRequired(true))
    .addIntegerOption((option) => option
      .setName('amount')
      .setDescription('How many coins to pay.')
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(1000000)),

  new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Show the richest users in this server.'),

  new SlashCommandBuilder()
    .setName('coinbet')
    .setDescription('Bet coins on heads or tails.')
    .addStringOption((option) => option
      .setName('guess')
      .setDescription('Heads or tails?')
      .setRequired(true)
      .addChoices(
        { name: 'Heads', value: 'heads' },
        { name: 'Tails', value: 'tails' },
      ))
    .addIntegerOption((option) => option
      .setName('amount')
      .setDescription('How many coins to bet.')
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(100000)),

  new SlashCommandBuilder()
    .setName('ecoadd')
    .setDescription('Add coins to a user.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption((option) => option
      .setName('user')
      .setDescription('The user receiving coins.')
      .setRequired(true))
    .addIntegerOption((option) => option
      .setName('amount')
      .setDescription('How many coins to add.')
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(1000000)),

  new SlashCommandBuilder()
    .setName('ecoremove')
    .setDescription('Remove coins from a user.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption((option) => option
      .setName('user')
      .setDescription('The user losing coins.')
      .setRequired(true))
    .addIntegerOption((option) => option
      .setName('amount')
      .setDescription('How many coins to remove.')
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(1000000)),

  new SlashCommandBuilder()
    .setName('slots')
    .setDescription('Bet coins on a slot machine.')
    .addIntegerOption((option) => option
      .setName('amount')
      .setDescription('How many coins to bet.')
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(100000)),

  new SlashCommandBuilder()
    .setName('dicebet')
    .setDescription('Guess a dice roll for a 5x payout.')
    .addIntegerOption((option) => option
      .setName('guess')
      .setDescription('Pick a number from 1 to 6.')
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(6))
    .addIntegerOption((option) => option
      .setName('amount')
      .setDescription('How many coins to bet.')
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(100000)),

  new SlashCommandBuilder()
    .setName('roulette')
    .setDescription('Bet coins on roulette.')
    .addStringOption((option) => option
      .setName('choice')
      .setDescription('Pick a color.')
      .setRequired(true)
      .addChoices(
        { name: 'Red', value: 'red' },
        { name: 'Black', value: 'black' },
        { name: 'Green', value: 'green' },
      ))
    .addIntegerOption((option) => option
      .setName('amount')
      .setDescription('How many coins to bet.')
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(100000)),

  new SlashCommandBuilder()
    .setName('scratch')
    .setDescription('Buy a scratch card.')
    .addIntegerOption((option) => option
      .setName('amount')
      .setDescription('How many coins the card costs.')
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(100000)),

  new SlashCommandBuilder()
    .setName('highlow')
    .setDescription('Bet whether a number will be high or low.')
    .addStringOption((option) => option
      .setName('guess')
      .setDescription('High is 51-100, low is 1-50.')
      .setRequired(true)
      .addChoices(
        { name: 'High', value: 'high' },
        { name: 'Low', value: 'low' },
      ))
    .addIntegerOption((option) => option
      .setName('amount')
      .setDescription('How many coins to bet.')
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(100000)),

  new SlashCommandBuilder()
    .setName('beg')
    .setDescription('Beg for a few free coins.'),

  new SlashCommandBuilder()
    .setName('crime')
    .setDescription('Risk getting caught for a chance to earn coins.'),

  new SlashCommandBuilder()
    .setName('lottery')
    .setDescription('Buy a lottery ticket for a chance at 10x payout.')
    .addIntegerOption((option) => option
      .setName('amount')
      .setDescription('How many coins to spend on the ticket.')
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(100000)),

  new SlashCommandBuilder()
    .setName('fight')
    .setDescription('Fight another user, optionally for a coin wager.')
    .addUserOption((option) => option
      .setName('user')
      .setDescription('Who do you want to fight?')
      .setRequired(true))
    .addIntegerOption((option) => option
      .setName('amount')
      .setDescription('Optional coins to wager.')
      .setMinValue(1)
      .setMaxValue(100000)),

  new SlashCommandBuilder()
    .setName('modlogremove')
    .setDescription('Remove one case from the moderation logs.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption((option) => option
      .setName('case_id')
      .setDescription('The case number to remove.')
      .setRequired(true)
      .setMinValue(1)),

  new SlashCommandBuilder()
    .setName('socialadd')
    .setDescription('Add a YouTube or Twitch alert.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((option) => option
      .setName('type')
      .setDescription('What should this alert watch?')
      .setRequired(true)
      .addChoices(
        { name: 'YouTube Video', value: 'youtube_video' },
        { name: 'YouTube Short', value: 'youtube_short' },
        { name: 'YouTube Stream', value: 'youtube_stream' },
        { name: 'Twitch Stream', value: 'twitch_stream' },
      ))
    .addStringOption((option) => option
      .setName('source')
      .setDescription('YouTube channel/URL/RSS, or Twitch username/URL.')
      .setRequired(true)
      .setMaxLength(500))
    .addChannelOption((option) => option
      .setName('channel')
      .setDescription('Where should the alert be sent?')
      .setRequired(true))
    .addRoleOption((option) => option
      .setName('role')
      .setDescription('Optional role to ping.')),

  new SlashCommandBuilder()
    .setName('sociallist')
    .setDescription('List configured social alerts.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('socialedit')
    .setDescription('Edit an existing social alert.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption((option) => option
      .setName('id')
      .setDescription('The social alert ID to edit.')
      .setRequired(true)
      .setMinValue(1))
    .addStringOption((option) => option
      .setName('source')
      .setDescription('New YouTube/Twitch source link, channel ID, or username.')
      .setMaxLength(500))
    .addChannelOption((option) => option
      .setName('channel')
      .setDescription('New Discord channel for this alert.'))
    .addRoleOption((option) => option
      .setName('role')
      .setDescription('New role to ping.'))
    .addBooleanOption((option) => option
      .setName('clear_role')
      .setDescription('Remove the ping role from this alert.'))
    .addStringOption((option) => option
      .setName('status')
      .setDescription('Enable or disable this alert.')
      .addChoices(
        { name: 'Enabled', value: 'enabled' },
        { name: 'Disabled', value: 'disabled' },
      )),

  new SlashCommandBuilder()
    .setName('socialremove')
    .setDescription('Remove a configured social alert.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption((option) => option
      .setName('id')
      .setDescription('The social alert ID to remove.')
      .setRequired(true)
      .setMinValue(1)),

  new SlashCommandBuilder()
    .setName('socialcheck')
    .setDescription('Manually check one social alert now.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption((option) => option
      .setName('id')
      .setDescription('The social alert ID to check.')
      .setRequired(true)
      .setMinValue(1)),
].map((command) => command.toJSON());

async function main() {
  const { CLIENT_ID, GUILD_ID, TOKEN } = process.env;

  if (!CLIENT_ID || !TOKEN) {
    throw new Error('Missing CLIENT_ID or TOKEN in your .env file.');
  }

  const rest = new REST({ version: '10' }).setToken(TOKEN);

  if (GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log(`Deployed ${commands.length} guild command(s).`);
    return;
  }

  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  console.log(`Deployed ${commands.length} global command(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

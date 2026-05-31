require('dotenv').config();

const { REST } = require('discord.js');

const rest = new REST({
  version: '10'
}).setToken(process.env.TOKEN);

(async () => {

  try {

    console.log(
      'Testing Discord...'
    );

    const user =
      await rest.get(
        '/users/@me'
      );

    console.log(
      'Connected as:',
      user.username
    );

  } catch (err) {

    console.error(err);
  }

})();
const axios = require('axios');

let accessToken = null;
let tokenExpires = 0;

async function getAccessToken() {

  if (
    accessToken &&
    Date.now() < tokenExpires
  ) {

    return accessToken;
  }

  const response =
    await axios.post(

      'https://id.twitch.tv/oauth2/token',

      null,

      {

        params: {

          client_id:
            process.env.TWITCH_CLIENT_ID,

          client_secret:
            process.env.TWITCH_CLIENT_SECRET,

          grant_type:
            'client_credentials'
        }
      }
    );

  accessToken =
    response.data.access_token;

  tokenExpires =
    Date.now() +
    (response.data.expires_in * 1000);

  return accessToken;
}

async function getUser(username) {

  const token =
    await getAccessToken();

  const response =
    await axios.get(

      'https://api.twitch.tv/helix/users',

      {

        headers: {

          'Client-ID':
            process.env.TWITCH_CLIENT_ID,

          Authorization:
            `Bearer ${token}`
        },

        params: {

          login: username
        }
      }
    );

  return response.data.data[0] || null;
}

async function getStream(userId) {

  const token =
    await getAccessToken();

  const response =
    await axios.get(

      'https://api.twitch.tv/helix/streams',

      {

        headers: {

          'Client-ID':
            process.env.TWITCH_CLIENT_ID,

          Authorization:
            `Bearer ${token}`
        },

        params: {

          user_id: userId
        }
      }
    );

  return response.data.data[0] || null;
}

module.exports = {

  getUser,
  getStream
};
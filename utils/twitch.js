const axios = require('axios');

const twitchApi = axios.create({ timeout: 10000 });
let accessToken = null;
let tokenExpires = 0;
let tokenRequest = null;

function configured() {
  return Boolean(
    process.env.TWITCH_CLIENT_ID?.trim() &&
    process.env.TWITCH_CLIENT_SECRET?.trim()
  );
}

async function fetchAccessToken() {
  if (!configured()) {
    throw new Error('Twitch credentials are not configured.');
  }

  const response = await twitchApi.post(
    'https://id.twitch.tv/oauth2/token',
    null,
    {
      params: {
        client_id: process.env.TWITCH_CLIENT_ID,
        client_secret: process.env.TWITCH_CLIENT_SECRET,
        grant_type: 'client_credentials'
      }
    }
  );

  accessToken = response.data.access_token;
  tokenExpires = Date.now() + Math.max(
    (Number(response.data.expires_in) * 1000) - 60000,
    60000
  );
  return accessToken;
}

async function getAccessToken(force = false) {
  if (!force && accessToken && Date.now() < tokenExpires) return accessToken;
  if (!force && tokenRequest) return tokenRequest;

  tokenRequest = fetchAccessToken().finally(() => {
    tokenRequest = null;
  });
  return tokenRequest;
}

async function helixGet(path, params, retry = true) {
  const token = await getAccessToken();

  try {
    return await twitchApi.get(`https://api.twitch.tv/helix/${path}`, {
      headers: {
        'Client-ID': process.env.TWITCH_CLIENT_ID,
        Authorization: `Bearer ${token}`
      },
      params
    });
  } catch (error) {
    if (retry && error.response?.status === 401) {
      accessToken = null;
      tokenExpires = 0;
      await getAccessToken(true);
      return helixGet(path, params, false);
    }
    throw error;
  }
}

async function getUser(username) {
  const response = await helixGet('users', { login: username });
  return response.data.data[0] || null;
}

async function getStream(userId) {
  const response = await helixGet('streams', { user_id: userId });
  return response.data.data[0] || null;
}

module.exports = {
  getUser,
  getStream
};

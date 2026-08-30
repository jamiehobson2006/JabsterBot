const axios = require('axios');

const API_KEY = process.env.YOUTUBE_API_KEY;

function isYouTubeConfigured() {
  return Boolean(API_KEY && API_KEY.trim());
}

if (!API_KEY) {
  console.warn(
    '⚠️ YOUTUBE_API_KEY missing from .env'
  );
}

// ========================================
// Get Channel By Handle or Name
// ========================================

async function getChannel(query) {

  if (!isYouTubeConfigured()) {
    return null;
  }

  try {

    const response =
      await axios.get(
        'https://www.googleapis.com/youtube/v3/search',
        {
          params: {
            part: 'snippet',
            q: query,
            type: 'channel',
            maxResults: 1,
            key: API_KEY
          }
        }
      );

    const channel =
      response.data.items?.[0];

    if (!channel) {
      return null;
    }

    return {

      id:
        channel.snippet.channelId,

      name:
        channel.snippet.title,

      thumbnail:
        channel.snippet.thumbnails?.high?.url ||

        channel.snippet.thumbnails?.default?.url
    };

  } catch (err) {

    console.error(
      'YouTube getChannel Error:',
      err.response?.data || err.message
    );

    return null;
  }
}

// ========================================
// Get Latest Upload
// ========================================

async function getLatestUpload(
  channelId
) {

  if (!isYouTubeConfigured()) {
    return null;
  }

  try {

    const response =
      await axios.get(
        'https://www.googleapis.com/youtube/v3/search',
        {
          params: {
            part: 'snippet',
            channelId,
            order: 'date',
            maxResults: 1,
            type: 'video',
            key: API_KEY
          }
        }
      );

    const video =
      response.data.items?.[0];

    if (!video) {
      return null;
    }

    return {

      videoId:
        video.id.videoId,

      title:
        video.snippet.title,

      description:
        video.snippet.description,

      publishedAt:
        video.snippet.publishedAt,

      thumbnail:
        video.snippet.thumbnails?.high?.url ||

        video.snippet.thumbnails?.default?.url
    };

  } catch (err) {

    console.error(
      'YouTube getLatestUpload Error:',
      err.response?.data || err.message
    );

    return null;
  }
}

// ========================================
// Get Video Details
// ========================================

async function getVideoDetails(
  videoId
) {

  if (!isYouTubeConfigured()) {
    return null;
  }

  try {

    const response =
      await axios.get(
        'https://www.googleapis.com/youtube/v3/videos',
        {
          params: {
            part:
              'snippet,statistics,liveStreamingDetails',
            id: videoId,
            key: API_KEY
          }
        }
      );

    const video =
      response.data.items?.[0];

    if (!video) {
      return null;
    }

    return {

      id:
        video.id,

      title:
        video.snippet.title,

      description:
        video.snippet.description,

      thumbnail:
        video.snippet.thumbnails?.high?.url ||

        video.snippet.thumbnails?.default?.url,

      views:
        Number(
          video.statistics?.viewCount || 0
        ),

      likes:
        Number(
          video.statistics?.likeCount || 0
        ),

live:
  Boolean(
    video.liveStreamingDetails
      ?.concurrentViewers
  ),

      viewers:
        Number(
          video.liveStreamingDetails
            ?.concurrentViewers || 0
        ),

        actualStartTime:
  video.liveStreamingDetails
    ?.actualStartTime || null,

actualEndTime:
  video.liveStreamingDetails
    ?.actualEndTime || null,

      publishedAt:
        video.snippet.publishedAt
    };

  } catch (err) {

    console.error(
      'YouTube getVideoDetails Error:',
      err.response?.data || err.message
    );

    return null;
  }
}

// ========================================
// Detect Upload Type
// ========================================

async function getUploadType(
  videoId
) {

  if (!isYouTubeConfigured()) {
    return 'video';
  }

  try {

    const response =
      await axios.get(
        'https://www.googleapis.com/youtube/v3/videos',
        {
          params: {
            part:
              'snippet,contentDetails,liveStreamingDetails',
            id: videoId,
            key: API_KEY
          }
        }
      );

    const video =
      response.data.items?.[0];

    if (!video) {
      return 'video';
    }

    if (
      video.liveStreamingDetails
    ) {

      return 'stream';
    }

    const duration =
      video.contentDetails.duration;

    const match =
      duration.match(
        /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/
      );

    const hours =
      Number(match?.[1] || 0);

    const minutes =
      Number(match?.[2] || 0);

    const seconds =
      Number(match?.[3] || 0);

    const totalSeconds =
      (hours * 3600) +
      (minutes * 60) +
      seconds;

    if (
      totalSeconds <= 180
    ) {

      return 'short';
    }

    return 'video';

  } catch (err) {

    console.error(
      'YouTube getUploadType Error:',
      err.response?.data || err.message
    );

    return 'video';
  }
}

module.exports = {

  isYouTubeConfigured,

  getChannel,

  getLatestUpload,

  getVideoDetails,

  getUploadType
};

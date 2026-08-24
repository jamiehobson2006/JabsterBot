const axios = require('axios');

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');

const {
  all,
  get,
  run
} = require('../database');

const {
  createAuditEmbed,
  logAudit
} = require('./logger');

const EPIC_ENDPOINT =
  'https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions';

const STEAM_ENDPOINT =
  'https://store.steampowered.com/api/featuredcategories';

const CHECK_INTERVAL = 15 * 60 * 1000;

let monitorInterval = null;
let monitorStartTimeout = null;
let checking = false;

function getFreeGameSettings(guildId) {
  return get(
    `SELECT *
     FROM free_game_settings
     WHERE guildId = ?`,
    [guildId]
  );
}

function listEnabledFreeGameSettings() {
  return all(
    `SELECT *
     FROM free_game_settings
     WHERE enabled = 1
     AND channelId IS NOT NULL
     AND channelId <> ''`
  );
}

function saveFreeGameSettings({
  guildId,
  channelId,
  pingRoleId,
  epicEnabled,
  steamEnabled,
  steamCountry,
  updatedBy
}) {
  return run(
    `INSERT INTO free_game_settings (
       guildId, enabled, channelId, pingRoleId,
       epicEnabled, steamEnabled, steamCountry, updatedBy, updatedAt
     )
     VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(guildId)
     DO UPDATE SET enabled = 1,
                   channelId = excluded.channelId,
                   pingRoleId = excluded.pingRoleId,
                   epicEnabled = excluded.epicEnabled,
                   steamEnabled = excluded.steamEnabled,
                   steamCountry = excluded.steamCountry,
                   updatedBy = excluded.updatedBy,
                   updatedAt = excluded.updatedAt`,
    [
      guildId,
      channelId,
      pingRoleId || null,
      epicEnabled ? 1 : 0,
      steamEnabled ? 1 : 0,
      String(steamCountry || 'GB').toUpperCase(),
      updatedBy,
      Date.now()
    ]
  );
}

function disableFreeGameWatch(guildId, updatedBy) {
  return run(
    `UPDATE free_game_settings
     SET enabled = 0,
         updatedBy = ?,
         updatedAt = ?
     WHERE guildId = ?`,
    [updatedBy, Date.now(), guildId]
  );
}

function normalizeEpicOffers(payload, now = Date.now()) {
  const elements = payload?.data?.Catalog?.searchStore?.elements || [];

  return elements.flatMap(offer => {
    if (offer?.offerType !== 'BASE_GAME') {
      return [];
    }

    const price = offer.price?.totalPrice;
    if (!price || Number(price.originalPrice) <= 0 || Number(price.discountPrice) !== 0) {
      return [];
    }

    const promotions = offer.promotions?.promotionalOffers || [];
    const activePromotion = promotions
      .flatMap(group => group.promotionalOffers || [])
      .find(promotion => {
        const startsAt = Date.parse(promotion.startDate || '');
        const endsAt = Date.parse(promotion.endDate || '');

        return Number.isFinite(startsAt) &&
          Number.isFinite(endsAt) &&
          startsAt <= now &&
          endsAt > now;
      });

    if (!activePromotion) {
      return [];
    }

    const slug = offer.catalogNs?.mappings?.[0]?.pageSlug ||
      offer.productSlug ||
      offer.urlSlug;

    if (!slug) {
      return [];
    }

    const image = (offer.keyImages || [])
      .find(item => [
        'OfferImageWide',
        'DieselStoreFrontWide',
        'Thumbnail'
      ].includes(item.type))?.url || null;

    const startsAt = Date.parse(activePromotion.startDate);
    const endsAt = Date.parse(activePromotion.endDate);

    return [{
      key: `epic:${offer.id}:${startsAt}`,
      source: 'EPIC',
      title: String(offer.title || 'Untitled Epic Game').slice(0, 256),
      url: `https://store.epicgames.com/en-US/p/${encodeURIComponent(slug)}`,
      image,
      originalPrice: price.fmtPrice?.originalPrice || null,
      startsAt,
      endsAt
    }];
  });
}

function formatSteamPrice(value, currency) {
  const amount = Number(value || 0) / 100;

  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: currency || 'GBP'
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency || ''}`.trim();
  }
}

function normalizeSteamOffers(payload) {
  const items = payload?.specials?.items || [];

  return items.flatMap(item => {
    if (
      Number(item?.type) !== 0 ||
      Number(item.discount_percent) !== 100 ||
      Number(item.original_price) <= 0 ||
      Number(item.final_price) !== 0 ||
      !item.id
    ) {
      return [];
    }

    const endsAt = Number(item.discount_expiration)
      ? Number(item.discount_expiration) * 1000
      : null;

    return [{
      // The history table expires after 90 days, allowing a genuine later promotion to alert again.
      key: `steam:${item.id}`,
      source: 'STEAM',
      title: String(item.name || 'Untitled Steam Game').slice(0, 256),
      url: `https://store.steampowered.com/app/${item.id}`,
      image: item.header_image || item.large_capsule_image || null,
      originalPrice: formatSteamPrice(item.original_price, item.currency),
      startsAt: null,
      endsAt
    }];
  });
}

async function fetchEpicOffers(country) {
  const response = await axios.get(EPIC_ENDPOINT, {
    params: {
      locale: 'en-US',
      country,
      allowCountries: country
    },
    timeout: 15000,
    headers: {
      'User-Agent': 'JabsterStudios-DiscordBot/1.0'
    }
  });

  return normalizeEpicOffers(response.data);
}

async function fetchSteamOffers(country) {
  const response = await axios.get(STEAM_ENDPOINT, {
    params: {
      cc: country.toLowerCase(),
      l: 'english'
    },
    timeout: 15000,
    headers: {
      'User-Agent': 'JabsterStudios-DiscordBot/1.0'
    }
  });

  return normalizeSteamOffers(response.data);
}

function reserveAnnouncement(guildId, offer) {
  return run(
    `INSERT OR IGNORE INTO free_game_announcements (
       guildId, offerKey, source, title, announcedAt
     )
     VALUES (?, ?, ?, ?, ?)`,
    [guildId, offer.key, offer.source, offer.title, Date.now()]
  ).changes === 1;
}

function releaseAnnouncement(guildId, offerKey) {
  return run(
    `DELETE FROM free_game_announcements
     WHERE guildId = ?
     AND offerKey = ?
     AND messageId IS NULL`,
    [guildId, offerKey]
  );
}

function saveAnnouncementMessage(guildId, offerKey, messageId) {
  return run(
    `UPDATE free_game_announcements
     SET messageId = ?
     WHERE guildId = ?
     AND offerKey = ?`,
    [messageId, guildId, offerKey]
  );
}

function buildOfferEmbed(offer) {
  const isEpic = offer.source === 'EPIC';
  const embed = new EmbedBuilder()
    .setColor(isEpic ? 0x9146FF : 0x1B9AAA)
    .setTitle(`Free Game Alert | ${isEpic ? 'Epic Games' : 'Steam'}`)
    .setDescription(
      `**${offer.title}** is currently free${offer.originalPrice ? ` (usually ${offer.originalPrice})` : ''}.`
    )
    .setFooter({ text: 'Jabster Studios Free Game Watch' })
    .setTimestamp();

  if (offer.endsAt) {
    embed.addFields({
      name: 'Offer Ends',
      value: `<t:${Math.floor(offer.endsAt / 1000)}:F>\n<t:${Math.floor(offer.endsAt / 1000)}:R>`,
      inline: true
    });
  }

  if (offer.image) {
    embed.setImage(offer.image);
  }

  return embed;
}

function buildOfferComponents(offer) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel(`Get it on ${offer.source === 'EPIC' ? 'Epic Games' : 'Steam'}`)
      .setURL(offer.url)
  )];
}

async function announceOffer(client, settings, offer) {
  const channel = await client.channels.fetch(settings.channelId).catch(() => null);

  if (!channel?.isTextBased()) {
    return false;
  }

  const permissions = channel.permissionsFor(channel.guild.members.me);
  if (!permissions?.has(['ViewChannel', 'SendMessages', 'EmbedLinks'])) {
    return false;
  }

  if (!reserveAnnouncement(settings.guildId, offer)) {
    return false;
  }

  try {
    const message = await channel.send({
      content: settings.pingRoleId ? `<@&${settings.pingRoleId}>` : undefined,
      embeds: [buildOfferEmbed(offer)],
      components: buildOfferComponents(offer),
      allowedMentions: settings.pingRoleId
        ? { roles: [settings.pingRoleId], parse: [] }
        : { parse: [] }
    });

    saveAnnouncementMessage(settings.guildId, offer.key, message.id);

    await logAudit(client, settings.guildId, {
      action: 'FREE_GAME_ANNOUNCED',
      executorId: client.user?.id,
      type: 'COMMANDS',
      metadata: {
        source: offer.source,
        title: offer.title,
        offerKey: offer.key,
        channelId: channel.id,
        endsAt: offer.endsAt
      },
      embed: createAuditEmbed({
        action: 'Free Game Announced',
        executor: client.user ? `${client.user.tag}\n<@${client.user.id}>` : 'Bot',
        channel: `<#${channel.id}>`,
        extra: `${offer.source}: ${offer.title}${offer.endsAt ? `\nEnds: <t:${Math.floor(offer.endsAt / 1000)}:R>` : ''}`,
        color: isNaN(offer.endsAt) ? 0x1B9AAA : 0x57F287
      })
    });

    return true;
  } catch (err) {
    releaseAnnouncement(settings.guildId, offer.key);
    console.error(`Free game announcement error for ${settings.guildId}:`, err.message);
    return false;
  }
}

async function checkFreeGames(client) {
  if (checking) {
    return;
  }

  checking = true;

  try {
    const settingsRows = listEnabledFreeGameSettings();
    const offersByCountry = new Map();

    for (const settings of settingsRows) {
      const country = String(settings.steamCountry || 'GB').toUpperCase();
      if (!offersByCountry.has(country)) {
        offersByCountry.set(country, {});
      }
    }

    for (const [country, cached] of offersByCountry) {
      const relevantSettings = settingsRows.filter(setting =>
        String(setting.steamCountry || 'GB').toUpperCase() === country
      );

      if (relevantSettings.some(setting => Number(setting.epicEnabled) === 1)) {
        try {
          cached.epic = await fetchEpicOffers(country);
        } catch (err) {
          cached.epic = [];
          console.error(`Epic free-game check failed for ${country}:`, err.message);
        }
      }

      if (relevantSettings.some(setting => Number(setting.steamEnabled) === 1)) {
        try {
          cached.steam = await fetchSteamOffers(country);
        } catch (err) {
          cached.steam = [];
          console.error(`Steam free-game check failed for ${country}:`, err.message);
        }
      }
    }

    for (const settings of settingsRows) {
      const cached = offersByCountry.get(String(settings.steamCountry || 'GB').toUpperCase()) || {};
      const offers = [
        ...(Number(settings.epicEnabled) === 1 ? cached.epic || [] : []),
        ...(Number(settings.steamEnabled) === 1 ? cached.steam || [] : [])
      ];

      for (const offer of offers) {
        await announceOffer(client, settings, offer);
      }
    }
  } finally {
    checking = false;
  }
}

function start(client) {
  if (monitorInterval || monitorStartTimeout) {
    return monitorInterval || monitorStartTimeout;
  }

  monitorStartTimeout = setTimeout(() => {
    checkFreeGames(client).catch(err => console.error('Free game monitor error:', err));
    monitorStartTimeout = null;

    monitorInterval = setInterval(() => {
      checkFreeGames(client).catch(err => console.error('Free game monitor error:', err));
    }, CHECK_INTERVAL);

    monitorInterval.unref?.();
  }, 15000);

  monitorStartTimeout.unref?.();
  return monitorStartTimeout;
}

module.exports = {
  CHECK_INTERVAL,
  announceOffer,
  buildOfferEmbed,
  checkFreeGames,
  disableFreeGameWatch,
  fetchEpicOffers,
  fetchSteamOffers,
  getFreeGameSettings,
  normalizeEpicOffers,
  normalizeSteamOffers,
  saveFreeGameSettings,
  start
};

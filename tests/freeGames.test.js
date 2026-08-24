const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempDir = fs.mkdtempSync(
  path.join(os.tmpdir(), 'jabster-studios-free-games-')
);

process.env.DATABASE_PATH = path.join(tempDir, 'database.db');

const {
  initDatabase
} = require('../database');

const {
  getFreeGameSettings,
  normalizeEpicOffers,
  normalizeSteamOffers,
  saveFreeGameSettings
} = require('../utils/freeGames');

test('Epic normalizer includes only active paid games discounted to zero', () => {
  const now = Date.parse('2026-08-24T12:00:00.000Z');
  const offers = normalizeEpicOffers({
    data: {
      Catalog: {
        searchStore: {
          elements: [
            {
              id: 'epic-free-game',
              title: 'Epic Free Game',
              offerType: 'BASE_GAME',
              productSlug: 'epic-free-game',
              keyImages: [{ type: 'OfferImageWide', url: 'https://example.com/epic.jpg' }],
              price: {
                totalPrice: {
                  originalPrice: 1999,
                  discountPrice: 0,
                  fmtPrice: { originalPrice: '£19.99' }
                }
              },
              promotions: {
                promotionalOffers: [{
                  promotionalOffers: [{
                    startDate: '2026-08-20T15:00:00.000Z',
                    endDate: '2026-08-27T15:00:00.000Z'
                  }]
                }]
              }
            },
            {
              id: 'permanent-free-game',
              title: 'Permanent Free Game',
              offerType: 'BASE_GAME',
              productSlug: 'permanent-free-game',
              price: { totalPrice: { originalPrice: 0, discountPrice: 0 } },
              promotions: { promotionalOffers: [] }
            }
          ]
        }
      }
    }
  }, now);

  assert.equal(offers.length, 1);
  assert.equal(offers[0].title, 'Epic Free Game');
  assert.equal(offers[0].source, 'EPIC');
  assert.match(offers[0].url, /epic-free-game/);
});

test('Steam normalizer excludes permanent free-to-play and non-free discounts', () => {
  const offers = normalizeSteamOffers({
    specials: {
      items: [
        {
          id: 100,
          type: 0,
          name: 'Steam Free Game',
          discount_percent: 100,
          original_price: 2499,
          final_price: 0,
          currency: 'GBP',
          discount_expiration: 1_800_000_000
        },
        {
          id: 101,
          type: 0,
          name: 'Permanent Free Game',
          discount_percent: 0,
          original_price: 0,
          final_price: 0
        },
        {
          id: 102,
          type: 0,
          name: 'Half Price Game',
          discount_percent: 50,
          original_price: 1000,
          final_price: 500
        }
      ]
    }
  });

  assert.equal(offers.length, 1);
  assert.equal(offers[0].key, 'steam:100');
  assert.equal(offers[0].originalPrice, '£24.99');
});

test('free game watch settings persist with optional role pings', () => {
  initDatabase();

  saveFreeGameSettings({
    guildId: 'guild-1',
    channelId: 'free-games',
    pingRoleId: 'deal-watchers',
    epicEnabled: true,
    steamEnabled: false,
    steamCountry: 'US',
    updatedBy: 'admin-1'
  });

  const settings = getFreeGameSettings('guild-1');
  assert.equal(settings.enabled, 1);
  assert.equal(settings.channelId, 'free-games');
  assert.equal(settings.pingRoleId, 'deal-watchers');
  assert.equal(settings.epicEnabled, 1);
  assert.equal(settings.steamEnabled, 0);
  assert.equal(settings.steamCountry, 'US');
});

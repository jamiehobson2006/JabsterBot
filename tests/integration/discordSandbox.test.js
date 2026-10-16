const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { REST, Routes } = require('discord.js');

const token = process.env.DISCORD_SANDBOX_TOKEN;
const channelId = process.env.DISCORD_SANDBOX_CHANNEL_ID;
const guildId = process.env.DISCORD_SANDBOX_GUILD_ID;
const enabled = Boolean(token && channelId && guildId);

test('Discord sandbox sends, deduplicates, fetches, edits, and deletes a rich message', {
  skip: enabled ? false : 'Set DISCORD_SANDBOX_TOKEN, DISCORD_SANDBOX_CHANNEL_ID, and DISCORD_SANDBOX_GUILD_ID.',
  timeout: 45000
}, async () => {
  const rest = new REST({ version: '10', timeout: 10000, retries: 1 }).setToken(token);
  const channel = await rest.get(Routes.channel(channelId));
  assert.equal(channel.guild_id, guildId, 'The channel must belong to the configured sandbox guild.');

  const created = new Set();
  try {
    const body = {
      content: 'Jabster Studios integration test',
      nonce: crypto.randomBytes(12).toString('hex'),
      enforce_nonce: true,
      allowed_mentions: { parse: [] },
      embeds: [{ title: 'Sandbox check', description: 'Full message content survives fetch and edit.',
        timestamp: new Date().toISOString() }],
      components: [{ type: 1, components: [{ type: 2, style: 2,
        label: 'Test button', custom_id: 'sandbox_check', disabled: true }] }]
    };
    const first = await rest.post(Routes.channelMessages(channelId), { body });
    created.add(first.id);
    const retry = await rest.post(Routes.channelMessages(channelId), { body });
    created.add(retry.id);
    assert.equal(retry.id, first.id, 'Retry nonce should return the original message.');
    const fetched = await rest.get(Routes.channelMessage(channelId, first.id));
    assert.equal(fetched.embeds[0].description, body.embeds[0].description);
    assert.equal(fetched.components[0].components[0].disabled, true);
    const edited = await rest.patch(Routes.channelMessage(channelId, first.id), {
      body: { content: 'Jabster Studios integration test completed', allowed_mentions: { parse: [] } }
    });
    assert.match(edited.content, /completed$/);
  } finally {
    for (const messageId of created) {
      await rest.delete(Routes.channelMessage(channelId, messageId));
    }
  }
});

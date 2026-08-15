const assert =
  require('node:assert/strict');

const fs =
  require('node:fs');

const os =
  require('node:os');

const path =
  require('node:path');

const test =
  require('node:test');

const tempDir =
  fs.mkdtempSync(
    path.join(
      os.tmpdir(),
      'jabster-studios-member-experience-'
    )
  );

process.env.DATABASE_PATH =
  path.join(tempDir, 'database.db');

const {
  get,
  initDatabase,
  run,
  tableExists
} = require('../database');

const {
  buildGreetingEmbed,
  buildVerificationPanel,
  parseEmbedColor,
  validHttpsUrl
} = require('../utils/memberExperience');

const {
  parseReactionEmoji,
  reactionEmojiKey
} = require('../utils/reactionRoles');

const ticketTypes =
  require('../utils/tickets/ticketTypes');

test(
  'member experience configuration tables persist after initialization',
  () => {
    initDatabase();

    assert.equal(tableExists('verification_settings'), true);
    assert.equal(tableExists('reaction_role_panels'), true);
    assert.equal(tableExists('reaction_role_mappings'), true);
    assert.equal(tableExists('greeting_settings'), true);

    run(
      `INSERT INTO greeting_settings (
         guildId, type, enabled, updatedAt
       )
       VALUES (?, 'welcome', 1, ?)`,
      ['guild-1', Date.now()]
    );

    initDatabase();

    assert.equal(
      get(
        `SELECT enabled
         FROM greeting_settings
         WHERE guildId = ?
         AND type = 'welcome'`,
        ['guild-1']
      ).enabled,
      1
    );
  }
);

test(
  'verification and greeting customization renders expected safe content',
  () => {
    assert.equal(parseEmbedColor('#5865F2'), 0x5865F2);
    assert.equal(parseEmbedColor('not-a-colour'), null);
    assert.equal(validHttpsUrl('https://example.com/image.png'), 'https://example.com/image.png');
    assert.equal(validHttpsUrl('http://example.com/image.png'), null);

    const verification =
      buildVerificationPanel({
        title: 'Verify',
        description: 'Press the button.',
        buttonLabel: 'Confirm',
        buttonStyle: 'Success',
        color: 0x5865F2
      });

    assert.equal(verification.embeds[0].data.title, 'Verify');
    assert.equal(verification.components[0].components[0].data.label, 'Confirm');

    const greeting =
      buildGreetingEmbed({
        type: 'welcome',
        settings: {
          mode: 'CUSTOM',
          customMessage: 'Welcome {user} to {server}, member #{member_count}.',
          color: 0x5865F2
        },
        member: {
          id: 'user-1',
          guild: {
            name: 'Jabster Studios',
            memberCount: 42
          },
          user: {
            username: 'Jabster',
            displayAvatarURL: () => 'https://example.com/avatar.png'
          }
        }
      });

    assert.equal(
      greeting.data.description,
      'Welcome <@user-1> to Jabster Studios, member #42.'
    );
  }
);

test(
  'reaction role emoji keys are stable and appeal tickets are configurable',
  () => {
    assert.deepEqual(
      parseReactionEmoji('<:jabster:123456789012345678>'),
      {
        display: '<:jabster:123456789012345678>',
        key: 'jabster:123456789012345678'
      }
    );

    assert.deepEqual(
      parseReactionEmoji('✅'),
      {
        display: '✅',
        key: '✅'
      }
    );

    assert.equal(
      reactionEmojiKey({
        emoji: {
          id: '123456789012345678',
          name: 'jabster'
        }
      }),
      'jabster:123456789012345678'
    );

    assert.equal(ticketTypes.appeal.name, 'Punishment Appeal');
  }
);

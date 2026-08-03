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
    path.join(os.tmpdir(), 'jabster-studios-polls-')
  );

process.env.DATABASE_PATH =
  path.join(tempDir, 'database.db');

const {
  get,
  initDatabase
} = require('../database');

const {
  createPoll,
  getVoteCounts,
  recordVote
} = require('../utils/polls');

test(
  'polls keep one current vote per user and count every option correctly',
  () => {
    initDatabase();

    createPoll({
      messageId: 'poll-message',
      guildId: 'guild-1',
      channelId: 'channel-1',
      creatorId: 'creator-1',
      creatorTag: 'Creator',
      question: 'Which option?',
      options: ['First', 'Second', 'Third'],
      endsAt: Date.now() + 60000
    });

    recordVote({
      messageId: 'poll-message',
      userId: 'user-1',
      optionIndex: 0
    });

    recordVote({
      messageId: 'poll-message',
      userId: 'user-2',
      optionIndex: 1
    });

    recordVote({
      messageId: 'poll-message',
      userId: 'user-1',
      optionIndex: 2
    });

    assert.deepEqual(
      getVoteCounts('poll-message', 3),
      [0, 1, 1]
    );

    const votes =
      get(
        `SELECT COUNT(*) AS count
         FROM poll_votes
         WHERE messageId = ?`,
        ['poll-message']
      );

    assert.equal(votes.count, 2);
  }
);

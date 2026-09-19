const assert = require('node:assert/strict');
const test = require('node:test');
const { RACIST_TERMS, findRacistTerm } = require('../utils/racismFilter');

test('racial slur filter catches the reported repetition, prefixes, and the whole message', () => {
  for (const content of [
    'igniggerniggerniggernigger',
    'prefixniggersuffix',
    'nigganigganigga',
    'A normal opening sentence.\nThen igniggernigger at the end.',
    'xNIIIGGGEEERx',
    'n'.repeat(1000) + 'igger',
    'xwetbackwetbackx',
    'xragheadx',
    'xtowelheadx'
  ]) {
    assert.ok(findRacistTerm(content), content);
  }
});

test('racial slur filter recognizes punctuation, leetspeak, invisible characters, and lookalikes', () => {
  for (const content of [
    '.nigger', '/nigger', 'n.i.g.g.e.r', 'n i g g e r',
    'n!gg3r!', 'n|gg3r', 'n1gg3r', 'ni99er', 'n!i!g!g!e!r',
    'n\u200Big\u2060ge\u200Dr', 'n\u0301igger',
    '\u043f\u0456gg\u0435r',
    '\uff4e\uff49\uff47\uff47\uff45\uff52',
    '\u{1d427}\u{1d422}\u{1d420}\u{1d420}\u{1d41e}\u{1d42b}',
    'k!ke!', 'k!k3!', '$pic!', 'p@ki!'
  ]) {
    assert.ok(findRacistTerm(content), content);
  }
});

test('all built-in terms match standalone, repeated, decorated, and spaced spellings', () => {
  for (const { word } of RACIST_TERMS) {
    for (const content of [word, word.repeat(3), `/${word}!`, word.split('').join('.')]) {
      assert.equal(findRacistTerm(content), word, content);
    }
  }
});

test('ordinary words containing shorter ambiguous spellings are not blocked', () => {
  for (const content of [
    'A class assignment about classic music.',
    'Niger and Nigeria are in Africa.',
    'Pakistan and Pakistani food.',
    'Spicy spices and conspicuous colours.',
    'A raccoon and a tycoon.',
    'The sniggering stopped. They sniggered!',
    'A niggardly budget.',
    'Good morning! Have a nice day.',
    'A key and a pike.',
    '', null
  ]) {
    assert.equal(findRacistTerm(content), null, content);
  }
  assert.equal(findRacistTerm('sniggeringnigger'), 'nigger');
  assert.equal(findRacistTerm('sniggering, nigger'), 'nigger');
});

test('custom lists only opt their configured racial terms into stronger matching', () => {
  assert.equal(findRacistTerm('igniggernigger', new Set()), null);
  assert.equal(findRacistTerm('igniggernigger', new Set(['nigger'])), 'nigger');
  assert.equal(findRacistTerm('wetback', new Set(['nigger'])), null);
});

test('long near-matches finish promptly without pathological regex backtracking', () => {
  const start = performance.now();
  for (const content of [
    'n'.repeat(4000), 'n' + 'i'.repeat(3998) + 'x',
    'k' + '!'.repeat(3998) + 'x',
    'kike'.repeat(999) + 'x', 'coon'.repeat(999) + 'x',
    'k' + ' .'.repeat(1998) + 'x'
  ]) {
    assert.equal(findRacistTerm(content), null);
  }
  assert.ok(performance.now() - start < 2000, 'Matching should not stall the message event loop.');
});

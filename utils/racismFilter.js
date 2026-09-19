// Longer, distinctive slurs are checked inside joined strings. Shorter or
// ambiguous terms retain word boundaries to avoid matching ordinary words.
const RACIST_TERMS = Object.freeze([
  { word: 'nigger', embedded: true },
  { word: 'nigga', embedded: true },
  { word: 'wetback', embedded: true },
  { word: 'raghead', embedded: true },
  { word: 'towelhead', embedded: true },
  { word: 'kike', embedded: false },
  { word: 'chink', embedded: false },
  { word: 'paki', embedded: false },
  { word: 'spic', embedded: false },
  { word: 'gook', embedded: false },
  { word: 'coon', embedded: false },
  { word: 'beaner', embedded: false }
]);

const LOOKALIKES = Object.freeze({
  '\u0430': 'a', '\u03b1': 'a', '\u0432': 'b', '\u0441': 'c',
  '\u0435': 'e', '\u04bb': 'h', '\u0456': 'i', '\u0457': 'i',
  '\u0131': 'i', '\u0458': 'j', '\u043a': 'k', '\u03ba': 'k',
  '\u043c': 'm', '\u043f': 'n', '\u03b7': 'n', '\u0578': 'n',
  '\u043e': 'o', '\u03bf': 'o', '\u0440': 'p', '\u03c1': 'p',
  '\u0455': 's', '\u0442': 't', '\u03c4': 't', '\u0445': 'x',
  '\u0261': 'g', '\u0262': 'g', '\u0280': 'r'
});

function normalizeRacismText(value) {
  return Array.from(String(value || '').normalize('NFKD').toLowerCase())
    .map(character => LOOKALIKES[character] || character)
    .join('')
    .replace(/[\p{M}\p{Cf}]/gu, '')
    .replace(/1/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/[69]/g, 'g')
    .replace(/[0]/g, 'o')
    .replace(/5/g, 's')
    .replace(/7/g, 't');
}

const GAP = '[^\\p{L}\\p{N}]*';
const SYMBOL_GAP = '[^\\p{L}\\p{N}!|@$]*';
const SYMBOL_LETTERS = { i: '[i!|]', a: '[a@]', s: '[s$]' };

function letterPattern(word, separated, symbols = false) {
  const runs = word.match(/(.)\1*/g);
  const gap = symbols ? SYMBOL_GAP : GAP;
  return runs.map(run => {
    const letter = symbols ? (SYMBOL_LETTERS[run[0]] || run[0]) : run[0];
    return separated
      ? `${letter}(?:${gap}${letter}){${run.length - 1},}`
      : `${letter}{${run.length},}`;
  }).join(separated ? gap : '');
}

function boundedPattern(word, symbols) {
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:${letterPattern(word, true, symbols)})+s?(?=$|[^\\p{L}\\p{N}])`, 'u');
}

const RULES = RACIST_TERMS.map(term => ({
  ...term,
  expression: term.embedded
    ? new RegExp(`(?<!${term.word[0]})${letterPattern(term.word, false)}`, 'u')
    : boundedPattern(term.word, false),
  symbolExpression: term.embedded ? null : boundedPattern(term.word, true)
}));

function findRacistTerm(content, allowedTerms = null) {
  const normalized = normalizeRacismText(content);
  // These ordinary words contain a spelling shared with a slur. Only whole,
  // normally spelled words are exempt; adding slurs to them still matches.
  const unambiguous = normalized.replace(/\b(?:snigger(?:s|ed|ing)?|niggard(?:ly|liness)?)\b/gu, ' ');
  const compact = unambiguous.replace(/[^\p{L}\p{N}]/gu, '');
  const symbolCompact = unambiguous
    .replace(/[!|]/g, 'i').replace(/@/g, 'a').replace(/\$/g, 's')
    .replace(/[^\p{L}\p{N}]/gu, '');
  for (const rule of RULES) {
    if (allowedTerms && !allowedTerms.has(rule.word)) continue;
    if (rule.embedded) {
      if (rule.expression.test(compact) || rule.expression.test(symbolCompact)) return rule.word;
    } else if (rule.expression.test(normalized) || rule.symbolExpression.test(normalized)) {
      return rule.word;
    }
  }
  return null;
}

module.exports = { RACIST_TERMS, findRacistTerm, normalizeRacismText };

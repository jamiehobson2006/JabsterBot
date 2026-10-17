const REFERENCE = /(?:\s*\|\s*)?Ref:\s*[a-f0-9]{24}\b/gi;

function dailyReference(text) {
  return String(text || '').match(/Ref:\s*[a-f0-9]{24}\b/i)?.[0] || null;
}

function cleanDailyFooter(footer, marker = dailyReference(footer?.text)) {
  const text = String(footer?.text || '').replace(REFERENCE, '').replace(/(?:\s*\|\s*)+$/g, '').trim()
    || 'Jabster Studios';
  return { ...footer, text: marker ? `${text.slice(0, 1980)} | ${marker}` : text.slice(0, 2048) };
}

module.exports = { cleanDailyFooter, dailyReference };

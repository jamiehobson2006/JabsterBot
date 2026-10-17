const { isIP } = require('node:net');

function validateSourceUrl(value) {
  if (!String(value || '').trim()) return null;
  let url;
  try { url = new URL(String(value).trim()); } catch { throw new Error('Enter a full HTTPS source URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      url.href.length > 800 || isIP(url.hostname.replace(/^\[|\]$/g, '')) ||
      !url.hostname.includes('.') || /(?:^|\.)(?:localhost|local|internal)$/i.test(url.hostname)) {
    throw new Error('Use a public HTTPS source link without credentials or a custom port.');
  }
  // Links are stored, never fetched by the bot. Verification is a human review decision.
  return url.href;
}

function sourceFields(fact) {
  const fields = [];
  if (fact.sourceUrl) {
    try {
      const url = validateSourceUrl(fact.sourceUrl);
      fields.push({ name: 'Source Link', value: `<${url}>` });
    } catch { /* Invalid legacy links must not break daily delivery. */ }
  }
  fields.push({ name: 'Source Verification', value: fact.verifiedAt && fact.sourceUrl
    ? `Reviewed <t:${Math.floor(fact.verifiedAt / 1000)}:D>` : 'Not source-verified' });
  return fields;
}

module.exports = { sourceFields, validateSourceUrl };

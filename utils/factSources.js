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
  // Fetches additionally require the pinned public-DNS checks in publicSourceCheck.
  return url.href;
}

function sourceFields(fact) {
  const fields = [];
  let hasSource = false;
  if (fact.sourceUrl) {
    try {
      const url = validateSourceUrl(fact.sourceUrl);
      fields.push({ name: 'Source Link', value: `[${fact.verifiedAt ? 'Read supporting source' : 'Read reference'}](<${url}>)` });
      hasSource = true;
    } catch { /* Invalid legacy links must not break daily delivery. */ }
  }
  fields.push({ name: 'Source Verification', value: fact.verifiedAt && hasSource
    ? `Reviewed <t:${Math.floor(fact.verifiedAt / 1000)}:D>` : 'Not source-verified' });
  if (!hasSource) fields.push({name:'Source Warning',value:'No supporting source has been provided. This approved community fact has not been source-verified.'});
  return fields;
}

module.exports = { sourceFields, validateSourceUrl };

const { domainToASCII } = require('node:url');

const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/g;
const DOT_OBFUSCATION = /\s*(?:\[\s*dot\s*\]|\(\s*dot\s*\)|\{\s*dot\s*\}|\bdot\b)\s*/gi;
const SCHEME_OBFUSCATION = /\bhxxps?:\/\//gi;
const URL_CANDIDATE = /(?:https?:\/\/|www\.)[^\s<>{}\[\]"']+|(?:[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?\.)+[a-z]{2,63}(?::\d{1,5})?(?:\/[^\s<>{}\[\]"']*)?/gi;

function normaliseLinkText(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(ZERO_WIDTH, '')
    .replace(SCHEME_OBFUSCATION, match => match.toLowerCase().startsWith('hxxps') ? 'https://' : 'http://')
    .replace(DOT_OBFUSCATION, '.');
}

function trimCandidate(value) {
  return value
    .replace(/^<+/, '')
    .replace(/[)>\],.!?:;'"\u2019\u201D]+$/g, '');
}

function parseCandidate(raw) {
  const candidate = trimCandidate(raw);
  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(candidate)
    ? candidate
    : `https://${candidate}`;

  try {
    const parsed = new URL(withScheme);
    const hostname = domainToASCII(parsed.hostname.toLowerCase()).replace(/\.$/, '');
    const explicitScheme = /^https?:\/\//i.test(candidate);
    if (!hostname || (!explicitScheme && !hostname.includes('.')) || hostname.length > 253) return null;

    return {
      raw,
      url: parsed.href,
      hostname,
      domain: hostname.replace(/^www\./, '')
    };
  } catch {
    return null;
  }
}

function extractLinks(value) {
  const text = normaliseLinkText(value);
  const matches = text.match(URL_CANDIDATE) || [];
  const seen = new Set();
  const links = [];

  for (const match of matches) {
    const parsed = parseCandidate(match);
    if (!parsed) continue;
    const key = `${parsed.hostname}|${parsed.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push(parsed);
  }

  return links;
}

function hasLink(value) {
  return extractLinks(value).length > 0;
}

function domainMatches(hostname, allowedDomain) {
  const host = domainToASCII(String(hostname || '').toLowerCase()).replace(/\.$/, '');
  const allowed = parseCandidate(normaliseLinkText(allowedDomain))?.hostname.replace(/^www\./, '');

  return Boolean(allowed) && (host === allowed || host.endsWith(`.${allowed}`));
}

module.exports = {
  domainMatches,
  extractLinks,
  hasLink,
  normaliseLinkText
};

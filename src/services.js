// Instagram stays on Direct: login and security checks are allowed, feed, Explore, Reels,
// posts, stories and profiles are not.
const INSTAGRAM_PATHS = ['/direct/', '/accounts/', '/challenge/', '/two_factor/', '/auth_platform/'];
// The "create post" item has no stable href; it is found by its icon label (pt-BR and English).
const CREATE_POST_LABELS = ['Nova publicação', 'Novo post', 'Criar', 'New post', 'Create'];
const INSTAGRAM_HIDDEN = [
  'a[href="/"]',
  'a[href^="/explore"]',
  'a[href^="/reels"]',
  ...CREATE_POST_LABELS.flatMap((label) => [
    `a:has(svg[aria-label="${label}"])`,
    `[role="link"]:has(svg[aria-label="${label}"])`
  ])
];

const SERVICES = {
  whatsapp: {
    url: 'https://web.whatsapp.com/',
    isTrustedHost: (hostname) => hostname === 'web.whatsapp.com',
    isAllowedPath: () => true,
    preload: 'whatsapp-preload.js',
    css: '[aria-label="Canais"], [aria-label="Comunidades"] { display: none !important; }'
  },
  instagram: {
    url: 'https://www.instagram.com/direct/inbox/',
    isTrustedHost: (hostname) => hostname === 'instagram.com' || hostname.endsWith('.instagram.com'),
    isAllowedPath: (pathname) => INSTAGRAM_PATHS.some((prefix) => pathname.startsWith(prefix)),
    preload: 'instagram-preload.js',
    css: `${INSTAGRAM_HIDDEN.join(', ')} { display: none !important; }`
  }
};

function isTrustedUrl(service, value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && SERVICES[service].isTrustedHost(parsed.hostname);
  } catch {
    return false;
  }
}

function isAllowedUrl(service, value) {
  return isTrustedUrl(service, value) && SERVICES[service].isAllowedPath(new URL(value).pathname);
}

module.exports = { SERVICES, isTrustedUrl, isAllowedUrl };

const { ipcRenderer } = require('electron');

// Unread selector adapted from the Ferdium Instagram recipe (MIT):
// https://github.com/ferdium/ferdium-recipes/blob/main/recipes/instagram/webview.js
const DIRECT_LINK_SELECTOR = 'a[href^="/direct/inbox"]';
const DIRECT_BADGE_SELECTOR = `${DIRECT_LINK_SELECTOR} span`;

let previousCount = -1;

function readUnreadCount() {
  const element = document.querySelector(DIRECT_BADGE_SELECTOR);
  const value = Number.parseInt(element?.textContent?.replace(/\D/g, '') || '0', 10);
  return Number.isSafeInteger(value) ? Math.min(value, 9999) : 0;
}

function publishUnreadCount() {
  const nextCount = readUnreadCount();
  if (nextCount === previousCount) return;
  previousCount = nextCount;
  ipcRenderer.send('service:unread-count', nextCount);
}

// Instagram's menu has no stable classes: climb from the Messages link until the block that holds
// the page content, hiding every sibling on the way (other items, logo, settings, bottom bar).
function keepOnlyMessagesInMenu() {
  if (!document.querySelector('main, [role="main"]')) return;
  const direct = document.querySelector(DIRECT_LINK_SELECTOR);
  for (let el = direct; el?.parentElement && !el.parentElement.querySelector('main, [role="main"]'); el = el.parentElement) {
    for (const sibling of el.parentElement.children) {
      if (sibling !== el) sibling.style.setProperty('display', 'none', 'important');
    }
  }
}

// Inside Direct, links to the feed, posts or profiles do nothing; the main process blocks the rest.
document.addEventListener(
  'click',
  (event) => {
    if (!location.pathname.startsWith('/direct/')) return;
    const link = event.target.closest?.('a[href]');
    if (!link) return;
    const url = new URL(link.href, location.href);
    if (url.hostname.endsWith('instagram.com') && !url.pathname.startsWith('/direct/')) {
      event.preventDefault();
      event.stopPropagation();
    }
  },
  true
);

window.addEventListener('DOMContentLoaded', () => {
  const observer = new MutationObserver(() => {
    keepOnlyMessagesInMenu();
    publishUnreadCount();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  keepOnlyMessagesInMenu();
  publishUnreadCount();
});

const { ipcRenderer } = require('electron');

const BADGE_SELECTORS = [
  '[aria-label*="mensagens não lidas"]',
  '[aria-label*="unread messages"]',
  '[data-testid="icon-unread-count"]'
];

let previousCount = -1;

function readUnreadCount() {
  let total = 0;
  for (const selector of BADGE_SELECTORS) {
    for (const element of document.querySelectorAll(selector)) {
      const value = Number.parseInt(element.textContent?.replace(/\D/g, '') || '0', 10);
      if (Number.isSafeInteger(value)) total += value;
    }
  }
  return Math.min(total, 9999);
}

function publishUnreadCount() {
  const nextCount = readUnreadCount();
  if (nextCount === previousCount) return;
  previousCount = nextCount;
  ipcRenderer.send('service:unread-count', nextCount);
}

window.addEventListener('DOMContentLoaded', () => {
  const observer = new MutationObserver(() => publishUnreadCount());
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  publishUnreadCount();
});

const { ipcRenderer } = require('electron');

let previousCount = -1;

// The tab title carries the unread count: "Caixa de entrada (12) - nome@gmail.com - Gmail" / "Inbox (12) - ...".
function readUnreadCount() {
  const match = document.title.match(/\((\d+)\)/);
  const value = match ? Number.parseInt(match[1], 10) : 0;
  return Number.isSafeInteger(value) ? Math.min(value, 9999) : 0;
}

function publishUnreadCount() {
  const nextCount = readUnreadCount();
  if (nextCount === previousCount) return;
  previousCount = nextCount;
  ipcRenderer.send('service:unread-count', nextCount);
}

window.addEventListener('DOMContentLoaded', () => {
  const title = document.querySelector('title');
  if (title) new MutationObserver(publishUnreadCount).observe(title, { childList: true, characterData: true, subtree: true });
  publishUnreadCount();
});

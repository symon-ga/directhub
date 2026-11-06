const { ipcRenderer } = require('electron');

let previousCount = -1;

// The inbox title carries the unread count: "Caixa de entrada (1.234) - nome@gmail.com - Gmail" / "Inbox (12) - ...".
// No count on the inbox means 0; any other title (open message, other folder) keeps the last inbox count.
function readUnreadCount() {
  const match = document.title.match(/^(?:Caixa de entrada|Inbox)(?:\s*\(([\d.,]+)\))?\s*-/);
  if (!match) return previousCount;
  const value = match[1] ? Number.parseInt(match[1].replace(/[.,]/g, ''), 10) : 0;
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

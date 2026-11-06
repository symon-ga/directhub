const assert = require('node:assert/strict');
const test = require('node:test');
const { isAllowedUrl, isTrustedUrl } = require('../src/services');

test('Instagram only opens Direct, login and security checks', () => {
  for (const url of [
    'https://www.instagram.com/direct/inbox/',
    'https://www.instagram.com/direct/t/123/',
    'https://www.instagram.com/accounts/login/?next=%2Fdirect%2Finbox%2F',
    'https://www.instagram.com/challenge/abc/'
  ]) {
    assert.equal(isAllowedUrl('instagram', url), true, url);
  }
  for (const url of [
    'https://www.instagram.com/',
    'https://www.instagram.com/explore/',
    'https://www.instagram.com/reels/',
    'https://www.instagram.com/p/abc/',
    'https://www.instagram.com/stories/alguem/1/',
    'https://www.instagram.com/alguem/'
  ]) {
    assert.equal(isAllowedUrl('instagram', url), false, url);
    assert.equal(isTrustedUrl('instagram', url), true, url);
  }
  assert.equal(isAllowedUrl('instagram', 'https://evil.com/direct/'), false);
});

test('WhatsApp keeps every path on its own host', () => {
  assert.equal(isAllowedUrl('whatsapp', 'https://web.whatsapp.com/qualquer'), true);
  assert.equal(isAllowedUrl('whatsapp', 'https://www.instagram.com/direct/'), false);
});

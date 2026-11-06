const assert = require('node:assert/strict');
const test = require('node:test');
const { replySubject: mainSubject } = require('../src/email/pure');
const { replySubject, quoteText, parseRecipients, replyHeader, replyBody } = require('../src/email-ui/compose-pure');

test('reply subject on screen follows the main rule', () => {
  for (const s of ['Olá', 'Re: Olá', 'RE: Olá', '', '  Olá ']) assert.equal(replySubject(s), mainSubject(s));
  assert.equal(replySubject('Olá'), 'Re: Olá');
});

test('parses recipients separated by comma or semicolon', () => {
  assert.deepEqual(parseRecipients('a@x.com, b@y.com'), { list: ['a@x.com', 'b@y.com'], invalid: [] });
  assert.deepEqual(parseRecipients(' a@x.com ;; b@y.com, '), { list: ['a@x.com', 'b@y.com'], invalid: [] });
  assert.deepEqual(parseRecipients('a@x.com, semarroba, b@y'), { list: ['a@x.com'], invalid: ['semarroba', 'b@y'] });
  assert.deepEqual(parseRecipients(''), { list: [], invalid: [] });
});

test('builds the "Em … escreveu:" header', () => {
  const header = replyHeader('2026-11-05T15:30:00Z', { name: 'Ana Teste', address: 'ana@teste.example' }, 'UTC');
  assert.match(header, /^Em 05\/11\/2026.*15:30, Ana Teste <ana@teste.example> escreveu:$/);
  assert.equal(replyHeader('inválida', { address: 'a@x.com' }), 'Em a@x.com escreveu:');
  assert.equal(replyHeader(undefined, null), 'Em o remetente escreveu:');
});

test('reply body starts with a blank line and quotes the original', () => {
  const body = replyBody({ date: '2026-11-05T15:30:00Z', from: { address: 'a@x.com' } }, 'oi\n\ntchau', 'UTC');
  assert.ok(body.startsWith('\n\nEm '));
  assert.ok(body.endsWith('escreveu:\n> oi\n>\n> tchau'));
  assert.equal(quoteText('a\r\nb'), '> a\n> b');
});

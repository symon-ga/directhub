const assert = require('node:assert/strict');
const test = require('node:test');
const { isValidAddress, quoteText, replyReferences, replySubject, resolveHosts } = require('../src/email/pure');

test('reply subject gets one "Re: "', () => {
  assert.equal(replySubject('Olá'), 'Re: Olá');
  assert.equal(replySubject('Re: Olá'), 'Re: Olá');
  assert.equal(replySubject('RE: Olá'), 'RE: Olá');
  assert.equal(replySubject(''), 'Re:');
});

test('quotes the original text line by line', () => {
  assert.equal(quoteText('a\n\nb'), '> a\n>\n> b');
  assert.equal(quoteText('a\r\nb'), '> a\n> b');
});

test('resolves host presets with fixed TLS ports', () => {
  assert.deepEqual(resolveHosts({ provider: 'google' }), { imapHost: 'imap.gmail.com', imapPort: 993, smtpHost: 'smtp.gmail.com', smtpPort: 465 });
  assert.deepEqual(resolveHosts({ provider: 'custom', imapHost: 'i.x.com', smtpHost: 's.x.com' }), { imapHost: 'i.x.com', imapPort: 993, smtpHost: 's.x.com', smtpPort: 465 });
  assert.throws(() => resolveHosts({ provider: 'outro' }), /desconhecido/);
});

test('validates addresses', () => {
  assert.equal(isValidAddress('a@b.co'), true);
  for (const value of ['a@b', 'a b@c.com', '@c.com', '', null, 'a@b.com, c@d.com']) assert.equal(isValidAddress(value), false, String(value));
});

test('reply references append the original message id', () => {
  assert.equal(replyReferences(['<1>', '<2>'], '<3>'), '<1> <2> <3>');
  assert.equal(replyReferences([], '<3>'), '<3>');
});

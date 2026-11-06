// Funções puras da composição (sem DOM nem Electron). Carregado como script na vista e como módulo nos testes.
(function (root) {
  const ADDRESS_PATTERN = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;

  // Mesma regra do main (src/email/pure.js): um único "Re: ".
  function replySubject(subject) {
    const text = String(subject || '').trim();
    return /^res?:/i.test(text) ? text : `Re: ${text}`.trim();
  }

  function quoteText(text) {
    return String(text || '').replace(/\r\n/g, '\n').split('\n').map((line) => `> ${line}`.trimEnd()).join('\n');
  }

  // "a@x.com, b@y.com" -> { list, invalid }. Aceita vírgula ou ponto e vírgula.
  function parseRecipients(text) {
    const parts = String(text || '').split(/[,;]/).map((part) => part.trim()).filter(Boolean);
    return {
      list: parts.filter((part) => part.length <= 254 && ADDRESS_PATTERN.test(part)),
      invalid: parts.filter((part) => part.length > 254 || !ADDRESS_PATTERN.test(part))
    };
  }

  function replyHeader(date, from, timeZone) {
    const when = new Date(date);
    const day = Number.isNaN(when.getTime())
      ? ''
      : when.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', ...(timeZone ? { timeZone } : {}) });
    const who = from?.name && from?.address ? `${from.name} <${from.address}>` : from?.name || from?.address || 'o remetente';
    return `Em ${day ? `${day}, ` : ''}${who} escreveu:`;
  }

  // Corpo inicial da resposta: linha em branco, cabeçalho e o original citado.
  function replyBody(message, originalText, timeZone) {
    return `\n\n${replyHeader(message.date, message.from, timeZone)}\n${quoteText(originalText)}`;
  }

  const api = { replySubject, quoteText, parseRecipients, replyHeader, replyBody };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ComposePure = api;
})(typeof window !== 'undefined' ? window : globalThis);

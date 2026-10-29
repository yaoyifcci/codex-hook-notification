'use strict';
(function (root) {
  // Keep token text as text nodes: remote JSON must never become executable HTML.
  function formatCode(value) {
    const raw = String(value);
    let text, language;
    try { text = JSON.stringify(JSON.parse(raw), null, 2); language = 'JSON'; }
    catch { text = raw; language = 'TEXT'; }
    if (language !== 'JSON') return { text, language, tokens: [{ text, type: '' }] };
    const pattern = /"(?:\\.|[^"\\])*"(?=\s*:)|"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\b(?:true|false|null)\b|[{}\[\],:]/g;
    const tokens = []; let start = 0;
    for (const match of text.matchAll(pattern)) {
      if (match.index > start) tokens.push({ text: text.slice(start, match.index), type: '' });
      const word = match[0];
      const type = word.startsWith('"') ? (text.slice(match.index + word.length).trimStart().startsWith(':') ? 'key' : 'string') : /^-?\d/.test(word) ? 'number' : word === 'null' ? 'null' : /^(true|false)$/.test(word) ? 'boolean' : 'punctuation';
      tokens.push({ text: word, type }); start = match.index + word.length;
    }
    if (start < text.length) tokens.push({ text: text.slice(start), type: '' });
    return { text, language, tokens };
  }
  function createCodeView(label, value) {
    const formatted = formatCode(value);
    const container = document.createElement('div'); container.className = 'code-view';
    const header = document.createElement('div'); header.className = 'code-view-header';
    const title = document.createElement('span'); title.textContent = label;
    const language = document.createElement('span'); language.className = 'code-language'; language.textContent = formatted.language;
    header.append(title, language);
    const pre = document.createElement('pre'); pre.tabIndex = 0; pre.setAttribute('aria-label', label);
    const code = document.createElement('code');
    for (const token of formatted.tokens) {
      if (!token.type) { code.append(document.createTextNode(token.text)); continue; }
      const span = document.createElement('span'); span.className = 'syntax-' + token.type; span.textContent = token.text; code.append(span);
    }
    pre.append(code); container.append(header, pre); return container;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { formatCode };
  else root.CodeView = { createCodeView };
})(typeof window === 'undefined' ? globalThis : window);

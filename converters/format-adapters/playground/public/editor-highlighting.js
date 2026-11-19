import { highlightAeon } from '/highlighter.js';
import { tokenize, TokenType } from '/vendor/aeon-lexer/index.js';

const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
// Presentation only. Execution and diagnostics remain the SANSA runtime's job.
// Use lexer spans so strings, comments and quoted selectors are never rewritten
// by keyword matching, including while the user is editing incomplete syntax.
const keywords = new Set(['from', 'where', 'order', 'by', 'offset', 'limit', 'select', 'asc', 'desc']);
const operators = new Set(['and', 'or', 'not', 'in', 'any', 'all', 'none', 'exists', 'empty']);
const roles = new Map([
  [TokenType.String, 'string'], [TokenType.SansaAddressLiteral, 'sansa'],
  [TokenType.StructuralIdentity, 'identity'], [TokenType.SymbolicLiteral, 'symbol'],
  ...['Number', 'HexLiteral', 'RadixLiteral'].map(name => [TokenType[name], 'number']),
  ...['Date', 'DateTime', 'Time'].map(name => [TokenType[name], 'temporal']),
  ...['True', 'False', 'Yes', 'No', 'On', 'Off', 'NullLiteral'].map(name => [TokenType[name], 'literal']),
  ...['LineComment', 'BlockComment'].map(name => [TokenType[name], 'comment']),
  ...['Equals', 'LeftAngle', 'RightAngle', 'Symbol'].map(name => [TokenType[name], 'operator']),
  ...['LeftBrace', 'RightBrace', 'LeftBracket', 'RightBracket', 'LeftParen', 'RightParen',
    'Colon', 'Comma', 'Dot', 'At', 'Caret', 'Hash', 'Dollar', 'Question', 'Percent', 'Ampersand', 'Semicolon']
    .map(name => [TokenType[name], 'punct']),
].filter(([type]) => type !== undefined));

export function highlightSansa(source) {
  // Match the playground's query-size allowance; larger drafts stay readable.
  if (source.length > 65_536) return escape(source);
  try {
    const { tokens } = tokenize(source);
    let html = '', cursor = 0, previous;
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i], start = token.span.start.offset, end = token.span.end.offset;
      if (end <= start || start < cursor) continue;
      const text = source.slice(start, end);
      let role = roles.get(token.type);
      if (token.type === TokenType.Identifier) {
        // A member named "select" or a projection field named "from" is data.
        const member = previous && previous.span.end.offset === start &&
          [TokenType.Dot, TokenType.At, TokenType.Hash, TokenType.Percent].includes(previous.type);
        if (member) role = 'property';
        else if (tokens[i + 1]?.type === TokenType.LeftParen) role = 'function';
        else if (tokens[i + 1]?.type === TokenType.Equals && tokens[i + 2]?.type !== TokenType.Equals) role = 'key';
        else if (keywords.has(text)) role = 'keyword';
        else if (operators.has(text)) role = 'operator';
      }
      html += escape(source.slice(cursor, start));
      html += role ? `<span class="tok-${role}">${escape(text)}</span>` : escape(text);
      cursor = end;
      if (![TokenType.LineComment, TokenType.BlockComment, TokenType.Newline].includes(token.type)) previous = token;
    }
    return html + escape(source.slice(cursor));
  } catch { return escape(source); }
}

export function attachHighlightEditor(textarea, backdrop, language) {
  const code = backdrop.querySelector('code');
  const highlight = typeof language === 'function' ? language : language === 'sansa' ? highlightSansa : highlightAeon;
  const syncScroll = () => {
    backdrop.scrollTop = textarea.scrollTop;
    backdrop.scrollLeft = textarea.scrollLeft;
  };
  const refresh = () => {
    try { code.innerHTML = highlight(textarea.value); }
    catch { code.textContent = textarea.value; }
    // A pre needs a visible character to retain the final empty editor line.
    if (!textarea.value || textarea.value.endsWith('\n')) code.append(' ');
    textarea.parentElement.classList.add('is-highlighted');
    syncScroll();
  };
  textarea.addEventListener('input', refresh);
  textarea.addEventListener('scroll', syncScroll);
  refresh();
  return refresh;
}

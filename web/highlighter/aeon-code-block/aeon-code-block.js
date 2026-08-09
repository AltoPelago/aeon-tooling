const DEFAULT_TITLE = 'AEON';

const BLOCK_COMMENT_TYPES = [
  { begin: '/#', end: '#/', type: 'comment-doc' },
  { begin: '/@', end: '@/', type: 'comment-annotation' },
  { begin: '/?', end: '?/', type: 'comment-hint' },
  { begin: '/{', end: '}/', type: 'comment-structure' },
  { begin: '/[', end: ']/', type: 'comment-profile' },
  { begin: '/(', end: ')/', type: 'comment-future' },
  { begin: '/*', end: '*/', type: 'comment' }
];

const LINE_COMMENT_TYPES = [
  { begin: '//#', type: 'comment-doc' },
  { begin: '//@', type: 'comment-annotation' },
  { begin: '//?', type: 'comment-hint' },
  { begin: '//!', type: 'comment-host' },
  { begin: '//{', type: 'comment-structure' },
  { begin: '//[', type: 'comment-profile' },
  { begin: '//(', type: 'comment-future' },
  { begin: '//', type: 'comment' }
];

const IDENTIFIER = '[A-Za-z_][A-Za-z0-9_]*';
const QUOTED = '"(?:\\\\.|[^"])*"|\'(?:\\\\.|[^\'])*\'';
const QUOTED_KEY = `(?:${QUOTED})`;
const KEY = `(?:${IDENTIFIER}|${QUOTED})`;
const TYPE_ANNOTATION = `:${IDENTIFIER}(?:<[^>\\n]+>)?(?:\\[\\s*[A-Za-z0-9!#$%&*+\\-.:;=?@^_|~<>]\\s*\\])*`;
const REFERENCE_PATH =
  '\\$?(?:' +
  `${IDENTIFIER}|${QUOTED}|\\[\\d+\\]|\\["(?:\\\\.|[^"])*"\\]` +
  `|\\.${IDENTIFIER}|\\.\\["(?:\\\\.|[^"])*"\\]` +
  `|\\.@\\.${IDENTIFIER}|\\.@\\.\\["(?:\\\\.|[^"])*"\\]` +
  ')+';

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function wrap(type, value) {
  return `<span class="tok-${type}">${escapeHtml(value)}</span>`;
}

function wrapRaw(type, html) {
  return `<span class="tok-${type}">${html}</span>`;
}

function renderAndInline(value) {
  const parts = [];
  const pattern = /(\\[\[\]|\\]|\[\*[\s\S]*?\]|\[\/[\s\S]*?\]|\[\$[\s\S]*?\]|\[@[\s\S]*?\]|\[(?: |x|=|\.|_|<)[^\]]*\]|\|)/g;
  let index = 0;

  for (const match of value.matchAll(pattern)) {
    const token = match[0];
    const start = match.index ?? 0;
    if (start > index) {
      parts.push(escapeHtml(value.slice(index, start)));
    }

    if (token.startsWith('\\')) {
      parts.push(wrap('and-escape', token));
    } else if (token === '|') {
      parts.push(wrap('and-table-pipe', token));
    } else if (/^\[(?: |x|=|\.|_|<)/.test(token)) {
      parts.push(wrap('and-invalid', token));
    } else if (token.startsWith('[*')) {
      parts.push(wrap('and-strong', token));
    } else if (token.startsWith('[/')) {
      parts.push(wrap('and-emphasis', token));
    } else if (token.startsWith('[$')) {
      parts.push(wrap('and-code', token));
    } else if (token.startsWith('[@')) {
      const link = /^(\[@)(.*?)(\|)(.*)(\])$/.exec(token);
      if (link) {
        parts.push(
          wrap('and-link', link[1] + link[2]) +
          wrap('and-link-separator', link[3]) +
          wrap('and-link-target', link[4]) +
          wrap('and-link', link[5])
        );
      } else {
        parts.push(wrap('and-link', token));
      }
    }
    index = start + token.length;
  }

  if (index < value.length) {
    parts.push(escapeHtml(value.slice(index)));
  }

  return parts.join('');
}

function renderDocComment(value) {
  const lines = value.split('\n');
  const rendered = lines.map((line) => {
    if (/^\s*(?:\/#|#\/)\s*$/.test(line)) {
      return wrap('comment-doc', line);
    }

    const header = /^(\s*)(&ND)(\s+v[0-9]+)?(.*)$/.exec(line);
    if (header) {
      return `${escapeHtml(header[1])}${wrap('and-header', header[2])}${header[3] ? wrap('and-version', header[3]) : ''}${wrapRaw('comment-doc', renderAndInline(header[4]))}`;
    }

    const codeFence = /^(\s*)(`{3,})([A-Za-z0-9_+.-]+)?(.*)$/.exec(line);
    if (codeFence) {
      return `${escapeHtml(codeFence[1])}${wrap('and-fence', codeFence[2])}${codeFence[3] ? wrap('and-fence-label', codeFence[3]) : ''}${wrapRaw('comment-doc', renderAndInline(codeFence[4]))}`;
    }

    const extensionFence = /^(\s*)(\+{3})([A-Za-z0-9_./+-]+|fallback)?(.*)$/.exec(line);
    if (extensionFence) {
      return `${escapeHtml(extensionFence[1])}${wrap('and-extension-fence', extensionFence[2])}${extensionFence[3] ? wrap('and-extension-name', extensionFence[3]) : ''}${wrapRaw('comment-doc', renderAndInline(extensionFence[4]))}`;
    }

    const rule = /^(\s*)(---)(\s*)$/.exec(line);
    if (rule) {
      return `${escapeHtml(rule[1])}${wrap('and-rule', rule[2])}${escapeHtml(rule[3])}`;
    }

    const quote = /^(\s*(?:>\s*)+)(.*)$/.exec(line);
    if (quote) {
      return `${wrap('and-quote', quote[1])}${wrapRaw('and-quote-text', renderAndInline(quote[2]))}`;
    }

    const heading = /^(\s{0,3})(#{1,6})(\s+.*)$/.exec(line);
    if (heading) {
      return `${escapeHtml(heading[1])}${wrap('and-heading-marker', heading[2])}${wrapRaw('and-heading', renderAndInline(heading[3]))}`;
    }

    const list = /^(\s*)(-\s+|\d+\.\s+)(.*)$/.exec(line);
    if (list) {
      return `${escapeHtml(list[1])}${wrap('and-list-marker', list[2])}${wrapRaw('and-list-text', renderAndInline(list[3]))}`;
    }

    return wrapRaw('comment-doc', renderAndInline(line));
  });

  return rendered.join('\n');
}

function findCommentStart(line) {
  let quote = null;
  let escaped = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }

    for (const candidate of LINE_COMMENT_TYPES) {
      if (line.startsWith(candidate.begin, index)) {
        return { index, line: true, ...candidate };
      }
    }

    for (const candidate of BLOCK_COMMENT_TYPES) {
      if (line.startsWith(candidate.begin, index)) {
        return { index, line: false, ...candidate };
      }
    }
  }

  return null;
}

function tokenizeLine(line, state) {
  if (state.blockComment) {
    const endIndex = line.indexOf(state.blockComment.end);
    if (endIndex === -1) {
      return {
        html: state.blockComment.type === 'comment-doc' ? renderDocComment(line) : wrap(state.blockComment.type, line),
        state
      };
    }

    const current = state.blockComment;
    state.blockComment = null;
    return {
      html:
        (current.type === 'comment-doc'
          ? renderDocComment(line.slice(0, endIndex + current.end.length))
          : wrap(current.type, line.slice(0, endIndex + current.end.length))) +
        tokenizeLine(line.slice(endIndex + current.end.length), state).html,
      state
    };
  }

  const comment = findCommentStart(line);
  if (comment) {
    const before = tokenizeLine(line.slice(0, comment.index), state).html;
    const after = line.slice(comment.index);

    if (comment.line) {
      return {
        html: before + (comment.type === 'comment-doc' ? renderDocComment(after) : wrap(comment.type, after)),
        state
      };
    }

    const endIndex = after.indexOf(comment.end);

    if (endIndex === -1) {
      state.blockComment = comment;
      return {
        html: before + (comment.type === 'comment-doc' ? renderDocComment(after) : wrap(comment.type, after)),
        state
      };
    }

    return {
      html:
        before +
        (comment.type === 'comment-doc'
          ? renderDocComment(after.slice(0, endIndex + comment.end.length))
          : wrap(comment.type, after.slice(0, endIndex + comment.end.length))) +
        tokenizeLine(after.slice(endIndex + comment.end.length), state).html,
      state
    };
  }

  const patterns = [
    ['space', /\s+/y],
    ['directive', /\baeon:[A-Za-z][A-Za-z0-9_.:-]*\b/y],
    ['node-open', new RegExp(`<${IDENTIFIER}`, 'y')],
    ['attr-open', /@\{/y],
    ['attr-close', /\}/y],
    ['quoted-key', new RegExp(`${QUOTED_KEY}(?=\\s*(?:${TYPE_ANNOTATION}\\s*=|@\\{|=))`, 'y')],
    ['typed-key', new RegExp(`${KEY}(?=\\s*${TYPE_ANNOTATION}\\s*=)`, 'y')],
    ['typed-value', new RegExp(`${TYPE_ANNOTATION}(?=\\s*=)`, 'y')],
    ['key', new RegExp(`${KEY}(?=\\s*(?:@\\{|=))`, 'y')],
    ['trimtick-string', />{1,4}`(?:\\.|[^`])*`/y],
    ['string-template', /`(?:\\.|[^`])*`/y],
    ['string', /"(?:\\.|[^"])*"|'(?:\\.|[^'])*'/y],
    ['datetime', /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z)?&[A-Za-z0-9_./+-]+\b/y],
    ['datetime', /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\b/y],
    ['datetime', /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\b/y],
    ['time', /\b\d{2}:\d{2}:\d{2}(?:Z)?\b/y],
    ['date', /\b\d{4}-\d{2}-\d{2}\b/y],
    ['wtc', /\b(?:Z&|&)(?:[A-Za-z0-9_./+-]+)\b/y],
    ['literal-word', /-?(?:Infinity|NaN)\b/y],
    ['literal-word', /![A-Za-z_][A-Za-z0-9_]*\b/y],
    ['bool', /\b(?:true|false)\b/y],
    ['switch', /\b(?:yes|no|on|off)\b/y],
    ['number-sigil', /[#%$^][^\s,\])}]+/y],
    ['float', /(?<![A-Za-z0-9_])[+-]?\d[\d_]*\.\d[\d_]*(?:[eE][+-]?\d[\d_]*)?(?![A-Za-z0-9_])/y],
    ['number', /(?<![A-Za-z0-9_])[+-]?\d[\d_]*(?:[eE][+-]?\d[\d_]*)?(?![A-Za-z0-9_])/y],
    ['binding', new RegExp(`~>\\s*${REFERENCE_PATH}`, 'y')],
    ['binding', new RegExp(`~(?!>)${REFERENCE_PATH}`, 'y')],
    ['operator', /=/y],
    ['punct', /[,()[\]{}<>.]/y],
    ['type', new RegExp(TYPE_ANNOTATION, 'y')],
    ['attribute-key', new RegExp(`${IDENTIFIER}(?=\\s*=)`, 'y')],
    ['identifier', new RegExp(IDENTIFIER, 'y')]
  ];

  let html = '';
  let index = 0;

  while (index < line.length) {
    let matched = false;

    for (const [type, re] of patterns) {
      re.lastIndex = index;
      const match = re.exec(line);
      if (!match) continue;

      matched = true;
      index = re.lastIndex;

      switch (type) {
        case 'space':
          html += match[0];
          break;
        case 'node-open':
          html += wrap('tag-punct', '<') + wrap('tag', match[0].slice(1));
          break;
        case 'attr-open':
        case 'attr-close':
          html += wrap('attribute-punct', match[0]);
          break;
        case 'typed-key':
        case 'key':
          html += wrap('key', match[0]);
          break;
        case 'quoted-key':
          html += wrap('quoted-key', match[0]);
          break;
        case 'typed-value':
        case 'type':
          html += wrap('punct', ':') + wrap('type', match[0].slice(1));
          break;
        case 'attribute-key':
          html += wrap('attribute', match[0]);
          break;
        case 'directive':
          html += wrap('directive', match[0]);
          break;
        case 'string':
        case 'string-template':
        case 'trimtick-string':
          html += wrap('string', match[0]);
          break;
        case 'datetime':
        case 'time':
        case 'date':
        case 'wtc':
        case 'literal-word':
        case 'bool':
        case 'switch':
        case 'number-sigil':
        case 'float':
        case 'number':
          html += wrap('literal', match[0]);
          break;
        case 'binding':
          html += wrap('binding', match[0]);
          break;
        case 'operator':
          html += wrap('operator', match[0]);
          break;
        case 'punct':
          html += wrap('punct', match[0]);
          break;
        default:
          html += escapeHtml(match[0]);
      }
      break;
    }

    if (!matched) {
      html += escapeHtml(line[index]);
      index += 1;
    }
  }

  return { html, state };
}

export function highlightAeon(source) {
  const state = { blockComment: null };
  return source
    .split('\n')
    .map((line) => tokenizeLine(line, state).html)
    .join('\n');
}

const templateHtml = `
  <style>
    :host {
      --aeon-bg: #111827;
      --aeon-panel: #172131;
      --aeon-border: #233247;
      --aeon-fg: #e5e7eb;
      --aeon-muted: #9aa6b2;
      --aeon-key: #7fb2ff;
      --aeon-type: #c7b8ff;
      --aeon-attribute: #caa0bf;
      --aeon-attribute-punct: #d8b070;
      --aeon-tag: #e2c97a;
      --aeon-string: #d9c58b;
      --aeon-literal: #c7d98a;
      --aeon-directive: #8ec7d9;
      --aeon-comment: #a8adb8;
      --aeon-comment-doc: #9aa9c7;
      --aeon-comment-annotation: #7fc7d4;
      --aeon-comment-hint: #d9ad7c;
      --aeon-comment-host: #a7b2c4;
      --aeon-punct: #8d96a6;
      --aeon-shadow: 0 14px 40px rgba(0, 0, 0, 0.28);
      display: block;
      color: var(--aeon-fg);
      font-family: "IBM Plex Mono", "SFMono-Regular", Consolas, monospace;
    }

    .frame {
      overflow: hidden;
      border: 1px solid var(--aeon-border);
      border-radius: 18px;
      background: linear-gradient(180deg, var(--aeon-panel) 0%, var(--aeon-bg) 100%);
      box-shadow: var(--aeon-shadow);
    }

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.8rem 1rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      background: rgba(255, 255, 255, 0.03);
    }

    .title {
      font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
      font-size: 0.82rem;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--aeon-muted);
    }

    button {
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.05);
      color: var(--aeon-fg);
      padding: 0.45rem 0.8rem;
      font: inherit;
      font-size: 0.78rem;
      cursor: pointer;
      transition: background 140ms ease, transform 140ms ease;
    }

    button:hover {
      background: rgba(255, 255, 255, 0.1);
      transform: translateY(-1px);
    }

    pre {
      margin: 0;
      padding: 1rem 1.1rem 1.2rem;
      overflow-x: auto;
      font-size: 0.95rem;
      line-height: 1.7;
      tab-size: 2;
      white-space: pre;
    }

    .tok-comment { color: var(--aeon-comment); font-style: italic; }
    .tok-comment-doc { color: var(--aeon-comment-doc); font-style: normal; }
    .tok-comment-annotation { color: var(--aeon-comment-annotation); font-style: italic; }
    .tok-comment-hint { color: var(--aeon-comment-hint); font-style: italic; }
    .tok-comment-host { color: var(--aeon-comment-host); font-style: italic; }
    .tok-comment-structure,
    .tok-comment-profile,
    .tok-comment-future { color: var(--aeon-comment); font-style: italic; }
    .tok-and-header,
    .tok-and-heading { color: var(--aeon-fg); font-weight: 700; font-style: normal; }
    .tok-and-version,
    .tok-and-heading-marker,
    .tok-and-rule,
    .tok-and-table-pipe,
    .tok-and-link-separator { color: var(--aeon-comment-doc); font-style: normal; }
    .tok-and-strong { color: var(--aeon-fg); font-weight: 700; font-style: normal; }

    .tok-and-list-marker,
    .tok-and-list-text,
    .tok-and-quote,
    .tok-and-quote-text,
    .tok-and-emphasis {
      color: var(--aeon-comment-doc);
      color: color-mix(in srgb, var(--aeon-comment-doc) 72%, var(--aeon-fg));
      font-style: italic;
    }
    .tok-and-code {
      color: var(--aeon-fg);
      color: color-mix(in srgb, var(--aeon-fg) 88%, #fff);
      font-style: normal;
      background: rgba(255, 255, 255, 0.06);
      border-radius: 6px;
      padding: 0 0.2em;
    }
    .tok-and-link { color: var(--aeon-directive); font-style: normal; }
    .tok-and-link-target { color: var(--aeon-string); font-style: normal; }
    .tok-and-fence,
    .tok-and-extension-fence {
      color: var(--aeon-attribute-punct);
      color: color-mix(in srgb, var(--aeon-attribute-punct) 78%, var(--aeon-fg));
      font-style: normal;
    }
    .tok-and-fence-label,
    .tok-and-extension-name,
    .tok-and-escape { color: var(--aeon-type); font-style: normal; }
    .tok-and-invalid { color: #ff9b9b; text-decoration: underline wavy rgba(255, 155, 155, 0.75); font-style: normal; }
    .tok-directive { color: var(--aeon-directive); }
    .tok-key { color: var(--aeon-key); }
    .tok-quoted-key { color: #4f9cff; }
    .tok-type { color: var(--aeon-type); }
    .tok-attribute { color: var(--aeon-attribute); }
    .tok-attribute-punct { color: var(--aeon-attribute-punct); }
    .tok-tag { color: var(--aeon-tag); font-weight: 700; }
    .tok-tag-punct,
    .tok-punct { color: var(--aeon-punct); }
    .tok-string { color: var(--aeon-string); }
    .tok-literal { color: var(--aeon-literal); }
    .tok-binding { color: var(--aeon-key); }
    .tok-operator { color: var(--aeon-fg); }
  </style>
  <div class="frame">
    <div class="header">
      <div class="title"></div>
      <button type="button">Copy</button>
    </div>
    <pre><code></code></pre>
  </div>
`;

if (typeof document !== 'undefined' && typeof HTMLElement !== 'undefined' && typeof customElements !== 'undefined') {
  const template = document.createElement('template');
  template.innerHTML = templateHtml;

  class AeonCodeBlock extends HTMLElement {
    static get observedAttributes() {
      return ['title', 'show-copy'];
    }

    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this.shadowRoot.appendChild(template.content.cloneNode(true));
      this.titleEl = this.shadowRoot.querySelector('.title');
      this.copyButton = this.shadowRoot.querySelector('button');
      this.codeEl = this.shadowRoot.querySelector('code');
      this.copyButton.addEventListener('click', async () => {
        const source = this.sourceText();
        try {
          if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(source);
          } else {
            const textarea = document.createElement('textarea');
            textarea.value = source;
            textarea.setAttribute('readonly', '');
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            textarea.style.pointerEvents = 'none';
            document.body.appendChild(textarea);
            textarea.focus();
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
          }
          this.copyButton.textContent = 'Copied';
          window.setTimeout(() => {
            this.copyButton.textContent = 'Copy';
          }, 1400);
        } catch {
          this.copyButton.textContent = 'Copy failed';
          window.setTimeout(() => {
            this.copyButton.textContent = 'Copy';
          }, 1400);
        }
      });
    }

    connectedCallback() {
      this.render();
    }

    attributeChangedCallback() {
      this.render();
    }

    sourceText() {
      const codeAttr = this.getAttribute('code');
      if (codeAttr) return codeAttr;
      const script = this.querySelector('script[type="text/plain"]');
      if (script) return script.textContent.replace(/^\n/, '').replace(/\n\s*$/, '');
      const template = this.querySelector('template');
      if (template) return template.textContent.replace(/^\n/, '').replace(/\n\s*$/, '');
      return this.textContent.replace(/^\n/, '').replace(/\n\s*$/, '');
    }

    render() {
      const title = this.getAttribute('title') || DEFAULT_TITLE;
      const showCopy = this.getAttribute('show-copy') !== 'false';
      const source = this.sourceText();

      this.titleEl.textContent = title;
      this.copyButton.hidden = !showCopy;
      this.codeEl.innerHTML = highlightAeon(source);
    }
  }

  if (!customElements.get('aeon-code-block')) {
    customElements.define('aeon-code-block', AeonCodeBlock);
  }
}

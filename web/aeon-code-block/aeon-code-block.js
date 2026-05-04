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

function renderDocMarkdownInline(value) {
  const parts = [];
  const pattern = /(`[^`]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_)/g;
  let index = 0;

  for (const match of value.matchAll(pattern)) {
    const token = match[0];
    const start = match.index ?? 0;
    if (start > index) {
      parts.push(escapeHtml(value.slice(index, start)));
    }

    if (token.startsWith('`')) {
      parts.push(wrap('md-code', token));
    } else if (token.startsWith('**') || token.startsWith('__')) {
      parts.push(wrap('md-bold', token));
    } else {
      parts.push(wrap('md-italic', token));
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
    const heading = /^(\s{0,3}#{1,6}\s+)(.*)$/.exec(line);
    if (heading) {
      return `${wrap('comment-doc', heading[1])}${wrap('md-heading', heading[2])}`;
    }

    const list = /^(\s*(?:[-*+]\s+|\d+\.\s+))(.*)$/.exec(line);
    if (list) {
      return `${wrap('md-list-marker', list[1])}${wrapRaw('comment-doc', renderDocMarkdownInline(list[2]))}`;
    }

    return wrapRaw('comment-doc', renderDocMarkdownInline(line));
  });

  return rendered.join('\n');
}

function findBlockCommentStart(line) {
  let match = null;
  for (const candidate of BLOCK_COMMENT_TYPES) {
    const index = line.indexOf(candidate.begin);
    if (index === -1) continue;
    if (!match || index < match.index) {
      match = { index, ...candidate };
    }
  }
  return match;
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

  if (/^\s*\/\/#/.test(line)) return { html: renderDocComment(line), state };
  if (/^\s*\/\/@/.test(line)) return { html: wrap('comment-annotation', line), state };
  if (/^\s*\/\/\?/.test(line)) return { html: wrap('comment-hint', line), state };
  if (/^\s*\/\/!/.test(line)) return { html: wrap('comment-host', line), state };
  if (/^\s*\/\/\{/.test(line)) return { html: wrap('comment-structure', line), state };
  if (/^\s*\/\/\[/.test(line)) return { html: wrap('comment-profile', line), state };
  if (/^\s*\/\/\(/.test(line)) return { html: wrap('comment-future', line), state };
  if (/^\s*\/\//.test(line)) return { html: wrap('comment', line), state };

  const blockComment = findBlockCommentStart(line);
  if (blockComment) {
    const before = tokenizeLine(line.slice(0, blockComment.index), state).html;
    const after = line.slice(blockComment.index);
    const endIndex = after.indexOf(blockComment.end);

    if (endIndex === -1) {
      state.blockComment = blockComment;
      return {
        html: before + (blockComment.type === 'comment-doc' ? renderDocComment(after) : wrap(blockComment.type, after)),
        state
      };
    }

    return {
      html:
        before +
        (blockComment.type === 'comment-doc'
          ? renderDocComment(after.slice(0, endIndex + blockComment.end.length))
          : wrap(blockComment.type, after.slice(0, endIndex + blockComment.end.length))) +
        tokenizeLine(after.slice(endIndex + blockComment.end.length), state).html,
      state
    };
  }

  const patterns = [
    ['space', /\s+/y],
    ['directive', /\baeon:[A-Za-z][A-Za-z0-9_.:-]*\b/y],
    ['node-open', /<[A-Za-z_][A-Za-z0-9_:-]*/y],
    ['attr-open', /@\{/y],
    ['attr-close', /\}/y],
    ['typed-key', /(?:[A-Za-z_][A-Za-z0-9_:-]*|"(?:\\.|[^"])*"|'(?:\\.|[^'])*')(?=\s*:)/y],
    ['key', /(?:[A-Za-z_][A-Za-z0-9_:-]*|"(?:\\.|[^"])*"|'(?:\\.|[^'])*')(?=\s*(?:@\{|=))/y],
    ['string-template', /`(?:\\.|[^`])*`/y],
    ['string', /"(?:\\.|[^"])*"|'(?:\\.|[^'])*'/y],
    ['datetime', /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z)?&[A-Za-z0-9_./+-]+\b/y],
    ['datetime', /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\b/y],
    ['datetime', /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\b/y],
    ['time', /\b\d{2}:\d{2}:\d{2}(?:Z)?\b/y],
    ['date', /\b\d{4}-\d{2}-\d{2}\b/y],
    ['zrut', /\b(?:Z&|&)(?:[A-Za-z0-9_./+-]+)\b/y],
    ['bool', /\b(?:true|false)\b/y],
    ['switch', /\b(?:yes|no|on|off)\b/y],
    ['number-sigil', /[#%$^][^\s,\])}]+/y],
    ['float', /(?<![A-Za-z0-9_])[+-]?\d[\d_]*\.\d[\d_]*(?:[eE][+-]?\d[\d_]*)?(?![A-Za-z0-9_])/y],
    ['number', /(?<![A-Za-z0-9_])[+-]?\d[\d_]*(?:[eE][+-]?\d[\d_]*)?(?![A-Za-z0-9_])/y],
    ['binding', /~>\s*\$?(?:\.?[A-Za-z_][A-Za-z0-9_]*|\[\d+\]|\[@?"(?:\\.|[^"])*"\]|@\[[^\]]+\]|@[A-Za-z_][A-Za-z0-9_]*)+/y],
    ['binding', /~\$?(?:\.?[A-Za-z_][A-Za-z0-9_]*|\[\d+\]|\["(?:\\.|[^"])*"\]|@\[[^\]]+\]|@[A-Za-z_][A-Za-z0-9_]*)+/y],
    ['operator', /=/y],
    ['punct', /[,()[\]{}]/y],
    ['type', /:[A-Za-z_][A-Za-z0-9_]*(?:<[^>\n]+>|\[[^\]\n]+\])?/y],
    ['attribute-key', /[A-Za-z_][A-Za-z0-9_:-]*(?=\s*=)/y],
    ['identifier', /[A-Za-z_][A-Za-z0-9_:-]*/y]
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
          html += wrap('string', match[0]);
          break;
        case 'datetime':
        case 'time':
        case 'date':
        case 'zrut':
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
    .tok-comment-doc { color: var(--aeon-comment-doc); font-style: italic; }
    .tok-comment-annotation { color: var(--aeon-comment-annotation); font-style: italic; }
    .tok-comment-hint { color: var(--aeon-comment-hint); font-style: italic; }
    .tok-comment-host { color: var(--aeon-comment-host); font-style: italic; }
    .tok-comment-structure,
    .tok-comment-profile,
    .tok-comment-future { color: var(--aeon-comment); font-style: italic; }
    .tok-md-heading { color: var(--aeon-fg); font-weight: 700; font-style: normal; }
    .tok-md-list-marker { color: var(--aeon-comment-doc); font-style: normal; }
    .tok-md-bold { color: var(--aeon-fg); font-weight: 700; font-style: normal; }
    .tok-md-italic { color: var(--aeon-comment-doc); font-style: italic; }
    .tok-md-code {
      color: var(--aeon-fg);
      font-style: normal;
      background: rgba(255, 255, 255, 0.06);
      border-radius: 6px;
      padding: 0 0.2em;
    }
    .tok-directive { color: var(--aeon-directive); }
    .tok-key { color: var(--aeon-key); }
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

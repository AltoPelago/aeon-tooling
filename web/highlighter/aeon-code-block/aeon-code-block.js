import {highlightAeon} from '@altopelago/aeon-highlight';
export {highlightAeon};
const DEFAULT_TITLE = 'Code';

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
      --aeon-number: #7dd3fc;
      --aeon-temporal: #f5e6a8;
      --aeon-symbol: #50dabe;
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
    .tok-number { color: var(--aeon-number); }
    .tok-temporal { color: var(--aeon-temporal); }
    .tok-identity { color: var(--aeon-tag, #e2c97a); }
    .tok-symbol { color: var(--aeon-symbol); }
    .tok-sansa { color: var(--aeon-symbol); }
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

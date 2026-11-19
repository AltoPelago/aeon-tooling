import { highlightAeon, highlightJson } from '/vendor/aeon-highlight/index.js';
import { highlightSansa } from './editor-highlighting.js';

const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const span = (role, text) => role ? `<span class="tok-${role}">${escape(text)}</span>` : escape(text);
const number = /^[+-]?(?:0[xob][\da-fA-F_]+|(?:\d[\d_]*(?:\.[\d_]*)?|\.[\d_]+)(?:[eE][+-]?[\d_]+)?|\.inf|\.nan)$/i;

// Small presentation scanners for source formats without a shared browser
// highlighter. They preserve all source text, including incomplete/invalid input;
// adapters remain the only authority on accepted syntax and inferred kinds.
function highlightConfig(source, yaml) {
  let html = '', i = 0, blockIndent = null;
  while (i < source.length) {
    if (i === 0 || source[i - 1] === '\n') {
      const end = source.indexOf('\n', i), lineEnd = end < 0 ? source.length : end;
      const line = source.slice(i, lineEnd), indent = line.match(/^[ \t]*/)[0].length;
      if (blockIndent !== null) {
        if (!line.trim() || indent > blockIndent) {
          html += span('string', line); i = lineEnd;
          if (i < source.length) { html += '\n'; i++; }
          continue;
        }
        blockIndent = null;
      }
      if (!yaml && line.trimStart().startsWith('[')) {
        const close = line.lastIndexOf(']');
        if (close >= 0) { html += span('type', line.slice(0, close + 1)); i += close + 1; continue; }
      }
      if (yaml && /^(?:%YAML\b|---(?:\s|$)|\.\.\.(?:\s|$))/.test(line)) {
        html += span('directive', line); i = lineEnd; continue;
      }
    }
    const start = i, ch = source[i];
    let role;
    if (ch === '#') {
      const end = source.indexOf('\n', i); i = end < 0 ? source.length : end; role = 'comment';
    } else if (ch === '"' || ch === "'") {
      const triple = !yaml && source.startsWith(ch.repeat(3), i), delimiter = triple ? ch.repeat(3) : ch;
      i += delimiter.length;
      while (i < source.length) {
        if (ch === '"' && source[i] === '\\') { i = Math.min(i + 2, source.length); continue; }
        if (yaml && ch === "'" && source.startsWith("''", i)) { i += 2; continue; }
        if (source.startsWith(delimiter, i)) { i += delimiter.length; break; }
        i++;
      }
      const next = source.slice(i).match(/^[ \t]*([=:])/);
      role = next?.[1] === (yaml ? ':' : '=') ? 'key' : 'string';
    } else if (yaml && (ch === '|' || ch === '>')) {
      const lineStart = source.lastIndexOf('\n', i - 1) + 1;
      const prefix = source.slice(lineStart, i);
      if (/(?:^|:|-)\s*$/.test(prefix)) blockIndent = prefix.match(/^[ \t]*/)[0].length;
      i++; while (i < source.length && /[+\-1-9]/.test(source[i])) i++;
      role = 'operator';
    } else if (yaml && /[!&*]/.test(ch)) {
      i++; while (i < source.length && !/[\s,\[\]{}]/.test(source[i])) i++;
      role = 'type';
    } else if (/\s/.test(ch)) {
      i++;
    } else if (/[\[\]{}=,:]/.test(ch) || (yaml && ch === '-' && /\s/.test(source[i + 1] ?? ''))) {
      i++; role = ch === '=' ? 'operator' : 'punct';
    } else {
      i++; while (i < source.length && !/[\s\[\]{}=,]/.test(source[i]) &&
        !(source[i] === '#' && !yaml) &&
        !(source[i] === ':' && yaml && /[\s\[\]{},]/.test(source[i + 1] ?? ' '))) i++;
      const text = source.slice(start, i);
      const next = source.slice(i).match(/^[ \t]*([=:])/);
      if (next?.[1] === (yaml ? ':' : '=')) role = 'key';
      else if (/^(?:true|false|null|~)$/i.test(text) || (!yaml && /^[+-]?(?:inf|nan)$/.test(text))) role = 'literal';
      else if (!yaml && /^\d{4}-\d\d-\d\d(?:[Tt ].*)?$|^\d\d:\d\d:\d\d/.test(text)) role = 'temporal';
      else if (number.test(text)) role = 'number';
      else if (yaml) role = 'string';
    }
    html += span(role, source.slice(start, i));
  }
  return html;
}

function highlightXml(source) {
  let html = '', i = 0, inTag = false, tagName = false;
  while (i < source.length) {
    const start = i;
    let role;
    const marker = [['<!--', '-->', 'comment'], ['<![CDATA[', ']]>', 'string'], ['<?', '?>', 'directive']]
      .find(([open]) => source.startsWith(open, i));
    if (marker) {
      const end = source.indexOf(marker[1], i + marker[0].length);
      i = end < 0 ? source.length : end + marker[1].length; role = marker[2];
    } else if (source[i] === '<') {
      i += source[i + 1] === '/' ? 2 : 1; inTag = true; tagName = true; role = 'punct';
    } else if (inTag && (source[i] === '>' || source.startsWith('/>', i))) {
      i += source[i] === '/' ? 2 : 1; inTag = false; role = 'punct';
    } else if (inTag && (source[i] === '"' || source[i] === "'")) {
      const end = source.indexOf(source[i], i + 1); i = end < 0 ? source.length : end + 1; role = 'string';
    } else if (source[i] === '&') {
      i++; while (i < source.length && !/[;\s<&]/.test(source[i])) i++;
      if (source[i] === ';') i++;
      role = 'literal';
    } else if (inTag && source[i] === '=') { i++; role = 'operator';
    } else if (inTag && !/\s/.test(source[i])) {
      i++; while (i < source.length && !/[\s<>=/"']/.test(source[i])) i++;
      role = tagName ? 'tag' : 'attribute'; tagName = false;
    } else if (!inTag) {
      i++; while (i < source.length && !/[<&]/.test(source[i])) i++;
      role = 'string';
    } else { i++; }
    html += span(role, source.slice(start, i));
  }
  return html;
}

export function highlightTelex(source) {
  if (source.length > 1_048_576) return escape(source);
  let kind;
  return source.split(/(\r?\n)/).map(line => {
    if (!line.trim()) { if (!line.includes('\n')) kind = undefined; return line; }
    const equals = line.indexOf('=');
    if (equals < 0) return escape(line);
    const key = line.slice(0, equals), value = line.slice(equals + 1);
    if (key === 'kind') kind = value;
    let payload;
    if (key === 'path') payload = highlightSansa(value);
    else if (key === 'kind' || key === 'datatype') payload = span('type', value);
    else if (key === 'value') payload = span(
      kind === 'NumberLiteral' || kind === 'RadixLiteral' ? 'number' :
      /^(?:Date|Time|DateTime|WTCDateTime)Literal$/.test(kind) ? 'temporal' :
      /^(?:Boolean|Null|Toggle|Infinity|NaN)Literal$/.test(kind) ? 'literal' :
      kind === 'SymbolicLiteral' ? 'symbol' : kind === 'NodeHead' ? 'tag' : 'string', value);
    else payload = escape(value);
    return span(key === 'telex.aes' ? 'directive' : 'key', key) + span('operator', '=') + payload;
  }).join('');
}

export function highlightSource(source, format) {
  if (source.length > 1_048_576) return escape(source);
  switch (format) {
    case 'json': return highlightJson(source);
    case 'aeon': return highlightAeon(source);
    case 'toml': return highlightConfig(source, false);
    case 'yaml': return highlightConfig(source, true);
    case 'xml': return highlightXml(source);
    case 'alog': {
      const header = source.match(/^&LOG v\d+[^\r\n]*/)?.[0];
      return header ? span('directive', header) + highlightAeon(source.slice(header.length)) : highlightAeon(source);
    }
    case 'telex': return highlightTelex(source);
    default: return escape(source);
  }
}

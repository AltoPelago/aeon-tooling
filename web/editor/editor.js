// ─────────────────────────────────────────────
// &ND Block Editor
// ─────────────────────────────────────────────

// ── Utilities ────────────────────────────────

let _id = 0;
const uid = () => 'b' + (++_id) + '_' + Math.random().toString(36).slice(2, 7);

// ── Data Model ───────────────────────────────

/** @type {{ blocks: Array<{id:string, versions:string[], focusedIndex:number}>, activeBlockId:string|null, snippets:string[], ndVersion: 'v1' | 'v2' }} */
const state = {
  blocks: [{ id: uid(), versions: [''], focusedIndex: 0 }],
  activeBlockId: null,
  snippets: [],
  ndVersion: 'v2',
};

function getBlock(id) { return state.blocks.find(b => b.id === id); }
function blockIndex(id) { return state.blocks.findIndex(b => b.id === id); }
function activeText(block) { return block.versions[block.focusedIndex]; }

// ── Undo / Redo ──────────────────────────────

const MAX_UNDO = 200;
const undoStack = [];
const redoStack = [];

/** Deep-clone the mutable parts of state into a plain snapshot. */
function snapshotState() {
  return {
    blocks: state.blocks.map(b => ({
      id: b.id,
      versions: b.versions.slice(),
      focusedIndex: b.focusedIndex,
    })),
    snippets: state.snippets.slice(),
    activeBlockId: state.activeBlockId,
    ndVersion: state.ndVersion,
  };
}

/** Push current state onto the undo stack (call BEFORE mutating). */
function pushUndo() {
  flushTextSnapshot();           // commit any pending text debounce
  undoStack.push(snapshotState());
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack.length = 0;          // new action clears redo
}

/** Restore a snapshot into the live state and re-render. */
function restoreSnapshot(snap) {
  state.blocks = snap.blocks;
  state.snippets = snap.snippets;
  state.activeBlockId = snap.activeBlockId;
  state.ndVersion = snap.ndVersion || 'v2';
  render();
  if (state.activeBlockId) {
    focusBlock(state.activeBlockId);
  }
}

function undo() {
  if (undoStack.length === 0) return;
  flushTextSnapshot();
  redoStack.push(snapshotState());
  restoreSnapshot(undoStack.pop());
}

function redo() {
  if (redoStack.length === 0) return;
  undoStack.push(snapshotState());
  restoreSnapshot(redoStack.pop());
}

// Debounced text-input snapshots so we don't push on every keystroke.
let _textUndoTimer = null;
let _textSnapshotPending = null;

function scheduleTextSnapshot() {
  // Capture state NOW (before further edits), but only push after a pause.
  if (_textSnapshotPending === null) {
    _textSnapshotPending = snapshotState();
  }
  clearTimeout(_textUndoTimer);
  _textUndoTimer = setTimeout(flushTextSnapshot, 800);
}

function flushTextSnapshot() {
  clearTimeout(_textUndoTimer);
  if (_textSnapshotPending !== null) {
    undoStack.push(_textSnapshotPending);
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack.length = 0;
    _textSnapshotPending = null;
  }
}

// ── Scroll position helpers ──────────────────

/**
 * Capture scroll position relative to a specific element so we can restore
 * the viewport to the same visual position after a DOM mutation.
 */
function captureScrollAnchor(el) {
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  return { el, top: rect.top, scrollY: window.scrollY };
}

/**
 * Restore scroll so that the anchor element stays at the same visual position.
 */
function restoreScrollAnchor(anchor) {
  if (!anchor || !anchor.el || !anchor.el.isConnected) return;
  const newRect = anchor.el.getBoundingClientRect();
  const drift = newRect.top - anchor.top;
  if (Math.abs(drift) > 1) {
    window.scrollTo({ top: window.scrollY + drift, behavior: 'instant' });
  }
}

// ── Block Operations ─────────────────────────

function splitBlock(blockId, lineIndex) {
  const b = getBlock(blockId);
  if (!b) return;
  pushUndo();
  const idx = blockIndex(blockId);

  // Anchor scroll to the block being split
  const blockEl = article.querySelector(`[data-block-id="${blockId}"]`);
  const anchor = captureScrollAnchor(blockEl);

  const newVersionsAbove = [];
  const newVersionsBelow = [];

  for (const v of b.versions) {
    const lines = v.split('\n');
    newVersionsAbove.push(lines.slice(0, lineIndex).join('\n'));
    newVersionsBelow.push(lines.slice(lineIndex).join('\n'));
  }

  const above = { id: uid(), versions: newVersionsAbove, focusedIndex: b.focusedIndex };
  const below = { id: uid(), versions: newVersionsBelow, focusedIndex: b.focusedIndex };

  state.blocks.splice(idx, 1, above, below);
  render();
  restoreScrollAnchor(anchor);
  focusBlock(below.id, 0);
}

function joinBlocks(upperBlockId, lowerBlockId) {
  const a = getBlock(upperBlockId);
  const b = getBlock(lowerBlockId);
  if (!a || !b) return;
  pushUndo();

  // Anchor scroll to the upper block
  const blockEl = article.querySelector(`[data-block-id="${upperBlockId}"]`);
  const anchor = captureScrollAnchor(blockEl);

  // Collect non-active versions as snippets before merging
  const collectSnippets = (block) => {
    block.versions.forEach((text, i) => {
      if (i !== block.focusedIndex && text.trim()) {
        state.snippets.push(text);
      }
    });
  };
  collectSnippets(a);
  collectSnippets(b);

  // Only merge the active (visible) text from each block
  const mergedText = activeText(a) + '\n' + activeText(b);
  const cursorOffset = activeText(a).length + 1; // position after join point

  const joined = { id: uid(), versions: [mergedText], focusedIndex: 0 };
  const idxA = blockIndex(upperBlockId);
  const idxB = blockIndex(lowerBlockId);
  const removeStart = Math.min(idxA, idxB);
  state.blocks.splice(removeStart, 2, joined);

  render();
  restoreScrollAnchor(anchor);
  focusBlock(joined.id, cursorOffset);
}

function addVersion(blockId, copy = true) {
  const b = getBlock(blockId);
  if (!b) return;
  pushUndo();
  const newText = copy ? activeText(b) : '';
  b.versions.splice(b.focusedIndex + 1, 0, newText);
  b.focusedIndex = b.focusedIndex + 1;
  renderBlock(b);
  focusBlock(b.id, 0);
}

function switchVersion(blockId, delta) {
  const b = getBlock(blockId);
  if (!b) return;
  const next = b.focusedIndex + delta;
  if (next < 0 || next >= b.versions.length) return;
  pushUndo();
  b.focusedIndex = next;
  renderBlock(b);
  focusBlock(b.id);
}

function deleteVersion(blockId) {
  const b = getBlock(blockId);
  if (!b || b.versions.length <= 1) return;
  pushUndo();
  b.versions.splice(b.focusedIndex, 1);
  b.focusedIndex = Math.min(b.focusedIndex, b.versions.length - 1);
  renderBlock(b);
  focusBlock(b.id);
}

// ── AEON Serialization ───────────────────────

function escStr(s) {
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t') + '"';
}

function serializeAeon() {
  const lines = [`aeon:header = { profile = "aeon.editor.v1", nd_version = "${state.ndVersion}" }`, ''];
  state.blocks.forEach((b, i) => {
    lines.push(`block_${i} = {`);
    lines.push(`  id = ${escStr(b.id)}`);
    lines.push(`  focused = ${b.focusedIndex}`);
    lines.push(`  versions = (`);
    b.versions.forEach((v, j) => {
      const comma = j < b.versions.length - 1 ? ',' : '';
      lines.push(`    ${escStr(v)}${comma}`);
    });
    lines.push('  )');
    lines.push('}');
    lines.push('');
  });

  // Serialize snippets
  if (state.snippets.length > 0) {
    lines.push('snippets = (');
    state.snippets.forEach((s, i) => {
      const comma = i < state.snippets.length - 1 ? ',' : '';
      lines.push(`  ${escStr(s)}${comma}`);
    });
    lines.push(')');
    lines.push('');
  }

  return lines.join('\n');
}

function unescStr(s) {
  // Remove surrounding quotes, unescape
  let r = '', i = 0;
  while (i < s.length) {
    if (s[i] === '\\' && i + 1 < s.length) {
      const c = s[i + 1];
      if (c === 'n') { r += '\n'; i += 2; continue; }
      if (c === 'r') { r += '\r'; i += 2; continue; }
      if (c === 't') { r += '\t'; i += 2; continue; }
      if (c === '"') { r += '"'; i += 2; continue; }
      if (c === '\\') { r += '\\'; i += 2; continue; }
    }
    r += s[i]; i++;
  }
  return r;
}

function parseAeon(text) {
  const blocks = [];
  // Simple targeted parser for the editor format
  const blockRegex = /block_\d+\s*=\s*\{([^}]*versions\s*=\s*\([\s\S]*?\)\s*)\}/g;
  let m;
  while ((m = blockRegex.exec(text)) !== null) {
    const body = m[1];
    const idMatch = body.match(/id\s*=\s*"((?:[^"\\]|\\.)*)"/);
    const focusedMatch = body.match(/focused\s*=\s*(\d+)/);
    const versionsMatch = body.match(/versions\s*=\s*\(([\s\S]*)\)/);

    const id = idMatch ? unescStr(idMatch[1]) : uid();
    const focused = focusedMatch ? parseInt(focusedMatch[1], 10) : 0;
    const versions = [];

    if (versionsMatch) {
      const inner = versionsMatch[1];
      const strRegex = /"((?:[^"\\]|\\.)*)"/g;
      let sm;
      while ((sm = strRegex.exec(inner)) !== null) {
        versions.push(unescStr(sm[1]));
      }
    }

    if (versions.length === 0) versions.push('');
    blocks.push({ id, versions, focusedIndex: Math.min(focused, versions.length - 1) });
  }

  // Parse snippets
  const snippets = [];
  const snippetsMatch = text.match(/snippets\s*=\s*\(([\s\S]*?)\)/);
  if (snippetsMatch) {
    const inner = snippetsMatch[1];
    const strRegex = /"((?:[^"\\]|\\.)*)"/g;
    let sm;
    while ((sm = strRegex.exec(inner)) !== null) {
      snippets.push(unescStr(sm[1]));
    }
  }

  const ndVersionMatch = text.match(/nd_version\s*=\s*"(v1|v2)"/);
  const ndVersion = ndVersionMatch ? ndVersionMatch[1] : 'v2';

  return blocks.length > 0 ? { blocks, snippets, ndVersion } : null;
}

// ── &ND Export ────────────────────────────────

function exportAnd() {
  const parts = state.blocks.map(b => activeText(b));
  return `&ND ${state.ndVersion}\n\n` + parts.join('\n\n');
}

// ── File I/O ─────────────────────────────────

async function saveFile() {
  const content = serializeAeon();
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: 'document.aeon',
        types: [{ description: 'AEON Files', accept: { 'text/plain': ['.aeon'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
    } catch (e) { if (e.name !== 'AbortError') console.error(e); }
  } else {
    downloadBlob(content, 'document.aeon', 'text/plain');
  }
}

async function exportFile() {
  const content = exportAnd();
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: 'document.and',
        types: [{ description: '&ND Files', accept: { 'text/plain': ['.and'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
    } catch (e) { if (e.name !== 'AbortError') console.error(e); }
  } else {
    downloadBlob(content, 'document.and', 'text/plain');
  }
}

function downloadBlob(content, name, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

function openFile() {
  document.getElementById('file-input').click();
}

function handleFileOpen(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const result = parseAeon(reader.result);
    if (result) {
      state.blocks = result.blocks;
      state.snippets = result.snippets || [];
      state.ndVersion = result.ndVersion || 'v2';
      state.activeBlockId = null;
      render();
      updateNdVersionUi();
    }
  };
  reader.readAsText(file);
}

// ── Rendering ────────────────────────────────

const article = document.getElementById('article');

const STORAGE_KEY = 'nd-editor-state';

function autosave() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      blocks: state.blocks.map(b => ({
        id: b.id, versions: b.versions, focusedIndex: b.focusedIndex
      })),
      snippets: state.snippets,
      ndVersion: state.ndVersion,
    }));
  } catch (_) { /* quota exceeded — silent */ }
}

function autorestore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    // Support both old format (plain array) and new format (object)
    if (Array.isArray(parsed) && parsed.length > 0) {
      state.blocks = parsed;
      return true;
    }
    if (parsed && Array.isArray(parsed.blocks) && parsed.blocks.length > 0) {
      state.blocks = parsed.blocks;
      state.snippets = Array.isArray(parsed.snippets) ? parsed.snippets : [];
      state.ndVersion = parsed.ndVersion === 'v1' ? 'v1' : 'v2';
      return true;
    }
  } catch (_) { /* corrupt — ignore */ }
  return false;
}

/**
 * Full render — rebuilds all block DOM elements.
 * Used for initial load, file open, and structural changes (split/join).
 */
function render() {
  article.innerHTML = '';
  state.blocks.forEach((block) => {
    article.appendChild(createBlockElement(block));
  });
  autosave();
}

/**
 * Partial render — update a single block's DOM in-place without touching
 * other blocks or the scroll position.
 */
function renderBlock(block) {
  const existing = article.querySelector(`[data-block-id="${block.id}"]`);
  if (!existing) {
    // Block not found in DOM (shouldn't happen), fall back to full render
    render();
    return;
  }

  const scrollY = window.scrollY;
  const rect = existing.getBoundingClientRect();
  const viewportOffset = rect.top; // distance from top of viewport

  const replacement = createBlockElement(block);
  existing.replaceWith(replacement);

  // Restore scroll so the block stays at the same visual position
  const newRect = replacement.getBoundingClientRect();
  const drift = newRect.top - viewportOffset;
  if (Math.abs(drift) > 1) {
    window.scrollTo({ top: scrollY + drift, behavior: 'instant' });
  }

  autosave();
}

function createBlockElement(block) {
  const el = document.createElement('div');
  el.className = 'block' + (state.activeBlockId === block.id ? ' focused' : '');
  el.dataset.blockId = block.id;

  // Join zone top
  if (blockIndex(block.id) > 0) {
    const jt = document.createElement('div');
    jt.className = 'join-zone join-zone-top';
    jt.title = 'Join with block above';
    jt.addEventListener('click', () => {
      const idx = blockIndex(block.id);
      if (idx > 0) joinBlocks(state.blocks[idx - 1].id, block.id);
    });
    el.appendChild(jt);
  }

  // Block body
  const body = document.createElement('div');
  body.className = 'block-body';

  // Version viewport
  const viewport = document.createElement('div');
  viewport.className = 'version-viewport';

  const track = document.createElement('div');
  track.className = 'version-track';
  track.style.transform = `translateX(-${block.focusedIndex * 100}%)`;

  block.versions.forEach((text, vi) => {
    const pane = document.createElement('div');
    pane.className = 'version-pane';

    if (vi === block.focusedIndex) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.spellcheck = false;
      ta.placeholder = 'Start writing…';
      ta.rows = 1;
      ta.dataset.blockId = block.id;
      ta.dataset.versionIndex = vi;

      ta.addEventListener('input', () => {
        scheduleTextSnapshot();
        block.versions[block.focusedIndex] = ta.value;
        autoResize(ta);
        autosave();
      });

      // Prevent native undo/redo — we handle it globally
      ta.addEventListener('keydown', (ev) => {
        if ((ev.ctrlKey || ev.metaKey) && (ev.key === 'z' || ev.key === 'Z')) {
          ev.preventDefault();
        }
      });

      ta.addEventListener('focus', () => {
        state.activeBlockId = block.id;
        document.querySelectorAll('.block').forEach(b => b.classList.remove('focused'));
        el.classList.add('focused');
      });

      ta.addEventListener('keydown', handleTextareaKeydown);

      pane.appendChild(ta);

      // Schedule auto-resize after mount — use a height-preserving approach
      requestAnimationFrame(() => autoResize(ta));
    } else {
      const preview = document.createElement('div');
      preview.className = 'version-preview';
      preview.textContent = text || '\u00a0';
      pane.appendChild(preview);
    }
    track.appendChild(pane);
  });

  viewport.appendChild(track);
  body.appendChild(viewport);

  // Split zone (right edge)
  const splitZone = document.createElement('div');
  splitZone.className = 'split-zone';

  // Split line indicator
  const splitLine = document.createElement('div');
  splitLine.className = 'split-line';
  body.appendChild(splitLine);

  splitZone.addEventListener('mousemove', (e) => {
    const ta = el.querySelector('textarea');
    if (!ta) return;
    const rect = ta.getBoundingClientRect();
    const lineHeight = parseFloat(getComputedStyle(ta).lineHeight);
    const relY = e.clientY - rect.top + ta.scrollTop;
    const lineNum = Math.round(relY / lineHeight);
    const lineY = lineNum * lineHeight - ta.scrollTop + (ta.getBoundingClientRect().top - body.getBoundingClientRect().top);
    splitLine.style.top = lineY + 'px';
    splitLine.classList.add('visible');
    splitLine.dataset.lineIndex = lineNum;
  });

  splitZone.addEventListener('mouseleave', () => {
    splitLine.classList.remove('visible');
  });

  splitZone.addEventListener('click', () => {
    const lineIdx = parseInt(splitLine.dataset.lineIndex || '0', 10);
    const ta = el.querySelector('textarea');
    if (!ta) return;
    const lines = ta.value.split('\n');
    if (lineIdx > 0 && lineIdx < lines.length) {
      splitBlock(block.id, lineIdx);
    }
  });

  body.appendChild(splitZone);

  el.appendChild(body);

  // Version rail (dots)
  const rail = document.createElement('div');
  rail.className = 'version-rail' + (block.versions.length <= 1 ? ' single' : '');

  block.versions.forEach((_, vi) => {
    const dot = document.createElement('button');
    dot.className = 'version-dot' + (vi === block.focusedIndex ? ' active' : '');
    dot.title = `Version ${vi + 1}`;
    dot.addEventListener('click', () => {
      block.focusedIndex = vi;
      renderBlock(block);
      focusBlock(block.id);
    });
    rail.appendChild(dot);
  });

  el.appendChild(rail);

  // Join zone bottom
  if (blockIndex(block.id) < state.blocks.length - 1) {
    const jb = document.createElement('div');
    jb.className = 'join-zone join-zone-bottom';
    jb.title = 'Join with block below';
    jb.addEventListener('click', () => {
      const idx = blockIndex(block.id);
      if (idx < state.blocks.length - 1) joinBlocks(block.id, state.blocks[idx + 1].id);
    });
    el.appendChild(jb);
  }

  return el;
}

// Offscreen clone used for measuring textarea content height
// without collapsing or reflowing the live element.
let _measureClone = null;

function autoResize(ta) {
  if (!_measureClone) {
    _measureClone = document.createElement('textarea');
    _measureClone.setAttribute('aria-hidden', 'true');
    _measureClone.setAttribute('tabindex', '-1');
    _measureClone.style.cssText =
      'position:fixed;left:-9999px;top:0;visibility:hidden;overflow:hidden;' +
      'height:0;min-height:0;max-height:none;padding:0;border:0;';
    document.body.appendChild(_measureClone);
  }

  // Copy styles that affect text measurement
  const cs = getComputedStyle(ta);
  _measureClone.style.width = cs.width;
  _measureClone.style.fontFamily = cs.fontFamily;
  _measureClone.style.fontSize = cs.fontSize;
  _measureClone.style.lineHeight = cs.lineHeight;
  _measureClone.style.letterSpacing = cs.letterSpacing;
  _measureClone.style.wordSpacing = cs.wordSpacing;
  _measureClone.style.whiteSpace = cs.whiteSpace;
  _measureClone.style.wordWrap = cs.wordWrap;
  _measureClone.style.overflowWrap = cs.overflowWrap;
  _measureClone.style.paddingLeft = cs.paddingLeft;
  _measureClone.style.paddingRight = cs.paddingRight;
  _measureClone.style.paddingTop = cs.paddingTop;
  _measureClone.style.paddingBottom = cs.paddingBottom;
  _measureClone.style.boxSizing = cs.boxSizing;
  _measureClone.value = ta.value;

  // Measure
  _measureClone.style.height = '0';
  const needed = _measureClone.scrollHeight;

  // Only update live element if height actually changed
  const newH = needed + 'px';
  if (ta.style.height !== newH) {
    ta.style.height = newH;
  }
}

function focusBlock(blockId, cursorPos) {
  state.activeBlockId = blockId;
  requestAnimationFrame(() => {
    const ta = article.querySelector(`textarea[data-block-id="${blockId}"]`);
    if (ta) {
      // Use preventScroll to avoid the browser auto-scrolling to the textarea
      ta.focus({ preventScroll: true });
      if (typeof cursorPos === 'number') {
        const pos = Math.min(cursorPos, ta.value.length);
        ta.setSelectionRange(pos, pos);
      }
    }
  });
}

// ── Keyboard Handling ────────────────────────

function handleTextareaKeydown(e) {
  const ta = e.target;
  const blockId = ta.dataset.blockId;

  // Backspace at start → join with block above
  if (e.key === 'Backspace' && ta.selectionStart === 0 && ta.selectionEnd === 0) {
    const idx = blockIndex(blockId);
    if (idx > 0) {
      e.preventDefault();
      joinBlocks(state.blocks[idx - 1].id, blockId);
      return;
    }
  }

  // Delete at end → join with block below
  if (e.key === 'Delete' && ta.selectionStart === ta.value.length) {
    const idx = blockIndex(blockId);
    if (idx < state.blocks.length - 1) {
      e.preventDefault();
      joinBlocks(blockId, state.blocks[idx + 1].id);
      return;
    }
  }

  // Ctrl+Enter → split block at cursor line
  if (e.key === 'Enter' && !e.shiftKey && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    const pos = ta.selectionStart;
    const textBefore = ta.value.substring(0, pos);
    const lineIndex = textBefore.split('\n').length;
    splitBlock(blockId, lineIndex);
    return;
  }

  // Alt+Left/Right → switch version (works anywhere in text)
  if (e.altKey && !e.ctrlKey && !e.metaKey && e.key === 'ArrowLeft') {
    e.preventDefault();
    switchVersion(blockId, -1);
    return;
  }
  if (e.altKey && !e.ctrlKey && !e.metaKey && e.key === 'ArrowRight') {
    e.preventDefault();
    switchVersion(blockId, 1);
    return;
  }

  // ArrowUp at first line → focus block above
  if (e.key === 'ArrowUp' && !e.ctrlKey && !e.metaKey) {
    const pos = ta.selectionStart;
    const textBefore = ta.value.substring(0, pos);
    if (!textBefore.includes('\n')) {
      const idx = blockIndex(blockId);
      if (idx > 0) {
        e.preventDefault();
        focusBlock(state.blocks[idx - 1].id);
      }
    }
  }

  // ArrowDown at last line → focus block below
  if (e.key === 'ArrowDown' && !e.ctrlKey && !e.metaKey) {
    const pos = ta.selectionStart;
    const textAfter = ta.value.substring(pos);
    if (!textAfter.includes('\n')) {
      const idx = blockIndex(blockId);
      if (idx < state.blocks.length - 1) {
        e.preventDefault();
        focusBlock(state.blocks[idx + 1].id, 0);
      }
    }
  }
}

// ── Global Shortcuts ─────────────────────────

document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;

  // Undo
  if (mod && !e.shiftKey && e.key === 'z') {
    e.preventDefault();
    undo();
    return;
  }

  // Redo (Ctrl+Shift+Z or Ctrl+Y)
  if (mod && ((e.shiftKey && (e.key === 'z' || e.key === 'Z')) || e.key === 'y')) {
    e.preventDefault();
    redo();
    return;
  }

  // Save
  if (mod && e.key === 's') {
    e.preventDefault();
    saveFile();
    return;
  }

  // Open
  if (mod && e.key === 'o') {
    e.preventDefault();
    openFile();
    return;
  }

  // Export
  if (mod && e.key === 'e') {
    e.preventDefault();
    exportFile();
    return;
  }

  // New version
  if (mod && e.shiftKey && (e.key === 'N' || e.key === 'n')) {
    e.preventDefault();
    if (state.activeBlockId) addVersion(state.activeBlockId, true);
    return;
  }

  // Delete version
  if (mod && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
    e.preventDefault();
    if (state.activeBlockId) deleteVersion(state.activeBlockId);
    return;
  }

  // Toggle theme
  if (mod && e.shiftKey && (e.key === 'L' || e.key === 'l')) {
    e.preventDefault();
    toggleTheme();
    return;
  }

  // Help
  if (e.key === '?' && !e.target.matches('textarea')) {
    e.preventDefault();
    toggleHelp();
    return;
  }

  // Escape → close overlays
  if (e.key === 'Escape') {
    const snippetsOv = document.getElementById('snippets-overlay');
    if (snippetsOv && snippetsOv.classList.contains('visible')) {
      snippetsOv.classList.remove('visible');
      e.preventDefault();
      return;
    }
    const help = document.getElementById('help-overlay');
    if (help.classList.contains('visible')) {
      help.classList.remove('visible');
      e.preventDefault();
    }
  }
});

// ── Theme ────────────────────────────────────

function toggleTheme() {
  const html = document.documentElement;
  const current = html.getAttribute('data-theme');
  html.setAttribute('data-theme', current === 'dark' ? 'light' : 'dark');
}

// Detect system preference on load
if (!localStorage.getItem('nd-editor-theme')) {
  if (window.matchMedia('(prefers-color-scheme: light)').matches) {
    document.documentElement.setAttribute('data-theme', 'light');
  }
}

// ── Help overlay ─────────────────────────────

function toggleHelp() {
  document.getElementById('help-overlay').classList.toggle('visible');
}

// Close help on background click
document.getElementById('help-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) toggleHelp();
});

// ── Snippets overlay ─────────────────────────

function toggleSnippets() {
  const overlay = document.getElementById('snippets-overlay');
  if (overlay.classList.contains('visible')) {
    overlay.classList.remove('visible');
  } else {
    renderSnippetsOverlay();
    overlay.classList.add('visible');
  }
}

function renderSnippetsOverlay() {
  const list = document.getElementById('snippets-list');
  list.innerHTML = '';

  if (state.snippets.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'snippets-empty';
    empty.textContent = 'No snippets yet. Snippets are created automatically when blocks with multiple versions are joined.';
    list.appendChild(empty);
    return;
  }

  state.snippets.forEach((text, i) => {
    const item = document.createElement('div');
    item.className = 'snippet-item';
    item.dataset.index = i;

    const ta = document.createElement('textarea');
    ta.value = text;
    ta.spellcheck = false;
    ta.rows = 1;
    ta.addEventListener('input', () => {
      state.snippets[i] = ta.value;
      autoResize(ta);
      autosave();
    });

    const actions = document.createElement('div');
    actions.className = 'snippet-actions';

    const btnRemove = document.createElement('button');
    btnRemove.type = 'button';
    btnRemove.className = 'snippet-btn snippet-btn-remove';
    btnRemove.title = 'Remove snippet';
    btnRemove.textContent = '×';
    btnRemove.addEventListener('click', () => {
      state.snippets.splice(i, 1);
      renderSnippetsOverlay();
      autosave();
    });

    actions.appendChild(btnRemove);
    item.appendChild(ta);
    item.appendChild(actions);
    list.appendChild(item);

    // Auto-size after mount
    requestAnimationFrame(() => autoResize(ta));
  });
}

// Close snippets on background click
document.getElementById('snippets-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) toggleSnippets();
});

// Add new snippet button
document.getElementById('snippets-add-btn').addEventListener('click', () => {
  state.snippets.push('');
  renderSnippetsOverlay();
  autosave();
  // Focus the new (last) textarea
  requestAnimationFrame(() => {
    const list = document.getElementById('snippets-list');
    const items = list.querySelectorAll('.snippet-item textarea');
    if (items.length > 0) {
      const last = items[items.length - 1];
      last.focus({ preventScroll: true });
      last.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });
});

// ── Toolbar visibility ──────────────────────

let toolbarTimer = null;
const toolbar = document.getElementById('toolbar');
const modeToggle = document.getElementById('mode-toggle');

function showToolbar() {
  toolbar.classList.add('visible');
  modeToggle.classList.add('visible');
  clearTimeout(toolbarTimer);
  toolbarTimer = setTimeout(() => {
    if (!toolbar.matches(':hover') && !modeToggle.matches(':hover')) {
      toolbar.classList.remove('visible');
      modeToggle.classList.remove('visible');
    }
  }, 2500);
}

document.addEventListener('mousemove', (e) => {
  if (e.clientY < 60) showToolbar();
});

toolbar.addEventListener('mouseenter', () => {
  clearTimeout(toolbarTimer);
  toolbar.classList.add('visible');
  modeToggle.classList.add('visible');
});

toolbar.addEventListener('mouseleave', () => {
  toolbarTimer = setTimeout(() => {
    toolbar.classList.remove('visible');
    modeToggle.classList.remove('visible');
  }, 1200);
});

modeToggle.addEventListener('mouseenter', () => {
  clearTimeout(toolbarTimer);
  toolbar.classList.add('visible');
  modeToggle.classList.add('visible');
});

modeToggle.addEventListener('mouseleave', () => {
  toolbarTimer = setTimeout(() => {
    toolbar.classList.remove('visible');
    modeToggle.classList.remove('visible');
  }, 1200);
});

// ── Toolbar buttons ─────────────────────────

document.getElementById('btn-save').addEventListener('click', saveFile);
document.getElementById('btn-open').addEventListener('click', openFile);
document.getElementById('btn-export').addEventListener('click', exportFile);
document.getElementById('btn-nd-version').addEventListener('click', toggleNdVersion);
document.getElementById('btn-theme').addEventListener('click', toggleTheme);
document.getElementById('btn-help').addEventListener('click', toggleHelp);
document.getElementById('btn-snippets').addEventListener('click', toggleSnippets);
document.getElementById('btn-version').addEventListener('click', () => {
  if (state.activeBlockId) addVersion(state.activeBlockId, true);
});
document.getElementById('file-input').addEventListener('change', (e) => {
  if (e.target.files[0]) handleFileOpen(e.target.files[0]);
  e.target.value = '';
});

// ── View / Edit Mode ─────────────────────────

let currentMode = 'edit';
let viewContainer = null;

function updateNdVersionUi() {
  const btn = document.getElementById('btn-nd-version');
  if (!btn) return;
  btn.textContent = `nd:${state.ndVersion}`;
  btn.title = `Toggle &ND version for preview/export (current: ${state.ndVersion})`;
}

function toggleNdVersion() {
  pushUndo();
  state.ndVersion = state.ndVersion === 'v2' ? 'v1' : 'v2';
  updateNdVersionUi();
  autosave();
  if (currentMode === 'view') renderView();
}

function setMode(mode) {
  if (mode === currentMode) return;
  currentMode = mode;

  document.getElementById('btn-mode-view').classList.toggle('active', mode === 'view');
  document.getElementById('btn-mode-edit').classList.toggle('active', mode === 'edit');

  if (mode === 'view') {
    article.style.display = 'none';
    if (!viewContainer) {
      viewContainer = document.createElement('main');
      viewContainer.className = 'article-view';
      viewContainer.id = 'article-view';
      article.parentNode.insertBefore(viewContainer, article.nextSibling);
    }
    viewContainer.style.display = '';
    renderView();
  } else {
    if (viewContainer) viewContainer.style.display = 'none';
    article.style.display = '';
  }
}

document.getElementById('btn-mode-view').addEventListener('click', () => setMode('view'));
document.getElementById('btn-mode-edit').addEventListener('click', () => setMode('edit'));

// ── &ND Renderer ─────────────────────────────

/**
 * Parse inline &ND markup within a text string and return an HTML string.
 * Handles v1 core inline and v2 promoted inline markers.
 */
function renderAndInline(text, options = {}) {
  const v2 = options.v2 === true;
  let result = '';
  let i = 0;

  while (i < text.length) {
    // Escape sequences
    if (text[i] === '\\' && i + 1 < text.length) {
      const next = text[i + 1];
      if (next === '[' || next === ']' || next === '|' || next === '\\') {
        result += escapeHtml(next);
        i += 2;
        continue;
      }
    }

    if (v2) {
      if (text.startsWith('[.]', i)) {
        result += '<br>';
        i += 3;
        continue;
      }

      const fixedMarkers = {
        '[ ]': { klass: 'nd-marker nd-marker-todo', label: 'unchecked', symbol: '☐' },
        '[x]': { klass: 'nd-marker nd-marker-todo', label: 'checked', symbol: '☑' },
        '[,]': { klass: 'nd-marker nd-marker-todo', label: 'in-progress', symbol: '◔' },
        '[;]': { klass: 'nd-marker nd-marker-todo', label: 'cancelled', symbol: '⨯' },
        '[>]': { klass: 'nd-marker nd-marker-direction', label: 'forward', symbol: '→' },
        '[<]': { klass: 'nd-marker nd-marker-direction', label: 'backward', symbol: '←' },
        '[%]': { klass: 'nd-marker nd-marker-auto-number', label: 'auto-number', symbol: '№' },
      };

      const fixedToken = text.slice(i, i + 3);
      if (fixedMarkers[fixedToken]) {
        const marker = fixedMarkers[fixedToken];
        result += `<span class="${marker.klass}" title="${marker.label}">${marker.symbol}</span>`;
        i += 3;
        continue;
      }

      if (text.startsWith('[:', i)) {
        const close = findClosingBracket(text, i + 2);
        if (close !== -1) {
          const inner = text.substring(i + 2, close);
          const split = inner.search(/\s/);
          const datatype = split > 0 ? inner.slice(0, split) : '';
          const rawValue = split > 0 ? inner.slice(split).trim() : '';
          if (/^[A-Za-z][A-Za-z0-9_-]*$/.test(datatype) && rawValue.length > 0) {
            const value = rawValue.startsWith('"') && rawValue.endsWith('"') && rawValue.length >= 2
              ? rawValue.slice(1, -1)
              : rawValue;
            result += `<span class="nd-typed-value" data-type="${escapeHtml(datatype)}"><span class="nd-typed-value-type">${escapeHtml(datatype)}</span>: <span class="nd-typed-value-value">${escapeHtml(value)}</span></span>`;
            i = close + 1;
            continue;
          }
        }
      }

      if (text[i] === '[' && i + 2 < text.length && text[i + 2] === ' ') {
        const simpleTag = text[i + 1];
        const tagMap = {
          '#': 'nd-tag-anchor',
          '~': 'nd-tag-reference',
          '!': 'nd-tag-admonition',
          '?': 'nd-tag-question',
          '+': 'nd-tag-plus',
          '-': 'nd-tag-strike',
          '"': 'nd-tag-quoted',
          "'": 'nd-tag-comment',
          '=': 'nd-tag-highlight',
          '_': 'nd-tag-underline',
        };
        if (tagMap[simpleTag]) {
          const close = findClosingBracket(text, i + 3);
          if (close !== -1) {
            const content = text.substring(i + 3, close).trim();
            if (content.length > 0) {
              result += `<span class="nd-tag ${tagMap[simpleTag]}">${renderAndInline(content, options)}</span>`;
              i = close + 1;
              continue;
            }
          }
        }
      }
    }

    // Inline tag opener: [X ...]
    if (text[i] === '[' && i + 2 < text.length && text[i + 2] === ' ') {
      const tag = text[i + 1];
      if (tag === '*' || tag === '/' || tag === '$' || tag === '@') {
        const inner = findClosingBracket(text, i + 3);
        if (inner !== -1) {
          const content = text.substring(i + 3, inner);
          if (tag === '*') {
            result += '<strong>' + renderAndInline(content, options) + '</strong>';
          } else if (tag === '/') {
            result += '<em>' + renderAndInline(content, options) + '</em>';
          } else if (tag === '$') {
            result += '<code>' + escapeHtml(content) + '</code>';
          } else if (tag === '@') {
            const pipeIdx = findUnescapedPipe(content);
            if (pipeIdx !== -1) {
              const url = content.substring(0, pipeIdx).trim();
              const label = content.substring(pipeIdx + 1).trim();
              result += '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer">' + renderAndInline(label, options) + '</a>';
            } else {
              result += escapeHtml(text.substring(i, inner + 1));
            }
          }
          i = inner + 1;
          continue;
        }
      }
    }

    result += escapeHtml(text[i]);
    i++;
  }

  return result;
}

function findClosingBracket(text, start) {
  let depth = 1;
  let i = start;
  while (i < text.length) {
    if (text[i] === '\\' && i + 1 < text.length) {
      i += 2;
      continue;
    }
    if (text[i] === '[') depth++;
    if (text[i] === ']') {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

function findUnescapedPipe(text) {
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\' && i + 1 < text.length) { i++; continue; }
    if (text[i] === '|') return i;
  }
  return -1;
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Parse &ND block content and return HTML string.
 * Handles: headings, paragraphs, lists, blockquotes, code blocks, horizontal rules,
 * and v2 paired blocks.
 */
function renderAndBlocks(text, options = {}) {
  const v2 = options.v2 === true;
  const lines = text.split('\n');
  let html = '';
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Blank line — skip
    if (line.trim() === '') { i++; continue; }

    if (v2 && line === '~~~=') {
      const payload = [];
      i += 1;
      while (i < lines.length && lines[i] !== '~~~=') {
        payload.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      html += `<section class="nd-block nd-block-highlight"><p>${renderAndInline(payload.join('\n'), options)}</p></section>`;
      continue;
    }

    if (v2 && (line.startsWith('===') || line.startsWith('***'))) {
      const fence = line.startsWith('===') ? '===' : '***';
      const tag = line.slice(3);
      const className = fence === '===' ? 'nd-block-header-text' : 'nd-block-disclaimer';
      const isHeaderText = fence === '===';
      const isDisclaimer = fence === '***';
      const validTag = tag.length === 0 || /^[A-Za-z][A-Za-z0-9_-]*$/.test(tag);
      if (validTag) {
        const payload = [];
        i += 1;
        const closer = isHeaderText ? '===' : (isDisclaimer ? '***' : line);
        while (i < lines.length && lines[i] !== closer) {
          payload.push(lines[i]);
          i += 1;
        }
        if (i < lines.length) i += 1;
        const tagAttr = tag.length > 0 ? ` data-tag="${escapeHtml(tag)}"` : '';
        html += `<section class="nd-block ${className}"${tagAttr}><p>${renderAndInline(payload.join('\n'), options)}</p></section>`;
        continue;
      }
    }

    // Horizontal rule
    if (line.trim() === '---') {
      html += '<hr>';
      i++;
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,6}) (.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      let headingText = headingMatch[2];
      let autoNumber = false;
      if (v2 && headingText.startsWith('[n]')) {
        autoNumber = true;
        headingText = headingText.slice(3).trimStart();
      }
      const autoMarker = autoNumber ? '<span class="nd-heading-auto-marker" title="auto-number">#</span> ' : '';
      const headingClass = autoNumber ? ' class="nd-heading-auto"' : '';
      html += `<h${level}${headingClass}>${autoMarker}${renderAndInline(headingText, options)}</h${level}>`;
      i++;
      continue;
    }

    // Code block
    const codeMatch = line.match(/^(`{3,})(\w*)$/);
    if (codeMatch) {
      const fence = codeMatch[1];
      const lang = codeMatch[2];
      const codeLines = [];
      i++;
      while (i < lines.length && lines[i] !== fence) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // skip closing fence
      const langAttr = lang ? ` class="language-${escapeHtml(lang)}"` : '';
      html += `<pre><code${langAttr}>${escapeHtml(codeLines.join('\n'))}</code></pre>`;
      continue;
    }

    // Blockquote
    if (line.startsWith('> ') || line === '>') {
      const quoteLines = [];
      while (i < lines.length && (lines[i].startsWith('> ') || lines[i] === '>')) {
        quoteLines.push(lines[i].startsWith('> ') ? lines[i].substring(2) : '');
        i++;
      }
      html += '<blockquote>' + renderAndBlocks(quoteLines.join('\n'), options) + '</blockquote>';
      continue;
    }

    // Unordered list
    if (line.match(/^- .+/)) {
      html += '<ul>';
      while (i < lines.length && lines[i].match(/^- .+/)) {
        const itemLines = [lines[i].substring(2)];
        i++;
        // Continuation lines indented by 2 spaces
        while (i < lines.length && lines[i].startsWith('  ') && !lines[i].match(/^- /)) {
          itemLines.push(lines[i].substring(2));
          i++;
        }
        html += '<li>' + renderAndInline(itemLines.join('\n'), options) + '</li>';
      }
      html += '</ul>';
      continue;
    }

    // Ordered list
    const olMatch = line.match(/^(\d+)\. (.+)/);
    if (olMatch) {
      const startNum = parseInt(olMatch[1], 10);
      html += `<ol start="${startNum}">`;
      while (i < lines.length && lines[i].match(/^\d+\. .+/)) {
        const itemMatch = lines[i].match(/^\d+\. (.+)/);
        const itemLines = [itemMatch[1]];
        i++;
        while (i < lines.length && lines[i].startsWith('  ') && !lines[i].match(/^\d+\. /)) {
          itemLines.push(lines[i].substring(2));
          i++;
        }
        html += '<li>' + renderAndInline(itemLines.join('\n'), options) + '</li>';
      }
      html += '</ol>';
      continue;
    }

    // Paragraph — collect contiguous non-blank, non-block-opener lines
    const paraLines = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].match(/^#{1,6} /) &&
      !lines[i].match(/^`{3,}/) &&
      !(lines[i].startsWith('> ') || lines[i] === '>') &&
      !lines[i].match(/^- /) &&
      !lines[i].match(/^\d+\. /) &&
      lines[i].trim() !== '---'
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      html += '<p>' + renderAndInline(paraLines.join('\n'), options) + '</p>';
    }
  }

  return html;
}

/**
 * Render the full document in view mode by combining active text from all blocks.
 */
function renderView() {
  if (!viewContainer) return;
  const parts = state.blocks.map(b => activeText(b));
  const fullText = parts.join('\n\n');

  const match = fullText.match(/^&ND\s+(v1|v2)\s*\n?/);
  const docVersion = match ? match[1] : state.ndVersion;
  const content = match ? fullText.slice(match[0].length) : fullText;
  viewContainer.innerHTML = renderAndBlocks(content, { v2: docVersion === 'v2' });
}

// ── Init ─────────────────────────────────────

autorestore();
render();
updateNdVersionUi();
focusBlock(state.blocks[0].id, 0);

// ─────────────────────────────────────────────
// &ND Block Editor
// ─────────────────────────────────────────────

// ── Utilities ────────────────────────────────

let _id = 0;
const uid = () => 'b' + (++_id) + '_' + Math.random().toString(36).slice(2, 7);

// ── Data Model ───────────────────────────────

/** @type {{ blocks: Array<{id:string, versions:string[], focusedIndex:number}>, activeBlockId:string|null }} */
const state = {
  blocks: [{ id: uid(), versions: [''], focusedIndex: 0 }],
  activeBlockId: null,
};

function getBlock(id) { return state.blocks.find(b => b.id === id); }
function blockIndex(id) { return state.blocks.findIndex(b => b.id === id); }
function activeText(block) { return block.versions[block.focusedIndex]; }

// ── Block Operations ─────────────────────────

function splitBlock(blockId, lineIndex) {
  const b = getBlock(blockId);
  if (!b) return;
  const idx = blockIndex(blockId);

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
  focusBlock(below.id, 0);
}

function joinBlocks(upperBlockId, lowerBlockId) {
  const a = getBlock(upperBlockId);
  const b = getBlock(lowerBlockId);
  if (!a || !b) return;

  const maxVersions = Math.max(a.versions.length, b.versions.length);
  const merged = [];

  for (let i = 0; i < maxVersions; i++) {
    const aText = i < a.versions.length ? a.versions[i] : activeText(a);
    const bText = i < b.versions.length ? b.versions[i] : activeText(b);
    merged.push(aText + '\n' + bText);
  }

  const focusedIdx = Math.min(a.focusedIndex, merged.length - 1);
  const cursorOffset = activeText(a).length + 1; // position after join point

  const joined = { id: uid(), versions: merged, focusedIndex: focusedIdx };
  const idxA = blockIndex(upperBlockId);
  const idxB = blockIndex(lowerBlockId);
  const removeStart = Math.min(idxA, idxB);
  state.blocks.splice(removeStart, 2, joined);

  render();
  focusBlock(joined.id, cursorOffset);
}

function addVersion(blockId, copy = true) {
  const b = getBlock(blockId);
  if (!b) return;
  const newText = copy ? activeText(b) : '';
  b.versions.splice(b.focusedIndex + 1, 0, newText);
  b.focusedIndex = b.focusedIndex + 1;
  render();
  focusBlock(b.id, 0);
}

function switchVersion(blockId, delta) {
  const b = getBlock(blockId);
  if (!b) return;
  const next = b.focusedIndex + delta;
  if (next < 0 || next >= b.versions.length) return;
  b.focusedIndex = next;
  render();
  focusBlock(b.id);
}

function deleteVersion(blockId) {
  const b = getBlock(blockId);
  if (!b || b.versions.length <= 1) return;
  b.versions.splice(b.focusedIndex, 1);
  b.focusedIndex = Math.min(b.focusedIndex, b.versions.length - 1);
  render();
  focusBlock(b.id);
}

// ── AEON Serialization ───────────────────────

function escStr(s) {
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t') + '"';
}

function serializeAeon() {
  const lines = ['aeon:header = { profile = "aeon.editor.v1" }', ''];
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

  return blocks.length > 0 ? blocks : null;
}

// ── &ND Export ────────────────────────────────

function exportAnd() {
  const parts = state.blocks.map(b => activeText(b));
  return '&ND v1\n\n' + parts.join('\n\n');
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
    const blocks = parseAeon(reader.result);
    if (blocks) {
      state.blocks = blocks;
      state.activeBlockId = null;
      render();
    }
  };
  reader.readAsText(file);
}

// ── Rendering ────────────────────────────────

const article = document.getElementById('article');

const STORAGE_KEY = 'nd-editor-state';

function autosave() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.blocks.map(b => ({
      id: b.id, versions: b.versions, focusedIndex: b.focusedIndex
    }))));
  } catch (_) { /* quota exceeded — silent */ }
}

function autorestore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const blocks = JSON.parse(raw);
    if (Array.isArray(blocks) && blocks.length > 0) {
      state.blocks = blocks;
      return true;
    }
  } catch (_) { /* corrupt — ignore */ }
  return false;
}

function render() {
  article.innerHTML = '';
  state.blocks.forEach((block) => {
    article.appendChild(createBlockElement(block));
  });
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
        block.versions[block.focusedIndex] = ta.value;
        autoResize(ta);
        autosave();
      });

      ta.addEventListener('focus', () => {
        state.activeBlockId = block.id;
        document.querySelectorAll('.block').forEach(b => b.classList.remove('focused'));
        el.classList.add('focused');
      });

      ta.addEventListener('keydown', handleTextareaKeydown);

      pane.appendChild(ta);

      // Schedule auto-resize after mount
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
      render();
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

function autoResize(ta) {
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 'px';
}

function focusBlock(blockId, cursorPos) {
  state.activeBlockId = blockId;
  requestAnimationFrame(() => {
    const ta = article.querySelector(`textarea[data-block-id="${blockId}"]`);
    if (ta) {
      ta.focus();
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

  // Escape → close help
  if (e.key === 'Escape') {
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

// ── Toolbar visibility ──────────────────────

let toolbarTimer = null;
const toolbar = document.getElementById('toolbar');

function showToolbar() {
  toolbar.classList.add('visible');
  clearTimeout(toolbarTimer);
  toolbarTimer = setTimeout(() => {
    // Don't hide if mouse is over toolbar
    if (!toolbar.matches(':hover')) {
      toolbar.classList.remove('visible');
    }
  }, 2500);
}

document.addEventListener('mousemove', (e) => {
  if (e.clientY < 60) showToolbar();
});

toolbar.addEventListener('mouseenter', () => {
  clearTimeout(toolbarTimer);
  toolbar.classList.add('visible');
});

toolbar.addEventListener('mouseleave', () => {
  toolbarTimer = setTimeout(() => toolbar.classList.remove('visible'), 1200);
});

// ── Toolbar buttons ─────────────────────────

document.getElementById('btn-save').addEventListener('click', saveFile);
document.getElementById('btn-open').addEventListener('click', openFile);
document.getElementById('btn-export').addEventListener('click', exportFile);
document.getElementById('btn-theme').addEventListener('click', toggleTheme);
document.getElementById('btn-help').addEventListener('click', toggleHelp);
document.getElementById('btn-version').addEventListener('click', () => {
  if (state.activeBlockId) addVersion(state.activeBlockId, true);
});
document.getElementById('file-input').addEventListener('change', (e) => {
  if (e.target.files[0]) handleFileOpen(e.target.files[0]);
  e.target.value = '';
});

// ── Init ─────────────────────────────────────

autorestore();
render();
focusBlock(state.blocks[0].id, 0);

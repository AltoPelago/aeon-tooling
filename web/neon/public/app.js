const tabButtons = document.querySelectorAll('.tab-button');
const tabPanels = document.querySelectorAll('.tab-panel');

const createBtn = document.getElementById('createBtn');
const createResetBtn = document.getElementById('createResetBtn');
const openBtn = document.getElementById('openBtn');
const openResetBtn = document.getElementById('openResetBtn');
const downloadBtn = document.getElementById('downloadBtn');

const createStatusEl = document.getElementById('createStatus');
const openStatusEl = document.getElementById('openStatus');

const createRatesEl = document.getElementById('createRates');
const openRatesEl = document.getElementById('openRates');

const createEncodingModesEl = document.getElementById('createEncodingModes');
const openEncodingModesEl = document.getElementById('openEncodingModes');

const createManifestBody = document.getElementById('createManifestBody');
const openManifestBody = document.getElementById('openManifestBody');

const createPrimaryPreview = document.getElementById('createPrimaryPreview');
const openPrimaryPreview = document.getElementById('openPrimaryPreview');

const overrideBody = document.getElementById('attachmentOverridesBody');

const aeonInput = document.getElementById('aeonFile');
const attachmentsInput = document.getElementById('attachments');
const attachmentFolderInput = document.getElementById('attachmentFolder');
const neonFileInput = document.getElementById('neonFile');

const presetProfile = document.getElementById('presetProfile');
const embedBase64 = document.getElementById('embedBase64');
const compressionIntent = document.getElementById('compressionIntent');
const attachmentDefaultMode = document.getElementById('attachmentDefaultMode');

const hexViewerContainer = document.getElementById('hexViewerContainer');
const hexSectionInfo = document.getElementById('hexSectionInfo');
const hexBytesPerRow = document.getElementById('hexBytesPerRow');
const bitSchemeLabel = document.getElementById('bitSchemeLabel');

let lastNeonBytes = null;
let lastInspectorEncoding = 'unknown';
let lastManifest = null;
const expandedInspectorEntries = new Set();

const treeScopes = {
  create: {
    viewEl: document.getElementById('createTreeView'),
    showTextEl: document.getElementById('createTreeShowText'),
    showBinaryEl: document.getElementById('createTreeShowBinary'),
    showFoldersEl: document.getElementById('createTreeShowFolders'),
    expandAllEl: document.getElementById('createTreeExpandAll'),
    collapseAllEl: document.getElementById('createTreeCollapseAll'),
    entries: [],
    expandedFolders: new Set()
  },
  open: {
    viewEl: document.getElementById('openTreeView'),
    showTextEl: document.getElementById('openTreeShowText'),
    showBinaryEl: document.getElementById('openTreeShowBinary'),
    showFoldersEl: document.getElementById('openTreeShowFolders'),
    expandAllEl: document.getElementById('openTreeExpandAll'),
    collapseAllEl: document.getElementById('openTreeCollapseAll'),
    entries: [],
    expandedFolders: new Set()
  }
};

let lastNeonBase64 = null;
let lastSuggestedFileName = 'output.neon';
let selectedAeonFile = null;
let selectedAttachments = [];

initialize();

function initialize() {
  bindTabStrip();
  bindDropzone('dropAeon', onAeonDrop);
  bindDropzone('dropAttachments', onAttachmentsDrop);

  aeonInput.addEventListener('change', () => {
    selectedAeonFile = aeonInput.files && aeonInput.files[0] ? aeonInput.files[0] : null;
    if (selectedAeonFile) {
      setCreateStatus(`AEON selected: ${selectedAeonFile.name}`);
    }
  });

  attachmentsInput.addEventListener('change', () => {
    addAttachments(Array.from(attachmentsInput.files || []), false);
  });

  attachmentFolderInput.addEventListener('change', () => {
    addAttachments(Array.from(attachmentFolderInput.files || []), true);
  });

  presetProfile.addEventListener('change', () => {
    applyProfile(presetProfile.value);
  });
  compressionIntent.addEventListener('change', () => {
    applyCompressionIntent(compressionIntent.value);
  });
  attachmentDefaultMode.addEventListener('change', () => {
    embedBase64.checked = attachmentDefaultMode.value === 'base64';
  });
  document.getElementById('compressionScope').addEventListener('change', syncCompressionIntentFromAdvanced);

  bindTreeScope('create');
  bindTreeScope('open');

  createBtn.addEventListener('click', onCreate);
  createResetBtn.addEventListener('click', resetCreateWorkspace);
  openBtn.addEventListener('click', onOpen);
  openResetBtn.addEventListener('click', resetOpenWorkspace);
  downloadBtn.addEventListener('click', onDownload);

  hexBytesPerRow.addEventListener('change', () => {
    if (lastNeonBytes) {
      renderHexViewer(lastNeonBytes);
    }
  });

  applyProfile('balanced');
  refreshAttachmentOverridesTable();
}

function bindTabStrip() {
  tabButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const tabName = button.getAttribute('data-tab');
      setActiveTab(tabName);
    });
  });
}

function setActiveTab(tabName) {
  tabButtons.forEach((button) => {
    if (button.getAttribute('data-tab') === tabName) {
      button.classList.add('active');
    } else {
      button.classList.remove('active');
    }
  });

  tabPanels.forEach((panel) => {
    if (panel.getAttribute('data-tab') === tabName) {
      panel.classList.add('active');
    } else {
      panel.classList.remove('active');
    }
  });
}

function bindTreeScope(scopeName) {
  const scope = treeScopes[scopeName];
  scope.showTextEl.addEventListener('change', () => renderTreeFromState(scopeName));
  scope.showBinaryEl.addEventListener('change', () => renderTreeFromState(scopeName));
  scope.showFoldersEl.addEventListener('change', () => renderTreeFromState(scopeName));
  scope.expandAllEl.addEventListener('click', () => expandAllTreeFolders(scopeName));
  scope.collapseAllEl.addEventListener('click', () => collapseAllTreeFolders(scopeName));
}

async function onCreate() {
  try {
    const aeonFile = selectedAeonFile || (aeonInput.files && aeonInput.files[0]);
    if (!aeonFile) {
      throw new Error('Select an AEON file first.');
    }

    const formData = new FormData();
    formData.append('aeonFile', aeonFile, aeonFile.name);

    for (const item of selectedAttachments) {
      formData.append('attachments', item.file, item.path);
    }

    const compressionSettings = readCompressionSettings();
    const options = {
      aeonPath: document.getElementById('aeonPath').value.trim(),
      attachmentPaths: selectedAttachments.map((item) => item.path),
      emptyFolders: parseFolderLines(document.getElementById('emptyFolders').value),
      aeonSourceTransform: document.getElementById('aeonSourceTransform').value,
      trailingNewline: document.getElementById('trailingNewline').checked,
      checksum: document.getElementById('checksum').checked,
      magic: document.getElementById('magic').value,
      neonEncoding: document.getElementById('neonEncoding').value,
      ...compressionSettings,
      attachmentEncodingByPath: readAttachmentEncodingMap(),
      embedAttachmentsAsBase64: attachmentDefaultMode.value === 'base64'
    };

    formData.append('options', JSON.stringify(options));

    setCreateStatus('Creating Neon container...');
    const response = await fetch('/api/create-neon', {
      method: 'POST',
      body: formData
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Failed to create Neon file');
    }

    lastNeonBase64 = payload.neonBase64;
    lastNeonBytes = base64ToBytes(payload.neonBase64);
    lastInspectorEncoding = payload.settings?.selectedNeonEncoding || payload.settings?.neonEncoding || 'unknown';
    lastManifest = payload.manifest;
    expandedInspectorEntries.clear();
    renderHexViewer(lastNeonBytes);
    lastSuggestedFileName = payload.suggestedFileName || 'output.neon';
    downloadBtn.disabled = false;

    renderManifest(payload.manifest.entries, payload.manifest.primaryEntryId, createManifestBody);
    setTreeEntries('create', payload.manifest.entries);
    renderRates([
      {
        label: 'AEON Compaction',
        value: formatPercent(1 - payload.rates.aeonCompactionRatio),
        detail: `${formatBytes(payload.rates.aeonOriginalBytes)} -> ${formatBytes(payload.rates.aeonCompactedBytes)}`
      },
      {
        label: 'Container Size',
        value: formatPercent(1 - payload.rates.neonVsInputRatio),
        detail: `${formatBytes(payload.rates.inputBytes)} -> ${formatBytes(payload.rates.neonBytes)}`
      },
      {
        label: 'Text Encoding',
        value: payload.settings?.selectedNeonEncoding || payload.settings?.neonEncoding || 'utf-8',
        detail: `requested=${payload.settings?.neonEncoding || 'utf-8'}`
      },
      {
        label: 'Compression',
        value: payload.settings?.compressionScope || 'none',
        detail: `method=${payload.settings?.compressionMethod || 'none'}, container=${payload.settings?.selectedContainerCompression || payload.settings?.containerCompression || 'none'}`
      }
    ], createRatesEl);

    renderEncodingModes(payload.encodingModes, createEncodingModesEl);

    createPrimaryPreview.value = 'Open the generated file to inspect decoded primary text.';
    setCreateStatus('Neon file created successfully.');
  } catch (error) {
    setCreateStatus(error instanceof Error ? error.message : 'Unexpected error', true);
  }
}

async function onOpen() {
  try {
    const neonFile = neonFileInput.files && neonFileInput.files[0];
    if (!neonFile) {
      throw new Error('Select a Neon file first.');
    }

    // Read file as bytes for hex viewer
    const fileBytes = new Uint8Array(await neonFile.arrayBuffer());
    lastNeonBytes = fileBytes;
    lastManifest = null;
    expandedInspectorEntries.clear();
    renderHexViewer(lastNeonBytes);

    const formData = new FormData();
    formData.append('neonFile', neonFile);

    setOpenStatus('Opening Neon file...');
    const response = await fetch('/api/open-neon', {
      method: 'POST',
      body: formData
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Failed to open Neon file');
    }

    lastInspectorEncoding = payload.header?.encoding || 'unknown';
    lastManifest = payload.manifest;
    expandedInspectorEntries.clear();
    renderHexViewer(lastNeonBytes);

    renderManifest(payload.manifest.entries, payload.manifest.primaryEntryId, openManifestBody);
    setTreeEntries('open', payload.manifest.entries);
    renderRates([
      {
        label: 'Neon vs Original Entries',
        value: formatPercent(1 - payload.rates.neonVsOriginalRatio),
        detail: `${formatBytes(payload.rates.totalOriginalBytes)} -> ${formatBytes(payload.rates.neonBytes)}`
      },
      {
        label: 'Container Payload Compression',
        value: payload.header.compression,
        detail: `magic=${payload.header.magic}, checksum=${payload.header.checksum}`
      },
      {
        label: 'Text Encoding',
        value: payload.header.encoding,
        detail: `mode=${payload.header.mode}`
      }
    ], openRatesEl);

    renderEncodingModes(payload.encodingModes, openEncodingModesEl, payload.textRoundTrip);

    openPrimaryPreview.value = payload.primaryText || '(Primary entry is not text.)';
    setOpenStatus('Neon file opened successfully.');
  } catch (error) {
    setOpenStatus(error instanceof Error ? error.message : 'Unexpected error', true);
  }
}

function onDownload() {
  if (!lastNeonBase64) {
    return;
  }
  const bytes = base64ToBytes(lastNeonBase64);
  const blob = new Blob([bytes], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = lastSuggestedFileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function resetCreateWorkspace() {
  selectedAeonFile = null;
  selectedAttachments = [];
  lastNeonBase64 = null;
  lastSuggestedFileName = 'output.neon';
  downloadBtn.disabled = true;

  aeonInput.value = '';
  attachmentsInput.value = '';
  attachmentFolderInput.value = '';

  document.getElementById('aeonPath').value = 'docs/document.aeon';
  document.getElementById('emptyFolders').value = '';
  attachmentDefaultMode.value = 'embed';
  embedBase64.checked = false;

  presetProfile.value = 'balanced';
  applyProfile('balanced');
  refreshAttachmentOverridesTable();

  createManifestBody.innerHTML = '';
  createRatesEl.innerHTML = '';
  createEncodingModesEl.innerHTML = '';
  createPrimaryPreview.value = '';
  lastNeonBytes = null;
  lastInspectorEncoding = 'unknown';
  lastManifest = null;
  expandedInspectorEntries.clear();
  hexViewerContainer.innerHTML = '';
  renderInspectorInfoDefault();
  clearTreeScope('create');
  setCreateStatus('Create workspace reset.');
}

function resetOpenWorkspace() {
  neonFileInput.value = '';

  openManifestBody.innerHTML = '';
  openRatesEl.innerHTML = '';
  openEncodingModesEl.innerHTML = '';
  openPrimaryPreview.value = '';
  hexViewerContainer.innerHTML = '';
  renderInspectorInfoDefault();
  lastNeonBytes = null;
  lastInspectorEncoding = 'unknown';
  lastManifest = null;
  expandedInspectorEntries.clear();
  clearTreeScope('open');
  setOpenStatus('Open workspace reset.');
}

function bindDropzone(id, onDropFiles) {
  const zone = document.getElementById(id);
  zone.addEventListener('dragover', (event) => {
    event.preventDefault();
    zone.classList.add('dragover');
  });
  zone.addEventListener('dragleave', () => {
    zone.classList.remove('dragover');
  });
  zone.addEventListener('drop', (event) => {
    event.preventDefault();
    zone.classList.remove('dragover');
    const files = Array.from(event.dataTransfer?.files || []);
    if (files.length > 0) {
      onDropFiles(files);
    }
  });
}

function onAeonDrop(files) {
  selectedAeonFile = files[0] || null;
  if (selectedAeonFile) {
    setCreateStatus(`AEON selected from drop: ${selectedAeonFile.name}`);
  }
}

function onAttachmentsDrop(files) {
  addAttachments(files, false);
  setCreateStatus(`${files.length} attachment(s) added from drop.`);
}

function addAttachments(files, allowWebkitPath) {
  const indexByPath = new Map(selectedAttachments.map((item, i) => [item.path, i]));

  for (const file of files) {
    const path = normalizeRelativeName(allowWebkitPath && file.webkitRelativePath ? file.webkitRelativePath : file.name);
    const entry = { file, path, encodingMode: '' };
    if (indexByPath.has(path)) {
      selectedAttachments[indexByPath.get(path)] = entry;
    } else {
      selectedAttachments.push(entry);
      indexByPath.set(path, selectedAttachments.length - 1);
    }
  }

  selectedAttachments.sort((a, b) => a.path.localeCompare(b.path));
  refreshAttachmentOverridesTable();
}

function refreshAttachmentOverridesTable() {
  const previousEncoding = readAttachmentEncodingMap();
  overrideBody.innerHTML = '';

  if (selectedAttachments.length === 0) {
    const row = document.createElement('tr');
    row.innerHTML = '<td colspan="3">No attachments selected.</td>';
    overrideBody.appendChild(row);
    return;
  }

  for (const item of selectedAttachments) {
    const row = document.createElement('tr');
    const typeGuess = guessTextKind(item.file, item.path) ? 'text' : 'binary';
    const chosenEncoding = previousEncoding[item.path] ?? item.encodingMode ?? '';

    row.innerHTML = `
      <td>${escapeHtml(item.path)}</td>
      <td>${escapeHtml(typeGuess)}</td>
      <td>
        <select>
          <option value="">(default)</option>
          <option value="base64">:base64 (text)</option>
          <option value="inline">:inline (binary→base64)</option>
          <option value="embed">:embed (binary)</option>
        </select>
      </td>
    `;
    overrideBody.appendChild(row);

    const encodingSelect = row.querySelector('select');
    encodingSelect.setAttribute('data-attachment-path', item.path);
    encodingSelect.setAttribute('data-type', 'encoding');
    encodingSelect.value = chosenEncoding;

    // Update item.encodingMode when select changes
    encodingSelect.addEventListener('change', () => {
      const idx = selectedAttachments.findIndex((a) => a.path === item.path);
      if (idx >= 0) {
        selectedAttachments[idx].encodingMode = encodingSelect.value;
      }
    });
  }
}

function readAttachmentEncodingMap() {
  const map = {};
  for (const select of overrideBody.querySelectorAll('select[data-type="encoding"][data-attachment-path]')) {
    const value = select.value;
    const path = select.getAttribute('data-attachment-path');
    if (path && value) {
      map[path] = value;
    }
  }
  return map;
}

function applyProfile(name) {
  const config = name === 'compact'
    ? {
        aeonSourceTransform: 'compact',
        trailingNewline: false,
        checksum: true,
        magic: 'present',
        neonEncoding: 'race',
        compressionIntent: 'container',
        compressionScope: 'container',
        compressionMethod: 'race'
      }
    : name === 'fast'
      ? {
          aeonSourceTransform: 'preserve',
          trailingNewline: false,
          checksum: false,
          magic: 'present',
          neonEncoding: 'race',
          compressionIntent: 'none',
          compressionScope: 'none',
          compressionMethod: 'none'
        }
      : name === 'debug'
        ? {
            aeonSourceTransform: 'preserve',
            trailingNewline: true,
            checksum: false,
            magic: 'present',
            neonEncoding: 'utf-8',
            compressionIntent: 'none',
            compressionScope: 'none',
            compressionMethod: 'none'
          }
      : {
          aeonSourceTransform: 'compact',
          trailingNewline: false,
          checksum: true,
          magic: 'present',
          neonEncoding: 'race',
          compressionIntent: 'none',
          compressionScope: 'none',
          compressionMethod: 'none'
        };

  document.getElementById('aeonSourceTransform').value = config.aeonSourceTransform;
  document.getElementById('trailingNewline').checked = config.trailingNewline;
  document.getElementById('checksum').checked = config.checksum;
  document.getElementById('magic').value = config.magic;
  document.getElementById('neonEncoding').value = config.neonEncoding;
  compressionIntent.value = config.compressionIntent;
  document.getElementById('compressionScope').value = config.compressionScope;
  document.getElementById('compressionMethod').value = config.compressionMethod;
  syncCompressionIntentFromAdvanced();
  setCreateStatus(`Optimize for: ${presetProfile.options[presetProfile.selectedIndex]?.text || name}`);
}

function applyCompressionIntent(intent) {
  const scopeEl = document.getElementById('compressionScope');
  const methodEl = document.getElementById('compressionMethod');
  if (intent === 'none') {
    scopeEl.value = 'none';
    methodEl.value = 'none';
  } else if (intent === 'container') {
    scopeEl.value = 'container';
    methodEl.value = 'race';
  } else {
    scopeEl.value = 'text';
    methodEl.value = 'race';
  }
}

function syncCompressionIntentFromAdvanced() {
  const scope = document.getElementById('compressionScope').value;
  compressionIntent.value = scope === 'container' ? 'container' : scope === 'text' ? 'text' : 'none';
}

function parseFolderLines(input) {
  return input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function setCreateStatus(message, isError = false) {
  createStatusEl.textContent = message;
  createStatusEl.style.color = isError ? '#ff8f6b' : '#44d8a8';
}

function setOpenStatus(message, isError = false) {
  openStatusEl.textContent = message;
  openStatusEl.style.color = isError ? '#ff8f6b' : '#44d8a8';
}

function renderManifest(entries, primaryEntryId, bodyEl) {
  bodyEl.innerHTML = '';
  for (const entry of entries) {
    const row = document.createElement('tr');
    if (entry.id === primaryEntryId) {
      row.style.background = 'rgba(255,184,74,0.14)';
    }

    row.innerHTML = `
      <td>${entry.id}${entry.id === primaryEntryId ? ' (primary)' : ''}</td>
      <td>${entry.kind}</td>
      <td>${escapeHtml(entry.name || '(unnamed)')}</td>
      <td>${escapeHtml(entry.encoding || 'raw')}/${entry.compression}</td>
      <td>${formatBytes(entry.storedLength)}</td>
      <td>${formatBytes(entry.originalLength)}</td>
    `;
    bodyEl.appendChild(row);
  }
}

function setTreeEntries(scopeName, entries) {
  const scope = treeScopes[scopeName];
  scope.entries = Array.isArray(entries) ? entries : [];
  renderTreeFromState(scopeName);
}

function clearTreeScope(scopeName) {
  const scope = treeScopes[scopeName];
  scope.entries = [];
  scope.expandedFolders.clear();
  scope.viewEl.innerHTML = '';
}

function expandAllTreeFolders(scopeName) {
  const scope = treeScopes[scopeName];
  const paths = collectFolderPaths(scope.entries, {
    showText: scope.showTextEl.checked,
    showBinary: scope.showBinaryEl.checked,
    showFolders: scope.showFoldersEl.checked
  });
  for (const path of paths) {
    scope.expandedFolders.add(path);
  }
  renderTreeFromState(scopeName);
}

function collapseAllTreeFolders(scopeName) {
  const scope = treeScopes[scopeName];
  scope.expandedFolders.clear();
  renderTreeFromState(scopeName);
}

function renderTreeFromState(scopeName) {
  const scope = treeScopes[scopeName];
  const entries = scope.entries;
  const root = { folders: new Map(), files: [] };
  const showText = scope.showTextEl.checked;
  const showBinary = scope.showBinaryEl.checked;
  const showFolders = scope.showFoldersEl.checked;

  for (const entry of entries) {
    if (entry.kind === 'text' && !showText) {
      continue;
    }
    if (entry.kind === 'binary' && !showBinary) {
      continue;
    }
    if (entry.kind === 'folder' && !showFolders) {
      continue;
    }

    const display = entry.name && entry.name.length > 0 ? entry.name : `(unnamed-${entry.id})`;
    const parts = display.replace(/\/+$/, '').split('/').filter((part) => part.length > 0);
    if (parts.length === 0) {
      root.files.push({ label: display, kind: entry.kind });
      continue;
    }

    let node = root;
    const lastIndex = parts.length - (entry.kind === 'folder' ? 0 : 1);
    for (let i = 0; i < lastIndex; i += 1) {
      const part = parts[i];
      if (!node.folders.has(part)) {
        node.folders.set(part, { folders: new Map(), files: [] });
      }
      node = node.folders.get(part);
    }

    if (entry.kind !== 'folder') {
      node.files.push({
        label: parts[parts.length - 1],
        kind: entry.kind
      });
    }
  }

  scope.viewEl.innerHTML = '';
  scope.viewEl.appendChild(renderTreeNode(scope, root, ''));
}

function renderTreeNode(scope, node, prefix) {
  const ul = document.createElement('ul');

  const folderNames = Array.from(node.folders.keys()).sort((a, b) => a.localeCompare(b));
  for (const name of folderNames) {
    const fullPath = prefix ? `${prefix}/${name}` : name;
    const li = document.createElement('li');
    const details = document.createElement('details');
    details.open = scope.expandedFolders.has(fullPath);
    details.addEventListener('toggle', () => {
      if (details.open) {
        scope.expandedFolders.add(fullPath);
      } else {
        scope.expandedFolders.delete(fullPath);
      }
    });

    const summary = document.createElement('summary');
    summary.innerHTML = `<span class="icon">[dir]</span><span class="folder">${escapeHtml(name)}/</span>`;
    details.appendChild(summary);
    details.appendChild(renderTreeNode(scope, node.folders.get(name), fullPath));
    li.appendChild(details);
    ul.appendChild(li);
  }

  const files = [...node.files].sort((a, b) => a.label.localeCompare(b.label));
  for (const file of files) {
    const li = document.createElement('li');
    const icon = file.kind === 'text' ? '[txt]' : file.kind === 'binary' ? '[bin]' : '[dir]';
    li.innerHTML = `<span class="icon">${icon}</span><span class="file">${escapeHtml(file.label)}</span> <small>(${escapeHtml(file.kind)})</small>`;
    ul.appendChild(li);
  }

  return ul;
}

function collectFolderPaths(entries, filters) {
  const paths = new Set();
  for (const entry of entries) {
    if (entry.kind === 'text' && !filters.showText) {
      continue;
    }
    if (entry.kind === 'binary' && !filters.showBinary) {
      continue;
    }
    if (entry.kind === 'folder' && !filters.showFolders) {
      continue;
    }

    const display = entry.name && entry.name.length > 0 ? entry.name : '';
    const parts = display.replace(/\/+$/, '').split('/').filter((part) => part.length > 0);
    if (parts.length === 0) {
      continue;
    }

    const limit = entry.kind === 'folder' ? parts.length : parts.length - 1;
    for (let i = 0; i < limit; i += 1) {
      paths.add(parts.slice(0, i + 1).join('/'));
    }
  }
  return paths;
}

function renderRates(cards, targetEl) {
  targetEl.innerHTML = '';
  for (const card of cards) {
    const el = document.createElement('article');
    el.className = 'rate-card';
    el.innerHTML = `
      <h3>${escapeHtml(card.label)}</h3>
      <p>${escapeHtml(card.value)}</p>
      <small>${escapeHtml(card.detail)}</small>
    `;
    targetEl.appendChild(el);
  }
}

function renderEncodingModes(modes, targetEl, roundTripStatus) {
  targetEl.innerHTML = '';
  if (modes && Array.isArray(modes) && modes.length > 0) {
    for (const mode of modes) {
      const badge = document.createElement('span');
      badge.className = 'encoding-mode-badge';
      badge.textContent = `:${mode}`;
      targetEl.appendChild(badge);
    }
  } else if (roundTripStatus === undefined) {
    const empty = document.createElement('span');
    empty.style.color = 'var(--muted)';
    empty.textContent = '(no special encoding)';
    targetEl.appendChild(empty);
  }
  
  if (roundTripStatus !== undefined) {
    const status = document.createElement('span');
    status.className = `round-trip-status ${roundTripStatus === 'lossless-text' ? 'lossless' : 'lossy'}`;
    status.textContent = roundTripStatus === 'lossless-text' ? '✓ Lossless text' : '⚠ Binary-only (lossy)';
    targetEl.appendChild(status);
  }
}

function guessTextKind(file, path) {
  const mime = (file.type || '').toLowerCase();
  if (mime.startsWith('text/') || mime.includes('json') || mime.includes('xml') || mime.includes('yaml')) {
    return true;
  }
  return /\.(aeon|txt|md|json|yaml|yml|xml|csv|html|css|js|mjs|cjs|ts|tsx|jsx)$/i.test(path);
}

function normalizeRelativeName(name) {
  return String(name || '')
    .replaceAll('\\', '/')
    .replace(/^\/+/, '')
    .trim();
}

function formatPercent(value) {
  if (!Number.isFinite(value)) {
    return 'n/a';
  }
  return `${(value * 100).toFixed(2)}%`;
}

function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) {
    return '0 B';
  }
  if (n < 1024) {
    return `${n} B`;
  }
  if (n < 1024 * 1024) {
    return `${(n / 1024).toFixed(2)} KB`;
  }
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function readCompressionSettings() {
  const scope = document.getElementById('compressionScope').value;
  const method = document.getElementById('compressionMethod').value;
  return {
    compressionScope: scope,
    compressionMethod: method,
    containerCompression: scope === 'container' && method !== 'none' ? method : 'none',
    aeonEntryCompression: scope === 'text' && method !== 'none' ? method : 'none',
    attachmentCompression: scope === 'text' && method !== 'none' ? method : 'none'
  };
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderInspectorInfoDefault() {
  hexSectionInfo.innerHTML = '<p style="color: var(--muted);">Hover over decoder blocks to inspect Neon header fields, directory layout, payload spans, and trailer bytes.</p>';
}

function getBitSchemeForEncoding(encoding) {
  const normalized = String(encoding || '').trim().toLowerCase();
  if (normalized.includes('2p6b-aeon')) {
    return { key: '2p6b-aeon', label: '2p6b-aeon (prefix switches + 6-bit symbols)', decoder: decode2p6bBitStream, charMaps: get2p6bAeonMaps() };
  }
  if (normalized.includes('2p6b')) {
    return { key: '2p6b', label: '2p6b (prefix switches + 6-bit symbols)', decoder: decode2p6bBitStream, charMaps: get2p6bGpMaps() };
  }
  if (normalized.includes('3p6b')) {
    return { key: '3p6b', label: '3p6b (3-page 6-bit)', decoder: decode3p6bBitStream, charMaps: get3p6bMaps() };
  }
  // Default UTF-8 or unknown
  return { key: 'utf8', label: `UTF-8 byte stream (${encoding || 'unknown'})`, decoder: decodeUtf8BitStream };
}

function get2p6bGpMaps() {
  return {
    0: { 1: 'a', 2: 'b', 3: 'c', 4: 'd', 5: 'e', 6: 'f', 7: 'g', 8: 'h', 9: 'i', 10: 'j', 11: 'k', 12: 'l', 13: 'm', 14: 'n', 15: 'o', 16: 'p', 17: 'q', 18: 'r', 19: 's', 20: 't', 21: 'u', 22: 'v', 23: 'w', 24: 'x', 25: 'y', 26: 'z', 27: '`', 28: '"', 29: '_', 30: '\\n', 31: '\\t', 32: '(space)', 33: '.', 34: ',', 35: '!', 36: '?', 37: '=', 38: ':', 39: '{', 40: '}', 41: '(', 42: ')', 43: '[', 44: ']', 45: '<', 46: '>', 47: '(utf)' },
    1: { 0: '(bin)', 1: '0', 2: '1', 3: '2', 4: '3', 5: '4', 6: '5', 7: '6', 8: '7', 9: '8', 10: '9', 11: '+', 12: '-', 13: '*', 14: '/', 15: '\\', 16: '|', 17: '^', 18: '&', 19: '%', 20: '~', 21: '@', 22: '#', 23: '$', 25: "'", 26: ';', 27: '`', 28: '"', 29: '_', 30: '\\n', 31: '\\t', 32: '(space)', 33: '.', 34: ',', 35: '!', 36: '?', 37: '=', 38: ':', 39: '{', 40: '}', 41: '(', 42: ')', 43: '[', 44: ']', 45: '<', 46: '>', 47: '(utf)' }
  };
}

function get2p6bAeonMaps() {
  return {
    0: { 1: 'a', 2: 'b', 3: 'c', 4: 'd', 5: 'e', 6: 'f', 7: 'g', 8: 'h', 9: 'i', 10: 'j', 11: 'k', 12: 'l', 13: 'm', 14: 'n', 15: 'o', 16: 'p', 17: 'q', 18: 'r', 19: 's', 20: 't', 21: 'u', 22: 'v', 23: 'w', 24: 'x', 25: 'y', 26: 'z', 27: '@', 28: '.', 29: ',', 30: '\\n', 31: '_', 32: '(space)', 33: '=', 34: '=+latch', 35: '=+shift', 36: '"', 37: '`', 38: ':', 39: '{', 40: '}', 41: '(', 42: ')', 43: '[', 44: ']', 45: '<', 46: '>', 47: '(utf)' },
    1: { 0: '(bin)', 1: '1', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '0', 11: '+', 12: '-', 13: '*', 14: '/', 15: '\\', 16: '|', 17: '^', 18: '&', 19: '%', 20: '~', 21: "'", 22: '#', 23: '$', 24: '?', 25: ';', 26: '!', 27: '\\t', 28: '.', 29: ',', 30: '\\n', 31: '_', 32: '(space)', 33: '=', 34: '=+latch', 35: '=+shift', 36: '"', 37: '`', 38: ':', 39: '{', 40: '}', 41: '(', 42: ')', 43: '[', 44: ']', 45: '<', 46: '>', 47: '(utf)' }
  };
}

function get3p6bMaps() {
  return {
    0: { 1: 'a', 2: 'b', 3: 'c', 4: 'd', 5: 'e', 6: 'f', 7: 'g', 8: 'h', 9: 'i', 10: 'j', 11: 'k', 12: 'l', 13: 'm', 14: 'n', 15: 'o', 16: 'p', 17: 'q', 18: 'r', 19: 's', 20: 't', 21: 'u', 22: 'v', 23: 'w', 24: 'x', 25: 'y', 26: 'z', 27: '.', 28: ',', 29: '!', 30: '?', 31: '=', 32: ':', 33: '`', 34: "'", 35: '"', 36: '_', 37: '(space)', 38: '(utf)', 39: '\\n', 40: '(', 41: ')', 42: '[', 43: ']', 44: '{', 45: '}', 46: '<', 47: '>' },
    1: { 1: 'A', 2: 'B', 3: 'C', 4: 'D', 5: 'E', 6: 'F', 7: 'G', 8: 'H', 9: 'I', 10: 'J', 11: 'K', 12: 'L', 13: 'M', 14: 'N', 15: 'O', 16: 'P', 17: 'Q', 18: 'R', 19: 'S', 20: 'T', 21: 'U', 22: 'V', 23: 'W', 24: 'X', 25: 'Y', 26: 'Z', 27: '.', 28: ',', 29: '!', 30: '?', 31: '=', 32: ':', 33: '`', 34: "'", 35: '"', 36: '_', 37: '(space)', 38: '(utf)', 39: '\\n', 40: '(', 41: ')', 42: '[', 43: ']', 44: '{', 45: '}', 46: '<', 47: '>' },
    2: { 0: '(bin)', 1: '-', 2: '+', 3: '/', 4: '\\', 5: '~', 6: '#', 7: '$', 8: '\\t', 10: '@', 11: '%', 12: '^', 13: '&', 14: '*', 15: '|', 16: '0', 17: '1', 18: '2', 19: '3', 20: '4', 21: '5', 22: '6', 23: '7', 24: '8', 25: '9', 26: ';', 27: '.', 28: ',', 29: '!', 30: '?', 31: '=', 32: ':', 33: '`', 34: "'", 35: '"', 36: '_', 37: '(space)', 38: '(utf)', 39: '\\n', 40: '(', 41: ')', 42: '[', 43: ']', 44: '{', 45: '}', 46: '<', 47: '>' }
  };
}

function decodeCharFromBits(bits, role, page, charMaps) {
  const symbolRoles = new Set(['char', 'smart-latch', 'smart-shift', 'utf-marker', 'binary-marker', 'reserved']);
  if (!charMaps || !symbolRoles.has(role)) return null;
  const code = parseInt(bits, 2);
  const pageMap = charMaps[page];
  return pageMap && pageMap[code] ? pageMap[code] : null;
}

function readBit(bytes, bitOffset) {
  const byteIndex = Math.floor(bitOffset / 8);
  const bitInByte = 7 - (bitOffset % 8);
  if (byteIndex >= bytes.length) return null;
  return (bytes[byteIndex] >> bitInByte) & 1;
}

function readBits(bytes, bitOffset, count) {
  let value = 0;
  for (let i = 0; i < count; i++) {
    const bit = readBit(bytes, bitOffset + i);
    if (bit === null) return null;
    value = (value << 1) | bit;
  }
  return value;
}

function readBitRange(bytes, bitOffset, bitLength) {
  let value = '';
  for (let i = 0; i < bitLength; i += 1) {
    const absoluteBit = bitOffset + i;
    const byteIndex = Math.floor(absoluteBit / 8);
    const bitInByte = 7 - (absoluteBit % 8);
    if (byteIndex >= bytes.length) break;
    const bit = (bytes[byteIndex] >> bitInByte) & 1;
    value += bit === 1 ? '1' : '0';
  }
  return value;
}

function* decode2p6bBitStream(bytes, scheme = { key: '2p6b', charMaps: get2p6bGpMaps() }) {
  let bitOffset = 0;
  const totalBits = bytes.length * 8;
  let page = 0; // 0=page0, 1=page1

  const isAeon = scheme.key === '2p6b-aeon';

  function readSymbolRole(code, symbolPage, allowBinary = true) {
    if (code === 47) {
      return 'utf-marker';
    }
    if (symbolPage === 1 && code === 0) {
      return allowBinary ? 'binary-marker' : 'reserved';
    }
    if (isAeon && (code === 34 || code === 35)) {
      return code === 34 ? 'smart-latch' : 'smart-shift';
    }
    return 'char';
  }

  function* readSixBitSymbol(symbolPage, allowBinary = true) {
    if (bitOffset + 6 > totalBits) {
      const remaining = totalBits - bitOffset;
      if (remaining > 0) {
        yield { bitOffset, bitLength: remaining, role: 'partial', page: symbolPage };
        bitOffset += remaining;
      }
      return;
    }

    const code = readBits(bytes, bitOffset, 6);
    const role = readSymbolRole(code, symbolPage, allowBinary);
    yield { bitOffset, bitLength: 6, role, page: symbolPage };
    bitOffset += 6;

    if (isAeon && code === 34) {
      page = 1 - page;
    } else if (isAeon && code === 35) {
      yield* readSixBitSymbol(1 - symbolPage, false);
    }
  }

  while (bitOffset < totalBits) {
    if (page === 0) {
      if (bitOffset + 4 <= totalBits && readBits(bytes, bitOffset, 4) === 0b1110) {
        yield { bitOffset, bitLength: 4, role: 'latch', page };
        bitOffset += 4;
        page = 1;
        continue;
      }
      if (bitOffset + 3 <= totalBits && readBits(bytes, bitOffset, 3) === 0b110) {
        yield { bitOffset, bitLength: 3, role: 'shift', page };
        bitOffset += 3;
        yield* readSixBitSymbol(1, false);
        continue;
      }
      if (bitOffset + 4 <= totalBits && readBits(bytes, bitOffset, 4) === 0b1111) {
        yield { bitOffset, bitLength: 4, role: 'case-shift', page };
        bitOffset += 4;
        yield* readSixBitSymbol(0, false);
        continue;
      }
      yield* readSixBitSymbol(0);
      continue;
    }

    if (bitOffset + 3 <= totalBits && readBits(bytes, bitOffset, 3) === 0b111) {
      yield { bitOffset, bitLength: 3, role: 'latch', page };
      bitOffset += 3;
      page = 0;
      continue;
    }
    if (bitOffset + 3 <= totalBits && readBits(bytes, bitOffset, 3) === 0b110) {
      yield { bitOffset, bitLength: 3, role: 'shift', page };
      bitOffset += 3;
      yield* readSixBitSymbol(0, false);
      continue;
    }
    yield* readSixBitSymbol(1);
  }
}

function* decode3p6bBitStream(bytes) {
  let bitOffset = 0;
  const totalBits = bytes.length * 8;
  let page = 0;
  
  while (bitOffset < totalBits) {
    if (bitOffset + 6 > totalBits) {
      const remaining = totalBits - bitOffset;
      yield { bitOffset, bitLength: remaining, role: 'partial', page };
      break;
    }
    
    const code = readBits(bytes, bitOffset, 6);
    if (code === null) break;
    
    // 3p6b: codes 0-5 shift to pages, 6+ are characters
    if (code < 6) {
      yield { bitOffset, bitLength: 6, role: 'shift', page };
      page = code;
      bitOffset += 6;
      // Next code on new page
      if (bitOffset + 6 <= totalBits) {
        const shifted = readBits(bytes, bitOffset, 6);
        if (shifted !== null) {
          yield { bitOffset, bitLength: 6, role: 'char', page };
          bitOffset += 6;
        }
      }
    } else {
      yield { bitOffset, bitLength: 6, role: 'char', page };
      bitOffset += 6;
    }
  }
}

function* decodeUtf8BitStream(bytes) {
  let bitOffset = 0;
  const totalBits = bytes.length * 8;
  
  while (bitOffset < totalBits) {
    // UTF-8: read until byte boundary
    const bitInByte = bitOffset % 8;
    if (bitInByte === 0 && bitOffset + 8 <= totalBits) {
      const byte = readBits(bytes, bitOffset, 8);
      if (byte === null) break;
      
      // Determine UTF-8 char length from first byte
      let charBytes = 1;
      if ((byte & 0x80) === 0) charBytes = 1;
      else if ((byte & 0xe0) === 0xc0) charBytes = 2;
      else if ((byte & 0xf0) === 0xe0) charBytes = 3;
      else if ((byte & 0xf8) === 0xf0) charBytes = 4;
      
      const bitLength = Math.min(charBytes * 8, totalBits - bitOffset);
      yield { bitOffset, bitLength, role: 'char', page: 0 };
      bitOffset += bitLength;
    } else {
      // Partial byte
      const remaining = totalBits - bitOffset;
      yield { bitOffset, bitLength: remaining, role: 'partial', page: 0 };
      break;
    }
  }
}


function parseNeonFlags(bytes, headerStart = 0) {
  void headerStart;
  const header = inferNeonHeader(bytes);
  const flagsByteOffset = header.flagsByteOffset;
  const isExtended = header.isExtended;

  if (flagsByteOffset >= bytes.length) return null;

  const flagsByte = bytes[flagsByteOffset];
  const version = (flagsByte >> 5) & 0b111;
  const encodingId = (flagsByte >> 3) & 0b11;
  const padBits = flagsByte & 0b111;

  const encodingMap = {
    0: '2p6b-gp (general purpose)',
    1: '3p6b',
    2: 'utf-8',
    3: '2p6b-aeon'
  };

  let extensionFlags = null;
  if (isExtended && flagsByteOffset + 1 < bytes.length) {
    const extByte = bytes[flagsByteOffset + 1];
    extensionFlags = {
      hasCrc32: (extByte & 0x80) !== 0,
      hasCompression: (extByte & 0x40) !== 0,
      hasDirectory: (extByte & 0x20) !== 0,
      hasCustomMap: (extByte & 0x10) !== 0,
      hasPresetDict: (extByte & 0x08) !== 0,
      reserved: (extByte >> 1) & 0b11,
      chain: (extByte & 0x01) !== 0
    };
  }

  return {
    version,
    encoding: encodingMap[encodingId] || `unknown (${encodingId})`,
    padBits,
    isExtended,
    extensionFlags,
    flagsByteOffset
  };
}

function formatFlagsInfo(flagsInfo) {
  if (!flagsInfo) return 'Unable to parse flags';

  let html = `
    <strong>Flags Byte</strong>
    <div style="margin-top: 6px; font-family: monospace; font-size: 12px;">
      Version: ${flagsInfo.version}<br/>
      Encoding: ${flagsInfo.encoding}<br/>
      Pad bits: ${flagsInfo.padBits}<br/>
      Mode: ${flagsInfo.isExtended ? 'Extended' : 'Simple'}
    </div>
  `;

  if (flagsInfo.extensionFlags) {
    html += `
      <div style="margin-top: 8px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 6px;">
        <strong>Extension Byte</strong>
        <div style="margin-top: 6px; font-family: monospace; font-size: 12px;">
          CRC-32: ${flagsInfo.extensionFlags.hasCrc32 ? '✓' : '—'}<br/>
          Compression: ${flagsInfo.extensionFlags.hasCompression ? '✓' : '—'}<br/>
          Directory: ${flagsInfo.extensionFlags.hasDirectory ? '✓' : '—'}<br/>
          Custom Map: ${flagsInfo.extensionFlags.hasCustomMap ? '✓' : '—'}<br/>
          Preset Dict: ${flagsInfo.extensionFlags.hasPresetDict ? '✓' : '—'}<br/>
          Chain: ${flagsInfo.extensionFlags.chain ? '✓' : '—'}
        </div>
      </div>
    `;
  }

  return html;
}


function getBlockSizeClass(bitLength) {
  if (bitLength === 3) {
    return 'size-3';
  }
  if (bitLength === 4) {
    return 'size-4';
  }
  if (bitLength === 5) {
    return 'size-5';
  }
  if (bitLength === 6) {
    return 'size-6';
  }
  if (bitLength === 7) {
    return 'size-7';
  }
  if (bitLength === 8) {
    return 'size-8';
  }
  return 'size-other';
}

function buildBitBlocks(bytes, sections, scheme) {
  const blocks = [];
  const totalBits = bytes.length * 8;
  const sorted = [...sections].sort((a, b) => {
    const aBit = a.startBit ?? (a.start * 8);
    const bBit = b.startBit ?? (b.start * 8);
    return aBit - bBit;
  });

  for (const section of sorted) {
    if (section.collapsible && !expandedInspectorEntries.has(section.groupKey)) {
      const startBit = section.startBit ?? (section.start * 8);
      const endBit = section.endBit ?? (section.end * 8 + 7);
      const bitLength = Math.min(endBit - startBit + 1, totalBits - startBit);
      if (bitLength > 0) {
        blocks.push({
          bitOffset: startBit,
          bitLength,
          bits: '',
          label: `${section.entryKind || 'entry'} ${formatBytes(Math.ceil(bitLength / 8))}`,
          role: section.role || 'entry-payload',
          page: null,
          section
        });
      }
      continue;
    }

    if (Array.isArray(section.bitFields) && section.bitFields.length > 0) {
      for (const field of section.bitFields) {
        const bitLength = Math.min(field.bitLength, totalBits - field.bitOffset);
        if (bitLength <= 0) {
          continue;
        }
        blocks.push({
          bitOffset: field.bitOffset,
          bitLength,
          bits: readBitRange(bytes, field.bitOffset, bitLength),
          role: field.role || section.role || 'field',
          page: null,
          section: {
            ...section,
            name: field.name || section.name,
            detail: field.detail || section.detail
          }
        });
      }
      continue;
    }

    const startBit = section.startBit ?? (section.start * 8);
    const endBit = section.endBit ?? (section.end * 8 + 7);

    const sectionScheme = section.entryEncoding ? getBitSchemeForEncoding(section.entryEncoding) : scheme;
    if ((section.role === 'payload-byte' || section.role === 'entry-text-payload') && sectionScheme && typeof sectionScheme.decoder === 'function') {
      const payloadBytes = bytes.slice(section.start, section.end + 1);
      const payloadBitLength = Math.max(0, endBit - startBit + 1);
      for (const token of sectionScheme.decoder(payloadBytes, sectionScheme)) {
        if (token.bitOffset >= payloadBitLength) {
          break;
        }
        const bitLength = Math.min(token.bitLength, payloadBitLength - token.bitOffset);
        if (bitLength <= 0) {
          continue;
        }
        blocks.push({
          bitOffset: startBit + token.bitOffset,
          bitLength,
          bits: readBitRange(bytes, startBit + token.bitOffset, bitLength),
          role: token.role || section.role || 'payload',
          page: token.page ?? null,
          section
        });
      }
      continue;
    }

    for (let bitOffset = startBit; bitOffset <= endBit && bitOffset < totalBits; bitOffset += 8) {
      const bitLength = Math.min(8, endBit - bitOffset + 1, totalBits - bitOffset);
      blocks.push({
        bitOffset,
        bitLength,
        bits: readBitRange(bytes, bitOffset, bitLength),
        role: section.role || 'byte',
        page: null,
        section
      });
    }
  }

  return blocks;
}

function splitBlocksIntoRows(blocks, bitsPerRow) {
  const rows = [];
  let current = [];
  let usedBits = 0;
  let rowStartBit = blocks.length > 0 ? blocks[0].bitOffset : 0;

  for (const block of blocks) {
    if (usedBits > 0 && usedBits + block.bitLength > bitsPerRow) {
      rows.push({
        startBit: rowStartBit,
        totalBits: usedBits,
        blocks: current
      });
      current = [];
      usedBits = 0;
      rowStartBit = block.bitOffset;
    }

    current.push(block);
    usedBits += block.bitLength;
  }

  if (current.length > 0) {
    rows.push({
      startBit: rowStartBit,
      totalBits: usedBits,
      blocks: current
    });
  }

  return rows;
}

function renderHexViewer(bytes) {
  if (!bytes || bytes.length === 0) {
    hexViewerContainer.innerHTML = '<p style="color: var(--muted);">No Neon bytes loaded yet.</p>';
    if (bitSchemeLabel) {
      bitSchemeLabel.textContent = 'Scheme: byte blocks (8b)';
    }
    renderInspectorInfoDefault();
    return;
  }

  const bitsPerRow = Math.max(24, parseInt(hexBytesPerRow.value, 10) || 96);
  const sections = identifyNeonSections(bytes);
  const scheme = getBitSchemeForEncoding(lastInspectorEncoding);
  const schemeLabel = lastManifest?.byteLayout ? 'Neon decoder fields (directory container)' : scheme.label;
  const blocks = buildBitBlocks(bytes, sections, scheme);
  const rows = splitBlocksIntoRows(blocks, bitsPerRow);

  if (bitSchemeLabel) {
    bitSchemeLabel.textContent = `Scheme: ${schemeLabel}`;
  }

  const html = [];

  for (const row of rows) {
    const blockParts = [];
    for (const block of row.blocks) {
      const sectionName = block.section?.name || 'Unknown';
      const sectionClass = block.section?.type || 'unknown';
      const sectionDetail = block.section?.detail || '';
      const entryName = block.section?.entryName || '';
      const entryKind = block.section?.entryKind || '';
      const groupKey = block.section?.groupKey || '';
      const isCollapsible = Boolean(block.section?.collapsible);
      const isExpanded = groupKey ? expandedInspectorEntries.has(groupKey) : false;
      const startBit = block.bitOffset;
      const endBit = block.bitOffset + block.bitLength - 1;
      const blockLabel = block.label || block.bits;
      const stateClass = isCollapsible ? (isExpanded ? 'expanded' : 'collapsed') : '';

      blockParts.push(
        `<span class="bit-block section-${sectionClass} ${getBlockSizeClass(block.bitLength)} ${stateClass}" data-start-bit="${startBit}" data-end-bit="${endBit}" data-size="${block.bitLength}" data-role="${escapeHtml(block.role)}" data-page="${block.page === null || block.page === undefined ? '' : block.page}" data-section="${escapeHtml(sectionName)}" data-section-type="${escapeHtml(sectionClass)}" data-detail="${escapeHtml(sectionDetail)}" data-entry-name="${escapeHtml(entryName)}" data-entry-kind="${escapeHtml(entryKind)}" data-group-key="${escapeHtml(groupKey)}" data-collapsible="${isCollapsible ? 'true' : 'false'}" title="${escapeHtml(sectionName)} | ${block.bitLength} bits | ${escapeHtml(block.role)}">` +
          `${isCollapsible ? `<span class="bit-toggle">${isExpanded ? '[-]' : '[+]'}</span>` : ''}<span class="bit-value">${escapeHtml(blockLabel)}</span><span class="bit-size">${block.bitLength}b</span>` +
        `</span>`
      );
    }

    const startByte = Math.floor(row.startBit / 8);
    const bitInByte = row.startBit % 8;
    const offsetStr = `${startByte.toString(16).padStart(8, '0').toUpperCase()}:${bitInByte}`;

    html.push(`
      <div class="hex-row">
        <div class="hex-offset">${offsetStr}</div>
        <div class="hex-bytes">${blockParts.join('')}</div>
        <div class="bit-row-summary">${row.totalBits} bits</div>
      </div>
    `);
  }

  hexViewerContainer.innerHTML = html.join('');

  for (const el of hexViewerContainer.querySelectorAll('.bit-block')) {
    // Store block metadata on element for hover access
    const blockText = el.textContent.match(/([01]+)/)?.[1] || '';
    const blockRole = el.getAttribute('data-role') || '';
    const blockPage = parseInt(el.getAttribute('data-page') || '0', 10);
    el.__blockData = { bits: blockText, role: blockRole, page: blockPage };

    el.addEventListener('click', (e) => {
      const groupKey = e.currentTarget.getAttribute('data-group-key') || '';
      if (!groupKey || e.currentTarget.getAttribute('data-collapsible') !== 'true') {
        return;
      }
      if (expandedInspectorEntries.has(groupKey)) {
        expandedInspectorEntries.delete(groupKey);
      } else {
        expandedInspectorEntries.add(groupKey);
      }
      renderHexViewer(bytes);
    });

    el.addEventListener('mouseenter', (e) => {
      const section = e.currentTarget.getAttribute('data-section');
      const sectionType = e.currentTarget.getAttribute('data-section-type') || '';
      const detail = e.currentTarget.getAttribute('data-detail') || '';
      const startBit = Number(e.currentTarget.getAttribute('data-start-bit') || 0);
      const endBit = Number(e.currentTarget.getAttribute('data-end-bit') || 0);
      const bitSize = e.currentTarget.getAttribute('data-size');
      const role = e.currentTarget.getAttribute('data-role');
      const entryName = e.currentTarget.getAttribute('data-entry-name') || '';
      const entryKind = e.currentTarget.getAttribute('data-entry-kind') || '';
      const startByte = Math.floor(startBit / 8);
      const endByte = Math.floor(endBit / 8);

      let infoHtml = `
        <div>
          <strong>${escapeHtml(section || 'Unknown')}</strong>
          <div>Block: ${escapeHtml(role || 'block')} (${escapeHtml(bitSize || '?')} bits)</div>
          <div>Bit range: ${startBit}..${endBit}</div>
          <div>Byte span: ${startByte}..${endByte}</div>
          <div>Scheme: ${escapeHtml(schemeLabel)}</div>
          ${detail ? `<div style="margin-top:6px">${escapeHtml(detail)}</div>` : ''}
      `;

      // Show header flags breakdown
      if (sectionType === 'header' || sectionType === 'extension' || (section && section.includes('Header'))) {
        const flagsInfo = parseNeonFlags(bytes, 0);
        if (flagsInfo) {
          infoHtml += `<div style="margin-top: 12px; border-top: 1px solid rgba(255,255,255,0.2); padding-top: 8px;">${formatFlagsInfo(flagsInfo)}</div>`;
        }
      }

      // Show decoded character for encoded blocks
      const blockBits = e.currentTarget.__blockData?.bits || '';
      const blockRole = e.currentTarget.__blockData?.role || '';
      const blockPage = e.currentTarget.__blockData?.page || 0;
      if (blockRole === 'char' && blockBits && scheme.charMaps) {
        const char = decodeCharFromBits(blockBits, blockRole, blockPage, scheme.charMaps);
        if (char) {
          infoHtml += `<div style="margin-top: 8px; border-top: 1px solid rgba(255,255,255,0.2); padding-top: 6px;"><strong>Symbol:</strong> <span style="font-family: monospace; font-size: 13px;">${escapeHtml(char)}</span></div>`;
        }
      }

      // Show file attribution for content blocks
      const entryLine = entryName
        ? `<div style="margin-top:6px">File: <strong>${escapeHtml(entryName)}</strong></div><div>Kind: ${escapeHtml(entryKind)}</div>`
        : '';

      infoHtml += entryLine + '</div>';
      hexSectionInfo.innerHTML = infoHtml;
    });
    el.addEventListener('mouseleave', () => {
      renderInspectorInfoDefault();
    });
  }
}

function identifyNeonSections(bytes) {
  const manifest = lastManifest;
  const sections = [];
  const header = inferNeonHeader(bytes, manifest);
  const flagsInfo = parseNeonFlags(bytes);
  let offset = 0;

  if (header.hasMagic) {
    sections.push({
      type: 'magic',
      name: header.magicMode === 'extended' ? 'Magic (extended)' : 'Magic (simple)',
      start: 0,
      end: 2,
      role: 'magic-byte',
      detail: 'Neon v1 magic: D7 FF 9B for simple mode, D7 FF BB for extended mode.'
    });
    offset = 3;
  }

  if (offset < bytes.length) {
    sections.push({
      type: 'header',
      name: 'Flags: version',
      start: offset,
      end: offset,
      bitFields: [
        { bitOffset: offset * 8, bitLength: 3, role: 'version', name: 'Flags: version', detail: 'Bits 7-5: Neon container version.' },
        { bitOffset: offset * 8 + 3, bitLength: 2, role: 'encoding', name: 'Flags: encoding', detail: 'Bits 4-3: payload encoding id.' },
        { bitOffset: offset * 8 + 5, bitLength: 3, role: 'pad-bits', name: 'Flags: pad bits', detail: 'Bits 2-0: unused payload pad bits.' }
      ]
    });
    offset += 1;
  }

  if (header.isExtended && offset < bytes.length) {
    const extByte = bytes[offset];
    sections.push({
      type: 'extension',
      name: 'Extension flags',
      start: offset,
      end: offset,
      bitFields: [
        { bitOffset: offset * 8, bitLength: 1, role: 'crc-flag', name: 'Extension: CRC-32', detail: (extByte & 0x80) ? 'CRC-32 trailer follows the stored payload.' : 'No CRC-32 trailer.' },
        { bitOffset: offset * 8 + 1, bitLength: 1, role: 'compression-flag', name: 'Extension: compression', detail: (extByte & 0x40) ? 'A compression method byte follows this extension byte.' : 'Stored payload is not container-compressed.' },
        { bitOffset: offset * 8 + 2, bitLength: 1, role: 'directory-flag', name: 'Extension: directory', detail: (extByte & 0x20) ? 'Payload is a Neon directory container body.' : 'Payload is a single payload.' },
        { bitOffset: offset * 8 + 3, bitLength: 1, role: 'custom-map-flag', name: 'Extension: custom map', detail: (extByte & 0x10) ? 'Inline character map metadata follows.' : 'Standard character map.' },
        { bitOffset: offset * 8 + 4, bitLength: 1, role: 'dictionary-flag', name: 'Extension: preset dictionary', detail: (extByte & 0x08) ? 'A preset dictionary id follows compression metadata.' : 'No preset dictionary id.' },
        { bitOffset: offset * 8 + 5, bitLength: 2, role: 'reserved', name: 'Extension: reserved', detail: 'Reserved bits; valid v1 headers keep these as 0.' },
        { bitOffset: offset * 8 + 7, bitLength: 1, role: 'chain-flag', name: 'Extension: chain', detail: (extByte & 0x01) ? 'Another extension byte follows.' : 'This is the final extension byte.' }
      ]
    });
    offset += 1;

    if ((extByte & 0x40) && offset < bytes.length && offset < header.payloadByteStart) {
      sections.push({
        type: 'extension',
        name: 'Compression method',
        start: offset,
        end: offset,
        role: 'compression-method',
        detail: `${bytes[offset] === 0 ? 'Deflate' : bytes[offset] === 1 ? 'Brotli' : 'Unknown'} method byte for the stored payload.`
      });
      offset += 1;
    }

    if (offset < header.payloadByteStart) {
      sections.push({
        type: 'extension',
        name: 'Extension metadata',
        start: offset,
        end: header.payloadByteStart - 1,
        role: 'extension-byte',
        detail: 'Additional extension bytes such as dictionary id or custom map data.'
      });
      offset = header.payloadByteStart;
    }
  }

  if (!manifest?.byteLayout) {
    const trailerByteLength = flagsInfo?.extensionFlags?.hasCrc32 ? 4 : 0;
    const payloadEnd = bytes.length - trailerByteLength - 1;
    if (offset <= payloadEnd) {
      if (flagsInfo?.extensionFlags?.hasCompression) {
        sections.push({
          type: 'payload',
          name: 'Compressed stored payload',
          start: offset,
          end: payloadEnd,
          role: 'compressed-byte',
          detail: 'Decoder decompresses these stored bytes before reading the text bitstream.'
        });
      } else {
        const endBit = Math.max(offset * 8 - 1, payloadEnd * 8 + 7 - (flagsInfo?.padBits || 0));
        sections.push({
          type: 'payload',
          name: 'Text payload bitstream',
          start: offset,
          end: payloadEnd,
          endBit,
          role: 'payload-byte',
          detail: 'Decoder reads this payload using the selected Neon text encoding.'
        });
      }
    }
    if (trailerByteLength > 0 && bytes.length >= trailerByteLength) {
      const trailerStart = bytes.length - trailerByteLength;
      sections.push({ type: 'trailer', name: 'CRC-32 checksum', start: trailerStart, end: bytes.length - 1, role: 'crc-byte', detail: 'Big-endian CRC-32 of the stored payload bytes.' });
    }
    return sections;
  }

  const { payloadByteStart, payloadByteEnd, directoryDecodedBytes, totalDecodedBytes, trailerByteLength } = manifest.byteLayout;
  const compressionEnabled = Boolean(flagsInfo?.extensionFlags?.hasCompression);

  // Payload region
  const rawPayloadLen = payloadByteEnd - payloadByteStart + 1;
  if (payloadByteStart <= payloadByteEnd && rawPayloadLen > 0) {
    if (compressionEnabled) {
      sections.push({
        type: 'payload',
        name: 'Compressed stored payload',
        start: payloadByteStart,
        end: payloadByteEnd,
        role: 'compressed-byte',
        detail: `Decoder decompresses these ${rawPayloadLen} stored bytes before reading the ${formatBytes(totalDecodedBytes)} directory body.`
      });
    } else if (totalDecodedBytes === 0) {
      sections.push({ type: 'directory', name: 'Directory body', start: payloadByteStart, end: payloadByteEnd, role: 'directory-byte' });
    } else {
      const parsedDirectoryPrefix = readUvarintAt(bytes, payloadByteStart, payloadByteEnd + 1);
      const directoryLengthBytes = parsedDirectoryPrefix ? parsedDirectoryPrefix.nextOffset - payloadByteStart : 0;
      if (parsedDirectoryPrefix) {
        sections.push(makeUvarintSection(
          'directory',
          'Directory byte length',
          payloadByteStart,
          parsedDirectoryPrefix.nextOffset - 1,
          'Length prefix for the directory index.',
          bytes
        ));
      }

      const directoryStart = payloadByteStart + directoryLengthBytes;
      const directoryEnd = Math.min(directoryStart + directoryDecodedBytes - 1, payloadByteEnd);
      if (directoryStart <= directoryEnd) {
        sections.push(...identifyDirectoryIndexFields(bytes, directoryStart, directoryEnd, manifest));
      }

      const entryPayloadStart = directoryEnd + 1;
      const contentEntries = (manifest.entries || [])
        .filter((e) => e.storedLength > 0)
        .sort((a, b) => a.decodedOffset - b.decodedOffset);

      for (const entry of contentEntries) {
        const entryRawStart = entryPayloadStart + entry.decodedOffset;
        const entryRawEnd = Math.min(entryRawStart + entry.storedLength - 1, payloadByteEnd);
        if (entryRawStart <= entryRawEnd) {
          const isPackedTextEntry = entry.kind === 'text' && entry.compression === 'none' && entry.encoding && entry.encoding !== 'raw';
          const entryDecodedBits = Number.isFinite(entry.decodedBitLength) ? entry.decodedBitLength : entry.storedLength * 8;
          sections.push({
            type: `content-${entry.kind}`,
            name: entry.name || `Entry ${entry.id}`,
            entryName: entry.name || `Entry ${entry.id}`,
            entryKind: entry.kind,
            entryEncoding: entry.encoding,
            groupKey: `entry:${entry.id}:${entryRawStart}:${entryRawEnd}`,
            collapsible: true,
            start: entryRawStart,
            end: entryRawEnd,
            endBit: isPackedTextEntry ? entryRawStart * 8 + entryDecodedBits - 1 : undefined,
            role: isPackedTextEntry ? 'entry-text-payload' : 'entry-payload-byte',
            detail: `Stored entry data: ${formatBytes(entry.storedLength)} at payload-region offset ${entry.decodedOffset}.${entry.encoding ? ` Encoding: ${entry.encoding}.` : ''}`
          });
        }
      }
    }
  }

  // CRC-32 trailer
  if (trailerByteLength > 0 && bytes.length >= trailerByteLength) {
    const trailerStart = bytes.length - trailerByteLength;
    sections.push({ type: 'trailer', name: 'CRC-32 checksum', start: trailerStart, end: bytes.length - 1, role: 'crc-byte', detail: 'Big-endian CRC-32 of the stored payload bytes.' });
  }

  return sections;
}

function inferNeonHeader(bytes, manifest = lastManifest) {
  const hasMagic = bytes.length >= 3
    && bytes[0] === 0xd7 && bytes[1] === 0xff
    && (bytes[2] === 0x9b || bytes[2] === 0xbb);
  const flagsByteOffset = hasMagic ? 3 : 0;
  const isExtended = hasMagic ? bytes[2] === 0xbb : Boolean(bytes[flagsByteOffset + 1] & 0xe0);
  let payloadByteStart = manifest?.byteLayout?.payloadByteStart;
  if (payloadByteStart === undefined) {
    payloadByteStart = flagsByteOffset + 1;
    if (isExtended) {
      const extByte = bytes[payloadByteStart] ?? 0;
      payloadByteStart += 1;
      if (extByte & 0x40) {
        payloadByteStart += 1;
      }
      if (extByte & 0x08) {
        payloadByteStart += 1;
      }
    }
  }
  return {
    hasMagic,
    magicMode: hasMagic && bytes[2] === 0xbb ? 'extended' : 'simple',
    flagsByteOffset,
    isExtended,
    payloadByteStart
  };
}

function readUvarintAt(bytes, offset, limit = bytes.length) {
  let currentOffset = offset;
  let value = 0;
  let shift = 0;
  while (currentOffset < limit && currentOffset < bytes.length) {
    const byte = bytes[currentOffset];
    value |= (byte & 0x7f) << shift;
    currentOffset += 1;
    if ((byte & 0x80) === 0) {
      return { value, nextOffset: currentOffset };
    }
    shift += 7;
    if (shift > 28) {
      return null;
    }
  }
  return null;
}

function makeUvarintSection(type, name, start, end, detail, bytes) {
  const bitFields = [];
  for (let byteOffset = start; byteOffset <= end; byteOffset += 1) {
    bitFields.push({
      bitOffset: byteOffset * 8,
      bitLength: 1,
      role: 'uvarint-continuation',
      name: `${name}: continuation`,
      detail: `${detail} Continuation bit for byte ${byteOffset - start + 1}.`
    });
    bitFields.push({
      bitOffset: byteOffset * 8 + 1,
      bitLength: 7,
      role: 'uvarint-value',
      name: `${name}: value bits`,
      detail: `${detail} Seven little-endian base-128 value bits from byte ${byteOffset - start + 1}.`
    });
  }
  const parsed = readUvarintAt(bytes, start, end + 1);
  return {
    type,
    name,
    start,
    end,
    bitFields,
    detail: parsed ? `${detail} Decoded value: ${parsed.value}.` : detail
  };
}

function identifyDirectoryIndexFields(bytes, start, end, manifest) {
  const sections = [];
  let cursor = start;
  const limit = end + 1;

  const pushByte = (name, detail, type = 'directory') => {
    if (cursor >= limit) return;
    sections.push({ type, name, start: cursor, end: cursor, role: 'directory-field', detail });
    cursor += 1;
  };

  const pushUvarint = (name, detail) => {
    const parsed = readUvarintAt(bytes, cursor, limit);
    if (!parsed) return null;
    sections.push(makeUvarintSection('directory', name, cursor, parsed.nextOffset - 1, detail, bytes));
    cursor = parsed.nextOffset;
    return parsed.value;
  };

  const pushUtf8 = (name, length, detail) => {
    if (length <= 0) return;
    const fieldEnd = Math.min(cursor + length - 1, end);
    sections.push({ type: 'directory', name, start: cursor, end: fieldEnd, role: 'utf8-bytes', detail });
    cursor = fieldEnd + 1;
  };

  pushByte('Directory index version', '0x01 for the current Neon v1 directory index.');
  const entryCount = pushUvarint('Directory entry count', 'Number of entries in the index.');
  pushUvarint('Primary entry id', 'Entry id to treat as the primary AEON/text payload.');

  const expectedEntries = [...(manifest.entries || [])].sort((a, b) => a.id - b.id);
  const loopCount = Number.isInteger(entryCount) ? Math.min(entryCount, expectedEntries.length || entryCount) : expectedEntries.length;

  for (let index = 0; index < loopCount && cursor < limit; index += 1) {
    const entry = expectedEntries[index] || {};
    const label = entry.name ? `Entry ${entry.id} (${entry.name})` : `Entry ${entry.id ?? index + 1}`;
    pushUvarint(`${label}: id`, 'Directory entry id.');
    pushByte(
      `${label}: flags`,
      'Bits 7-6 kind (0=file, 1=folder), bits 5-3 encoding (0=raw, 1=utf-8, 2=2p6b-gp, 3=2p6b-aeon, 4=3p6b), bits 2-1 compression (0=none, 1=deflate, 2=brotli), bit 0 metadata.'
    );
    const nameLength = pushUvarint(`${label}: name length`, 'UTF-8 byte length of the stored entry name.');
    pushUtf8(`${label}: name`, nameLength || 0, 'Entry name bytes.');
    if (entry.kind === 'text' || entry.kind === 'binary') {
      pushUvarint(`${label}: data offset`, 'Byte offset into the directory payload region.');
      pushUvarint(`${label}: stored length`, 'Stored byte length for this entry payload.');
      pushUvarint(`${label}: decoded bit length`, 'Decoded payload bit length after per-entry decompression.');
    }
    const metadataCount = entry.metadata && entry.metadata.length > 0
      ? pushUvarint(`${label}: metadata count`, 'Number of metadata key/value pairs.')
      : 0;
    const metadataLoopCount = Number.isInteger(metadataCount) ? metadataCount : 0;
    for (let metadataIndex = 0; metadataIndex < metadataLoopCount && cursor < limit; metadataIndex += 1) {
      const keyLength = pushUvarint(`${label}: metadata key length`, 'UTF-8 byte length of the metadata key.');
      pushUtf8(`${label}: metadata key`, keyLength || 0, 'Metadata key bytes.');
      const valueLength = pushUvarint(`${label}: metadata value length`, 'UTF-8 byte length of the metadata value.');
      pushUtf8(`${label}: metadata value`, valueLength || 0, 'Metadata value bytes.');
    }
  }

  if (cursor <= end) {
    sections.push({ type: 'directory', name: 'Directory index bytes', start: cursor, end, role: 'directory-byte', detail: 'Remaining directory index bytes.' });
  }

  return sections;
}

function findSectionAtOffset(sections, offset) {
  for (const section of sections) {
    if (offset >= section.start && offset <= section.end) {
      return section;
    }
  }
  return null;
}

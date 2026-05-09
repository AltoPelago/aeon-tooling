import express from 'express';
import multer from 'multer';
import { compile } from '../../../../aeon/implementations/typescript/packages/core/src/index.ts';
import { minimize } from '../../../../aeon-tonics/packages/export/minizer/src/index.ts';
import { prettifyAeon } from '../../../../aeon-tonics/packages/export/prettifier/src/index.ts';
import {
  benchmarkTextEncodings,
  createDirectoryContainer,
  decodeDirectoryContainer,
  selectSmallestSuccessfulAttempt,
  type CompressionMethod,
  type DirectoryEntry,
  type DirectoryEntryInput,
  type ContainerDecodeOptions,
  type MagicMode
} from '../../../../neon-private/packages/core/src/index.ts';

interface CreateRequestOptions {
  readonly aeonPath?: string;
  readonly attachmentPaths?: string[];
  readonly emptyFolders?: string[];
  readonly useMinimizer?: boolean;
  readonly trailingNewline?: boolean;
  readonly magic?: MagicMode;
  readonly checksum?: boolean;
  readonly containerCompression?: CompressionMethod;
  readonly aeonEntryCompression?: CompressionMethod;
  readonly attachmentCompression?: CompressionMethod;
  readonly attachmentCompressionByPath?: Record<string, CompressionMethod>;
  readonly attachmentEncodingByPath?: Record<string, 'base64' | 'inline' | 'embed'>;
  readonly embedAttachmentsAsBase64?: boolean;
}

interface TextRaceSummary {
  readonly encoding: string;
  readonly compression: string;
  readonly containerBytes: number;
}

interface EntrySummary {
  readonly id: number;
  readonly kind: 'text' | 'binary' | 'folder';
  readonly name: string;
  readonly compression: CompressionMethod;
  readonly storedLength: number;
  readonly originalLength: number;
  readonly decodedOffset: number;
  readonly metadata: readonly { key: string; value: string }[];
  readonly textRace?: TextRaceSummary;
}

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const port = Number.parseInt(process.env.PORT ?? '4310', 10);

app.use(express.static('public'));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/api/create-neon', upload.fields([
  { name: 'aeonFile', maxCount: 1 },
  { name: 'attachments', maxCount: 500 }
]), (req, res) => {
  try {
    const aeonFile = getSingleFile(req.files, 'aeonFile');
    if (!aeonFile) {
      throw new Error('Missing AEON file');
    }

    const attachmentFiles = getFiles(req.files, 'attachments');
    const options = parseCreateOptions(req.body.options);

    const originalAeonText = aeonFile.buffer.toString('utf8');
    const originalAeonBytes = byteLengthOf(originalAeonText);

    const compactedAeonText = options.useMinimizer
      ? minimizeAeon(originalAeonText, Boolean(options.trailingNewline))
      : originalAeonText;

    const compactedAeonBytes = byteLengthOf(compactedAeonText);

    const normalizedAeonName = normalizeRelativeName(options.aeonPath?.trim() || aeonFile.originalname || 'document.aeon');

    const entries: DirectoryEntryInput[] = [];
    let nextId = 1;

    const folderNames = new Set<string>();
    for (const folder of options.emptyFolders ?? []) {
      const normalized = normalizeFolderName(folder);
      if (normalized.length > 0) {
        folderNames.add(normalized);
      }
    }

    const attachmentPaths = Array.isArray(options.attachmentPaths) ? options.attachmentPaths : [];
    for (let index = 0; index < attachmentFiles.length; index += 1) {
      const file = attachmentFiles[index]!;
      const incomingName = typeof attachmentPaths[index] === 'string' && attachmentPaths[index]!.trim().length > 0
        ? attachmentPaths[index]!
        : file.originalname;
      const normalizedName = normalizeRelativeName(incomingName);
      collectParentFolders(normalizedName).forEach((folder) => folderNames.add(folder));
    }
    collectParentFolders(normalizedAeonName).forEach((folder) => folderNames.add(folder));

    const sortedFolders = Array.from(folderNames).sort();
    for (const folderName of sortedFolders) {
      entries.push({
        id: nextId,
        kind: 'folder',
        name: folderName
      });
      nextId += 1;
    }

    const aeonEntryId = nextId;
    nextId += 1;

    let totalAttachmentBytes = 0;
    let modifiedAeonText = compactedAeonText;

    for (let index = 0; index < attachmentFiles.length; index += 1) {
      const file = attachmentFiles[index]!;
      const incomingName = typeof attachmentPaths[index] === 'string' && attachmentPaths[index]!.trim().length > 0
        ? attachmentPaths[index]!
        : file.originalname;
      const normalizedName = normalizeRelativeName(incomingName);
      const selectedCompression = coerceCompressionMethod(
        options.attachmentCompressionByPath?.[normalizedName] ?? options.attachmentCompression,
        'none'
      );
      const selectedEncoding = options.attachmentEncodingByPath?.[normalizedName]
        ?? (options.embedAttachmentsAsBase64 ? 'base64' : 'embed');
      const bytes = new Uint8Array(file.buffer);
      totalAttachmentBytes += bytes.byteLength;

      // :base64 - append to AEON source as text literal, don't add as directory entry
      if (selectedEncoding === 'base64') {
        const base64Snippet = buildBase64Snippet(normalizedName, bytes, file.mimetype || 'application/octet-stream', 'attachment');
        modifiedAeonText += `${modifiedAeonText.length > 0 && !modifiedAeonText.endsWith('\n') ? '\n' : ''}${base64Snippet}`;
        continue;
      }

      // :inline - store as binary entry with metadata marking it as inline
      if (selectedEncoding === 'inline') {
        entries.push({
          id: nextId,
          kind: 'binary',
          bytes,
          name: normalizedName,
          compression: selectedCompression,
          metadata: [
            { key: 'filename', value: file.originalname },
            { key: 'mime', value: file.mimetype || 'application/octet-stream' },
            { key: 'attachment-kind', value: 'inline' },
            { key: 'encoding-type', value: 'inline' }
          ]
        });
        nextId += 1;
        continue;
      }

      // :embed - store as normal binary attachment (default)
      const text = tryDecodeTextAttachment(file);
      if (text !== null) {
        const race = computeTextRaceWinner(text);
        entries.push({
          id: nextId,
          kind: 'text',
          text,
          name: normalizedName,
          compression: selectedCompression,
          metadata: [
            { key: 'filename', value: file.originalname },
            { key: 'mime', value: file.mimetype || 'text/plain' },
            { key: 'attachment-kind', value: 'text' },
            ...(race
              ? [
                  { key: 'neon-race-encoding', value: race.encoding },
                  { key: 'neon-race-compression', value: race.compression },
                  { key: 'neon-race-bytes', value: String(race.containerBytes) }
                ]
              : [])
          ]
        });
      } else {
        entries.push({
          id: nextId,
          kind: 'binary',
          bytes,
          name: normalizedName,
          compression: selectedCompression,
          metadata: [
            { key: 'filename', value: file.originalname },
            { key: 'mime', value: file.mimetype || 'application/octet-stream' },
            { key: 'attachment-kind', value: 'binary' }
          ]
        });
      }
      nextId += 1;
    }

    const aeonRace = computeTextRaceWinner(modifiedAeonText);
    entries.push({
      id: aeonEntryId,
      kind: 'text',
      text: modifiedAeonText,
      name: normalizedAeonName,
      compression: coerceCompressionMethod(options.aeonEntryCompression, 'none'),
      metadata: [
        { key: 'kind', value: 'aeon-source' },
        { key: 'minimized', value: options.useMinimizer ? 'true' : 'false' },
        ...(aeonRace
          ? [
              { key: 'neon-race-encoding', value: aeonRace.encoding },
              { key: 'neon-race-compression', value: aeonRace.compression },
              { key: 'neon-race-bytes', value: String(aeonRace.containerBytes) }
            ]
          : [])
      ]
    });

    const container = createDirectoryContainer(entries, {
      primaryEntryId: aeonEntryId,
      magic: options.magic ?? 'present',
      checksum: Boolean(options.checksum),
      compression: coerceCompressionMethod(options.containerCompression, 'none'),
      encoding: 'utf-8'
    });

    const entrySummaries = summarizeEntries(container.directory.entries, false);
    const totalInputBytes = compactedAeonBytes + totalAttachmentBytes;
    const neonSizeBytes = container.buffer.byteLength;
    const encodingModes = detectEncodingModes(modifiedAeonText);

    res.json({
      neonBase64: Buffer.from(container.buffer).toString('base64'),
      suggestedFileName: `${stripExtension(normalizedAeonName)}.neon`,
      settings: {
        magic: options.magic ?? 'present',
        checksum: Boolean(options.checksum),
        containerCompression: coerceCompressionMethod(options.containerCompression, 'none'),
        aeonEntryCompression: coerceCompressionMethod(options.aeonEntryCompression, 'none'),
        attachmentCompression: coerceCompressionMethod(options.attachmentCompression, 'none'),
        useMinimizer: Boolean(options.useMinimizer)
      },
      encodingModes,
      manifest: {
        primaryEntryId: container.directory.primaryEntryId,
        entries: entrySummaries,
        byteLayout: {
          payloadByteStart: container.header.payloadOffset,
          payloadByteEnd: container.buffer.byteLength - container.header.trailerLength - 1,
          directoryDecodedBytes: container.directory.directoryBytes.length,
          totalDecodedBytes: container.directory.directoryBytes.length + container.directory.payloadRegion.length,
          trailerByteLength: container.header.trailerLength
        }
      },
      rates: {
        aeonOriginalBytes: originalAeonBytes,
        aeonCompactedBytes: compactedAeonBytes,
        aeonCompactionRatio: safeRatio(compactedAeonBytes, originalAeonBytes),
        attachmentsBytes: totalAttachmentBytes,
        inputBytes: totalInputBytes,
        neonBytes: neonSizeBytes,
        neonVsInputRatio: safeRatio(neonSizeBytes, totalInputBytes),
        savingsFraction: totalInputBytes > 0 ? 1 - (neonSizeBytes / totalInputBytes) : 0
      }
    });
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Failed to create Neon container'
    });
  }
});

app.post('/api/open-neon', upload.single('neonFile'), (req, res) => {
  try {
    if (!req.file) {
      throw new Error('Missing Neon file');
    }

    const decodeOptions: ContainerDecodeOptions = {
      magic: 'detect',
      modeHint: 'extended'
    };

    const decoded = decodeDirectoryContainer(new Uint8Array(req.file.buffer), decodeOptions);
    const entries = summarizeEntries(decoded.directory.entries, true);

    const primaryEntry = decoded.directory.entries.find((entry) => entry.id === decoded.directory.primaryEntryId);
    let primaryText = primaryEntry && primaryEntry.kind === 'text' ? primaryEntry.text : '';
    
    // Prettify minimized AEON text if it's readable as AEON
    if (primaryText.length > 0) {
      try {
        const prettified = prettifyAeon(primaryText, { trailingNewline: true });
        primaryText = prettified.text;
      } catch (_err) {
        // If prettification fails, keep the original text
      }
    }

    // Reconstruct :inline entries as base64 snippets in the primary text
    const inlineEntries = decoded.directory.entries.filter(
      (entry) => entry.kind === 'binary' && entry.metadata?.find((m) => m.key === 'encoding-type')?.value === 'inline'
    );
    
    if (inlineEntries.length > 0) {
      const separator = primaryText.endsWith('\n\n') || primaryText.length === 0 ? '' : '\n';
      for (const entry of inlineEntries) {
        if (entry.kind === 'binary') {
          const mime = entry.metadata?.find((m) => m.key === 'mime')?.value || 'application/octet-stream';
          const binname = entry.metadata?.find((m) => m.key === 'filename')?.value || `inline-${entry.id}`;
          const base64Snippet = buildBase64Snippet(binname, entry.bytes, mime, 'inline');
          primaryText += (primaryText.length > 0 ? '\n' : '') + base64Snippet;
        }
      }
    }

    const totalOriginal = entries
      .filter((entry) => entry.kind !== 'folder')
      .reduce((sum, entry) => sum + entry.originalLength, 0);
    
    const encodingModes = detectEncodingModes(primaryText);
    const hasDirectory = Boolean(decoded.header.extension?.hasDirectory);
    const textRoundTripSafe = isTextRoundTripSafe(primaryText, hasDirectory);

    res.json({
      header: {
        mode: decoded.header.mode,
        magic: decoded.header.magic,
        encoding: decoded.header.encoding,
        checksum: Boolean(decoded.header.extension?.checksum),
        compression: decoded.header.extension?.compression ?? 'none'
      },
      encodingModes,
      textRoundTrip: textRoundTripSafe ? 'lossless-text' : 'binary-only-inline',
      manifest: {
        primaryEntryId: decoded.directory.primaryEntryId,
        entries,
        byteLayout: {
          payloadByteStart: decoded.header.payloadOffset,
          payloadByteEnd: decoded.buffer.byteLength - decoded.header.trailerLength - 1,
          directoryDecodedBytes: decoded.directory.directoryBytes.length,
          totalDecodedBytes: decoded.directory.directoryBytes.length + decoded.directory.payloadRegion.length,
          trailerByteLength: decoded.header.trailerLength
        }
      },
      primaryText,
      rates: {
        neonBytes: decoded.buffer.byteLength,
        totalOriginalBytes: totalOriginal,
        neonVsOriginalRatio: safeRatio(decoded.buffer.byteLength, totalOriginal),
        savingsFraction: totalOriginal > 0 ? 1 - (decoded.buffer.byteLength / totalOriginal) : 0
      }
    });
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Failed to open Neon file'
    });
  }
});

app.listen(port, () => {
  console.log(`Neon web app listening on http://localhost:${port}`);
});

function parseCreateOptions(raw: unknown): CreateRequestOptions {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return {};
  }

  const parsed = JSON.parse(raw) as CreateRequestOptions;
  return {
    ...parsed,
    emptyFolders: Array.isArray(parsed.emptyFolders) ? parsed.emptyFolders : [],
    attachmentCompressionByPath: typeof parsed.attachmentCompressionByPath === 'object' && parsed.attachmentCompressionByPath !== null
      ? parsed.attachmentCompressionByPath
      : {}
  };
}

function minimizeAeon(source: string, trailingNewline: boolean): string {
  const compiled = compile(source);
  if (!compiled || !Array.isArray(compiled.errors)) {
    throw new Error('AEON compile did not return diagnostics in expected shape');
  }
  if (compiled.errors.length > 0) {
    throw new Error(`AEON minimizer failed: ${compiled.errors[0]?.message ?? 'invalid AEON source'}`);
  }
  return minimize(compiled.events, { trailingNewline }).text;
}

function detectEncodingModes(source: string): string[] {
  const modes: string[] = [];
  if (/:base64(?:\s*=)?/.test(source)) {
    modes.push('base64');
  }
  if (/:inline(?:\s*=)?/.test(source)) {
    modes.push('inline');
  }
  if (/:embed(?:\s*=)?/.test(source)) {
    modes.push('embed');
  }
  return modes;
}

function isTextRoundTripSafe(source: string, hasDirectory: boolean): boolean {
  if (hasDirectory) {
    return true;
  }
  return !/:inline(?:\s*=)?/.test(source);
}

function buildBase64Snippet(
  name: string,
  bytes: Uint8Array,
  mime: string,
  kind: string = 'attachment'
): string {
  const stem = name.replace(/\.[^.]*$/, '');
  const binding = stem.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^[0-9]/, 'n_');
  const base64Str = Buffer.from(bytes).toString('base64');
  return `${binding}@{mime="${mime}",binname="${name}",binkind="${kind}"}:base64 = $${base64Str}\n`;
}

function getSingleFile(
  files: Express.Multer.File[] | { [fieldname: string]: Express.Multer.File[] } | undefined,
  field: string
): Express.Multer.File | null {
  if (!files || Array.isArray(files)) {
    return null;
  }
  const selected = files[field];
  return selected && selected.length > 0 ? selected[0] ?? null : null;
}

function getFiles(
  files: Express.Multer.File[] | { [fieldname: string]: Express.Multer.File[] } | undefined,
  field: string
): readonly Express.Multer.File[] {
  if (!files || Array.isArray(files)) {
    return [];
  }
  return files[field] ?? [];
}

function normalizeRelativeName(value: string): string {
  const normalized = value.replaceAll('\\', '/').replace(/^\/+/, '').trim();
  if (normalized.length === 0) {
    throw new Error('Entry name cannot be empty');
  }
  const parts = normalized.split('/');
  for (const part of parts) {
    if (part === '..') {
      throw new Error(`Invalid entry path "${value}": contains ..`);
    }
    if (part.includes('\0')) {
      throw new Error(`Invalid entry path "${value}": contains null byte`);
    }
  }
  return normalized;
}

function normalizeFolderName(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return '';
  }
  const normalized = normalizeRelativeName(trimmed);
  return normalized.endsWith('/') ? normalized : `${normalized}/`;
}

function collectParentFolders(pathName: string): string[] {
  const parts = pathName.split('/').filter((part) => part.length > 0);
  const folders: string[] = [];
  for (let i = 0; i < parts.length - 1; i += 1) {
    folders.push(`${parts.slice(0, i + 1).join('/')}/`);
  }
  return folders;
}

function summarizeEntries(entries: readonly DirectoryEntry[], includeComputedRace: boolean): EntrySummary[] {
  return entries.map((entry) => ({
    id: entry.id,
    kind: entry.kind,
    name: entry.name,
    compression: entry.compression,
    storedLength: entry.storedLength,
    originalLength: entry.originalLength,
    decodedOffset: entry.dataOffset,
    metadata: entry.metadata,
    textRace: entry.kind === 'text'
      ? readTextRaceFromMetadata(entry.metadata) ?? (includeComputedRace ? computeTextRaceWinner(entry.text) : undefined)
      : undefined
  }));
}

function readTextRaceFromMetadata(metadata: readonly { key: string; value: string }[]): TextRaceSummary | undefined {
  const encoding = metadata.find((item) => item.key === 'neon-race-encoding')?.value;
  const compression = metadata.find((item) => item.key === 'neon-race-compression')?.value;
  const bytesRaw = metadata.find((item) => item.key === 'neon-race-bytes')?.value;
  const containerBytes = bytesRaw ? Number.parseInt(bytesRaw, 10) : Number.NaN;

  if (!encoding || !compression || !Number.isFinite(containerBytes)) {
    return undefined;
  }
  return {
    encoding,
    compression,
    containerBytes
  };
}

function computeTextRaceWinner(text: string): TextRaceSummary | undefined {
  const report = benchmarkTextEncodings(text, {
    iterations: 1
  });
  const best = selectSmallestSuccessfulAttempt(report);
  if (!best || best.containerByteLength === undefined) {
    return undefined;
  }
  return {
    encoding: best.encoding,
    compression: best.compression,
    containerBytes: best.containerByteLength
  };
}

function tryDecodeTextAttachment(file: Express.Multer.File): string | null {
  const name = file.originalname.toLowerCase();
  const mime = file.mimetype.toLowerCase();
  const likelyText = mime.startsWith('text/')
    || mime.includes('json')
    || mime.includes('xml')
    || mime.includes('javascript')
    || mime.includes('typescript')
    || mime.includes('yaml')
    || /\.(aeon|txt|md|json|yaml|yml|xml|csv|html|css|js|mjs|cjs|ts|tsx|jsx)$/i.test(name);

  if (!likelyText) {
    return null;
  }

  const text = file.buffer.toString('utf8');
  if (text.includes('\0')) {
    return null;
  }
  return text;
}

function coerceCompressionMethod(value: unknown, fallback: CompressionMethod): CompressionMethod {
  if (value === 'none' || value === 'deflate' || value === 'brotli') {
    return value;
  }
  return fallback;
}

function stripExtension(pathName: string): string {
  const base = pathName.split('/').pop() ?? pathName;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

function safeRatio(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return 1;
  }
  return numerator / denominator;
}

function byteLengthOf(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

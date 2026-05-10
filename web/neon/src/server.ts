import express from 'express';
import multer from 'multer';
import { brotliCompressSync, deflateSync } from 'node:zlib';
import { compile } from '../../../../aeon/implementations/typescript/packages/core/src/index.ts';
import { minimize } from '../../../../aeon-tonics/packages/export/minizer/src/index.ts';
import { prettifyAeon } from '../../../../aeon-tonics/packages/export/prettifier/src/index.ts';
import {
  encodeAeonSource,
  planAeonSource,
  reconstructAeonSource,
  type EncodedAeonSourceContainer
} from '../../../../neon-private/packages/aeon/src/index.ts';
import {
  benchmarkTextEncodings,
  createDirectoryContainer,
  decodeContainer,
  decodeDirectoryContainer,
  decodePlanContainer,
  decodeTextContainer,
  selectSmallestSuccessfulAttempt,
  SUPPORTED_ENCODINGS,
  type CompressionMethod,
  type ContainerPayload,
  type DirectoryEntry,
  type DirectoryEntryInput,
  type DecodedDirectoryContainer,
  type DecodedPlanContainer,
  type DecodedTextContainer,
  type ContainerDecodeOptions,
  type MagicMode,
  type NeonEncoding
} from '../../../../neon-private/packages/core/src/index.ts';

type ContainerCompressionOption = CompressionMethod | 'race';
type NeonEncodingOption = NeonEncoding | 'race';
type CompressionScope = 'none' | 'text' | 'container';
type AeonSourceTransform = 'preserve' | 'compact' | 'minimize';

interface CreateRequestOptions {
  readonly aeonPath?: string;
  readonly attachmentPaths?: string[];
  readonly emptyFolders?: string[];
  readonly aeonSourceTransform?: AeonSourceTransform;
  readonly useMinimizer?: boolean;
  readonly trailingNewline?: boolean;
  readonly magic?: MagicMode;
  readonly checksum?: boolean;
  readonly neonEncoding?: NeonEncodingOption;
  readonly compressionScope?: CompressionScope;
  readonly compressionMethod?: ContainerCompressionOption;
  readonly containerCompression?: ContainerCompressionOption;
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
  readonly encoding?: string;
  readonly compression: CompressionMethod;
  readonly storedLength: number;
  readonly originalLength: number;
  readonly decodedBitLength?: number;
  readonly decodedOffset: number;
  readonly metadata: readonly { key: string; value: string }[];
  readonly textRace?: TextRaceSummary;
}

interface DirectoryBuildOptions {
  readonly primaryEntryId?: number | null;
  readonly magic: MagicMode;
  readonly checksum: boolean;
  readonly encoding: NeonEncodingOption;
  readonly compression: ContainerCompressionOption;
}

interface DirectoryBuildResult {
  readonly container: DecodedDirectoryContainer;
  readonly requestedEncoding: NeonEncodingOption;
  readonly selectedEncoding: NeonEncoding;
  readonly requestedCompression: ContainerCompressionOption;
  readonly selectedCompression: CompressionMethod;
}

interface TextBuildResult {
  readonly container: EncodedAeonSourceContainer;
  readonly requestedEncoding: NeonEncodingOption;
  readonly selectedEncoding: NeonEncoding;
  readonly requestedCompression: ContainerCompressionOption;
  readonly selectedCompression: CompressionMethod;
}

interface CompressionPlan {
  readonly scope: CompressionScope;
  readonly method: ContainerCompressionOption;
  readonly containerCompression: ContainerCompressionOption;
  readonly textEntryCompression: ContainerCompressionOption;
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
    const compressionPlan = resolveCompressionPlan(options);

    const originalAeonText = aeonFile.buffer.toString('utf8');
    const originalAeonBytes = byteLengthOf(originalAeonText);

    const aeonSourceTransform = resolveAeonSourceTransform(options);
    const compactedAeonText = transformAeonSource(originalAeonText, aeonSourceTransform, Boolean(options.trailingNewline));

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
          compression: 'none',
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
        const selectedCompression = selectTextEntryCompression(text, compressionPlan.textEntryCompression);
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
          compression: 'none',
          metadata: [
            { key: 'filename', value: file.originalname },
            { key: 'mime', value: file.mimetype || 'application/octet-stream' },
            { key: 'attachment-kind', value: 'binary' }
          ]
        });
      }
      nextId += 1;
    }

    if (entries.length === 0) {
      const build = createBestAeonSourceContainer(modifiedAeonText, {
        magic: options.magic ?? 'present',
        checksum: Boolean(options.checksum),
        compression: compressionPlan.scope === 'none' ? 'none' : compressionPlan.method,
        encoding: coerceNeonEncodingOption(options.neonEncoding, 'utf-8'),
        sourceName: normalizedAeonName
      });
      const container = build.container;
      const neonSizeBytes = container.buffer.byteLength;
      const encodingModes = detectEncodingModes(modifiedAeonText);
      const reconstructed = reconstructAeonSource(container);

      res.json({
        neonBase64: Buffer.from(container.buffer).toString('base64'),
        suggestedFileName: `${stripExtension(normalizedAeonName)}.neon`,
        settings: {
          magic: options.magic ?? 'present',
          checksum: Boolean(options.checksum),
          neonEncoding: build.requestedEncoding,
          selectedNeonEncoding: build.selectedEncoding,
          containerCompression: build.requestedCompression,
          selectedContainerCompression: build.selectedCompression,
          compressionScope: compressionPlan.scope,
          compressionMethod: compressionPlan.method,
          aeonEntryCompression: compressionPlan.textEntryCompression,
          attachmentCompression: compressionPlan.textEntryCompression,
          aeonSourceTransform,
          useMinimizer: aeonSourceTransform === 'minimize'
        },
        encodingModes,
        manifest: summarizeAeonSourceManifest(container, normalizedAeonName, reconstructed.source),
        rates: {
          aeonOriginalBytes: originalAeonBytes,
          aeonCompactedBytes: compactedAeonBytes,
          aeonCompactionRatio: safeRatio(compactedAeonBytes, originalAeonBytes),
          attachmentsBytes: totalAttachmentBytes,
          inputBytes: compactedAeonBytes,
          neonBytes: neonSizeBytes,
          neonVsInputRatio: safeRatio(neonSizeBytes, compactedAeonBytes),
          savingsFraction: compactedAeonBytes > 0 ? 1 - (neonSizeBytes / compactedAeonBytes) : 0
        }
      });
      return;
    }

    const aeonRace = computeTextRaceWinner(modifiedAeonText);
    entries.push({
      id: aeonEntryId,
      kind: 'text',
      text: modifiedAeonText,
      name: normalizedAeonName,
      compression: selectTextEntryCompression(modifiedAeonText, compressionPlan.textEntryCompression),
      metadata: [
        { key: 'kind', value: 'aeon-source' },
        { key: 'source-transform', value: aeonSourceTransform },
        { key: 'minimized', value: aeonSourceTransform === 'minimize' ? 'true' : 'false' },
        ...(aeonRace
          ? [
              { key: 'neon-race-encoding', value: aeonRace.encoding },
              { key: 'neon-race-compression', value: aeonRace.compression },
              { key: 'neon-race-bytes', value: String(aeonRace.containerBytes) }
            ]
          : [])
      ]
    });

    const build = createBestDirectoryContainer(entries, {
      primaryEntryId: aeonEntryId,
      magic: options.magic ?? 'present',
      checksum: Boolean(options.checksum),
      compression: compressionPlan.containerCompression,
      encoding: coerceNeonEncodingOption(options.neonEncoding, 'utf-8')
    });
    const container = build.container;

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
        neonEncoding: build.requestedEncoding,
        selectedNeonEncoding: build.selectedEncoding,
        containerCompression: build.requestedCompression,
        selectedContainerCompression: build.selectedCompression,
        compressionScope: compressionPlan.scope,
        compressionMethod: compressionPlan.method,
        aeonEntryCompression: compressionPlan.textEntryCompression,
        attachmentCompression: compressionPlan.textEntryCompression,
        aeonSourceTransform,
        useMinimizer: aeonSourceTransform === 'minimize'
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

    const bytes = new Uint8Array(req.file.buffer);
    const parsed = decodeContainer(bytes, decodeOptions);
    if (!parsed.header.extension?.hasDirectory) {
      const decoded = decodeStandaloneAeonContainer(bytes, parsed.header.encoding, decodeOptions);
      const reconstructed = reconstructAeonSource(decoded);
      let primaryText = reconstructed.source;
      if (primaryText.length > 0) {
        try {
          const prettified = prettifyAeon(primaryText, { trailingNewline: true });
          primaryText = prettified.text;
        } catch (_err) {
          // If prettification fails, keep the original text.
        }
      }

      const entry = summarizeStandaloneTextEntry(decoded, req.file.originalname || 'document.aeon', reconstructed.source);
      const encodingModes = detectEncodingModes(primaryText);
      const textRoundTripSafe = isTextRoundTripSafe(primaryText, false);

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
          primaryEntryId: 0,
          entries: [entry]
        },
        primaryText,
        rates: {
          neonBytes: decoded.buffer.byteLength,
          totalOriginalBytes: entry.originalLength,
          neonVsOriginalRatio: safeRatio(decoded.buffer.byteLength, entry.originalLength),
          savingsFraction: entry.originalLength > 0 ? 1 - (decoded.buffer.byteLength / entry.originalLength) : 0
        }
      });
      return;
    }

    const decoded = decodeDirectoryContainer(bytes, decodeOptions);
    const entries = summarizeEntries(decoded.directory.entries, true);

    const primaryEntry = decoded.directory.primaryEntryId === null
      ? null
      : decoded.directory.entries.find((entry) => entry.id === decoded.directory.primaryEntryId);
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

function resolveAeonSourceTransform(options: CreateRequestOptions): AeonSourceTransform {
  if (
    options.aeonSourceTransform === 'preserve'
    || options.aeonSourceTransform === 'compact'
    || options.aeonSourceTransform === 'minimize'
  ) {
    return options.aeonSourceTransform;
  }
  return options.useMinimizer ? 'minimize' : 'preserve';
}

function transformAeonSource(source: string, transform: AeonSourceTransform, trailingNewline: boolean): string {
  switch (transform) {
    case 'preserve':
      return source;
    case 'compact': {
      const compacted = planAeonSource(source, {
        strategy: 'parser',
        commentPolicy: 'preserve',
        whitespacePolicy: 'minimize'
      }).normalizedSource;
      return trailingNewline ? ensureTrailingNewline(compacted) : compacted.replace(/\n+$/u, '');
    }
    case 'minimize':
      return minimizeAeon(source, trailingNewline);
    default: {
      const neverTransform: never = transform;
      throw new Error(`Unsupported AEON source transform: ${String(neverTransform)}`);
    }
  }
}

function ensureTrailingNewline(source: string): string {
  return source.endsWith('\n') ? source : `${source}\n`;
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
    encoding: entry.encoding,
    compression: entry.compression,
    storedLength: entry.storedLength,
    originalLength: entry.originalLength,
    decodedBitLength: entry.decodedBitLength,
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

function createBestAeonSourceContainer(
  text: string,
  options: Omit<DirectoryBuildOptions, 'primaryEntryId'> & { readonly sourceName?: string }
): TextBuildResult {
  const requestedEncoding = options.encoding;
  const requestedCompression = options.compression;
  const encodings: readonly NeonEncoding[] = requestedEncoding === 'race'
    ? SUPPORTED_ENCODINGS
    : [requestedEncoding];

  let best: TextBuildResult | null = null;
  for (const encoding of encodings) {
    const container = encodeAeonSource(text, {
      magic: options.magic,
      checksum: options.checksum,
      encoding,
      compression: requestedCompression,
      sourceName: options.sourceName,
      strategy: 'parser',
      targetEncoding: encoding === 'utf-8' ? '2p6b-aeon' : encoding
    });
    if (!best || container.buffer.byteLength < best.container.buffer.byteLength) {
      best = {
        container,
        requestedEncoding,
        selectedEncoding: container.header.encoding,
        requestedCompression,
        selectedCompression: container.header.extension?.compression ?? 'none'
      };
    }
  }

  if (!best) {
    throw new Error('No Neon text container candidates were produced');
  }
  return best;
}

function createBestDirectoryContainer(
  entries: readonly DirectoryEntryInput[],
  options: DirectoryBuildOptions
): DirectoryBuildResult {
  const requestedEncoding = options.encoding;
  const requestedCompression = options.compression;
  const encodings: readonly NeonEncoding[] = requestedEncoding === 'race'
    ? SUPPORTED_ENCODINGS
    : [requestedEncoding];
  const compressions: readonly CompressionMethod[] = requestedCompression === 'race'
    ? ['none', 'deflate', 'brotli']
    : [requestedCompression];

  let best: DirectoryBuildResult | null = null;
  for (const encoding of encodings) {
    for (const compression of compressions) {
      const encodedEntries = withTextEntryEncoding(entries, encoding);
      const container = createDirectoryContainer(encodedEntries, {
        primaryEntryId: options.primaryEntryId,
        magic: options.magic,
        checksum: options.checksum,
        encoding,
        compression
      });
      if (!best || container.buffer.byteLength < best.container.buffer.byteLength) {
        best = {
          container,
          requestedEncoding,
          selectedEncoding: encoding,
          requestedCompression,
          selectedCompression: compression
        };
      }
    }
  }

  if (!best) {
    throw new Error('No Neon directory container candidates were produced');
  }
  return best;
}

function withTextEntryEncoding(
  entries: readonly DirectoryEntryInput[],
  encoding: NeonEncoding
): readonly DirectoryEntryInput[] {
  return entries.map((entry) => {
    if (entry.kind !== 'text') {
      return entry;
    }
    return {
      ...entry,
      encoding
    };
  });
}

function summarizeStandaloneTextEntry(
  container: ContainerPayload,
  name: string,
  text: string
): EntrySummary {
  const trailerLength = container.header.trailerLength;
  const payloadEnd = container.buffer.byteLength - trailerLength;
  const storedLength = Math.max(0, payloadEnd - container.header.payloadOffset);
  return {
    id: 0,
    kind: 'text',
    name,
    encoding: container.header.encoding,
    compression: container.header.extension?.compression ?? 'none',
    storedLength,
    originalLength: byteLengthOf(text),
    decodedBitLength: container.payload.length * 8 - container.header.padBits,
    decodedOffset: 0,
    metadata: [{ key: 'container-kind', value: 'standalone-text' }]
  };
}

function summarizeAeonSourceManifest(
  container: EncodedAeonSourceContainer,
  name: string,
  source: string
): { primaryEntryId: number | null; entries: readonly EntrySummary[]; byteLayout?: unknown } {
  if ('directory' in container) {
    return {
      primaryEntryId: container.directory.primaryEntryId,
      entries: summarizeEntries(container.directory.entries, false),
      byteLayout: {
        payloadByteStart: container.header.payloadOffset,
        payloadByteEnd: container.buffer.byteLength - container.header.trailerLength - 1,
        directoryDecodedBytes: container.directory.directoryBytes.length,
        totalDecodedBytes: container.directory.directoryBytes.length + container.directory.payloadRegion.length,
        trailerByteLength: container.header.trailerLength
      }
    };
  }

  return {
    primaryEntryId: 0,
    entries: [summarizeStandaloneTextEntry(container, name, source)]
  };
}

function decodeStandaloneAeonContainer(
  bytes: Uint8Array,
  encoding: NeonEncoding,
  options: ContainerDecodeOptions
): DecodedTextContainer | DecodedPlanContainer {
  if (encoding === 'utf-8') {
    return decodeTextContainer(bytes, options);
  }
  return decodePlanContainer(bytes, options);
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

function coerceContainerCompressionOption(value: unknown, fallback: ContainerCompressionOption): ContainerCompressionOption {
  if (value === 'race') {
    return value;
  }
  return coerceCompressionMethod(value, fallback === 'race' ? 'none' : fallback);
}

function resolveCompressionPlan(options: CreateRequestOptions): CompressionPlan {
  const scope = options.compressionScope === 'text' || options.compressionScope === 'container' || options.compressionScope === 'none'
    ? options.compressionScope
    : undefined;
  const method = coerceContainerCompressionOption(options.compressionMethod, 'race');

  if (scope) {
    return {
      scope,
      method: scope === 'none' ? 'none' : method,
      containerCompression: scope === 'container' ? method : 'none',
      textEntryCompression: scope === 'text' ? method : 'none'
    };
  }

  const containerCompression = coerceContainerCompressionOption(options.containerCompression, 'none');
  const textEntryCompression = coerceContainerCompressionOption(options.aeonEntryCompression ?? options.attachmentCompression, 'none');
  return {
    scope: containerCompression !== 'none' ? 'container' : textEntryCompression !== 'none' ? 'text' : 'none',
    method: containerCompression !== 'none' ? containerCompression : textEntryCompression,
    containerCompression,
    textEntryCompression
  };
}

function selectTextEntryCompression(text: string, requested: ContainerCompressionOption): CompressionMethod {
  if (requested !== 'race') {
    return coerceCompressionMethod(requested, 'none');
  }

  const bytes = Buffer.from(text, 'utf8');
  const candidates: { method: CompressionMethod; length: number }[] = [
    { method: 'none', length: bytes.byteLength },
    { method: 'deflate', length: deflateSync(bytes).byteLength },
    { method: 'brotli', length: brotliCompressSync(bytes).byteLength }
  ];
  candidates.sort((left, right) => left.length - right.length);
  return candidates[0]?.method ?? 'none';
}

function coerceNeonEncodingOption(value: unknown, fallback: NeonEncodingOption): NeonEncodingOption {
  if (value === 'race') {
    return value;
  }
  return coerceNeonEncoding(value, fallback === 'race' ? 'utf-8' : fallback);
}

function coerceNeonEncoding(value: unknown, fallback: NeonEncoding): NeonEncoding {
  if (value === '2p6b-gp' || value === '2p6b-aeon' || value === '3p6b' || value === 'utf-8') {
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

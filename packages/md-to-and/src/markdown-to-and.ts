import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { unified } from 'unified';
import remarkFrontmatter from 'remark-frontmatter';
import remarkParse from 'remark-parse';

export type DiagnosticSeverity = 'warning' | 'error';

export interface ConvertDiagnostic {
  readonly severity: DiagnosticSeverity;
  readonly code: string;
  readonly message: string;
  readonly location?: {
    readonly line: number;
    readonly column: number;
  };
}

export interface NdDocument {
  readonly type: 'document';
  readonly children: NdBlockNode[];
}

export interface NdDocumentFragment {
  readonly type: 'document_fragment';
  readonly children: NdBlockNode[];
}

export interface NdParagraph {
  readonly type: 'paragraph';
  readonly children: NdInlineNode[];
}

export interface NdHeading {
  readonly type: 'heading';
  readonly level: 1 | 2 | 3 | 4 | 5 | 6;
  readonly children: NdInlineNode[];
}

export interface NdList {
  readonly type: 'list';
  readonly ordered: boolean;
  readonly items: NdListItem[];
}

export interface NdListItem {
  readonly type: 'list_item';
  readonly children: NdBlockNode[];
}

export interface NdBlockquote {
  readonly type: 'blockquote';
  readonly children: NdBlockNode[];
}

export interface NdCodeBlock {
  readonly type: 'code_block';
  readonly language: string | null;
  readonly ordered: boolean;
  readonly text: string;
}

export interface NdExtensionBlock {
  readonly type: 'extension_block';
  readonly name: string;
  readonly text: string;
  readonly fallback?: NdDocumentFragment;
}

export interface NdHorizontalRule {
  readonly type: 'horizontal_rule';
}

export interface NdText {
  readonly type: 'text';
  readonly value: string;
}

export interface NdStrong {
  readonly type: 'strong';
  readonly children: NdInlineNode[];
}

export interface NdEmphasis {
  readonly type: 'emphasis';
  readonly children: NdInlineNode[];
}

export interface NdCode {
  readonly type: 'code';
  readonly value: string;
}

export interface NdLink {
  readonly type: 'link';
  readonly href: string;
  readonly children: NdInlineNode[];
}

export type NdBlockNode =
  | NdParagraph
  | NdHeading
  | NdList
  | NdBlockquote
  | NdCodeBlock
  | NdExtensionBlock
  | NdHorizontalRule;

export type NdInlineNode = NdText | NdStrong | NdEmphasis | NdCode | NdLink;

export interface ConvertMarkdownOptions {
  readonly andCoreModuleUrl?: string;
}

export interface ConvertMarkdownResult {
  readonly document: NdDocument;
  readonly and: string;
  readonly diagnostics: readonly ConvertDiagnostic[];
}

export interface ConvertFileOptions extends ConvertMarkdownOptions {
  readonly outPath?: string;
  readonly dryRun?: boolean;
}

export interface ConvertFileResult {
  readonly inputPath: string;
  readonly outputPath: string;
  readonly and: string;
  readonly diagnostics: readonly ConvertDiagnostic[];
  readonly written: boolean;
}

export interface ConvertPathOptions extends ConvertFileOptions {
  readonly recursive?: boolean;
  readonly includeHidden?: boolean;
}

export interface ConvertPathResult {
  readonly converted: readonly ConvertFileResult[];
  readonly skipped: readonly string[];
}

interface PositionLike {
  readonly start?: { readonly line?: number; readonly column?: number; readonly offset?: number };
  readonly end?: { readonly line?: number; readonly column?: number; readonly offset?: number };
}

interface NodeLike {
  readonly type: string;
  readonly position?: PositionLike;
  readonly value?: string;
  readonly lang?: string | null;
  readonly ordered?: boolean;
  readonly depth?: number;
  readonly url?: string;
  readonly children?: readonly NodeLike[];
}

interface RootLike extends NodeLike {
  readonly type: 'root';
  readonly children: readonly NodeLike[];
}

interface AndCoreModule {
  readonly emitCanonical: (document: NdDocument, options: { readonly profile: 'standalone' | 'embedded' }) => string;
}

const markdownProcessor = unified().use(remarkParse).use(remarkFrontmatter, ['yaml']);
const markdownExtensions = new Set(['.md', '.markdown', '.mdown']);

export const defaultAndCoreModuleUrl = new URL('../../../../and-core/index.mjs', import.meta.url).href;

export function replaceMarkdownExtension(inputPath: string): string {
  const extension = extname(inputPath);
  if (!markdownExtensions.has(extension.toLowerCase())) {
    return `${inputPath}.and`;
  }
  return `${inputPath.slice(0, -extension.length)}.and`;
}

export function convertMarkdownToNd(markdown: string): {
  readonly document: NdDocument;
  readonly diagnostics: readonly ConvertDiagnostic[];
} {
  const normalized = markdown.replace(/\r\n?/g, '\n');
  const root = markdownProcessor.parse(normalized) as RootLike;
  const diagnostics: ConvertDiagnostic[] = [];
  const children: NdBlockNode[] = [];

  for (const node of root.children) {
    children.push(...projectBlock(node, normalized, diagnostics));
  }

  return {
    document: {
      type: 'document',
      children,
    },
    diagnostics,
  };
}

export async function convertMarkdownToAnd(
  markdown: string,
  options: ConvertMarkdownOptions = {},
): Promise<ConvertMarkdownResult> {
  const projected = convertMarkdownToNd(markdown);
  const andCore = await loadAndCoreModule(options.andCoreModuleUrl);
  const and = andCore.emitCanonical(projected.document, { profile: 'standalone' });
  return {
    document: projected.document,
    and,
    diagnostics: projected.diagnostics,
  };
}

export async function convertFile(inputPath: string, options: ConvertFileOptions = {}): Promise<ConvertFileResult> {
  const absoluteInput = resolve(inputPath);
  const markdown = await readFile(absoluteInput, 'utf8');
  const converted = await convertMarkdownToAnd(markdown, {
    andCoreModuleUrl: options.andCoreModuleUrl,
  });

  const outputPath = resolve(options.outPath ?? replaceMarkdownExtension(absoluteInput));
  const content = ensureTrailingNewline(converted.and);

  if (options.dryRun !== true) {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, content, 'utf8');
  }

  return {
    inputPath: absoluteInput,
    outputPath,
    and: content,
    diagnostics: converted.diagnostics,
    written: options.dryRun !== true,
  };
}

export async function convertPath(inputPath: string, options: ConvertPathOptions = {}): Promise<ConvertPathResult> {
  const absoluteInput = resolve(inputPath);
  const inputStats = await stat(absoluteInput);

  if (inputStats.isFile()) {
    const single = await convertFile(absoluteInput, options);
    return {
      converted: [single],
      skipped: [],
    };
  }

  if (!inputStats.isDirectory()) {
    throw new Error(`Input path is neither a file nor a directory: ${absoluteInput}`);
  }

  const recursive = options.recursive ?? true;
  const includeHidden = options.includeHidden ?? false;
  const markdownFiles = await collectMarkdownFiles(absoluteInput, recursive, includeHidden);
  const converted: ConvertFileResult[] = [];

  for (const markdownPath of markdownFiles) {
    const outputPath = options.outPath === undefined
      ? replaceMarkdownExtension(markdownPath)
      : replaceMarkdownExtension(join(resolve(options.outPath), relative(absoluteInput, markdownPath)));
    converted.push(await convertFile(markdownPath, {
      ...options,
      outPath: outputPath,
    }));
  }

  return {
    converted,
    skipped: [],
  };
}

async function loadAndCoreModule(moduleUrl: string | undefined): Promise<AndCoreModule> {
  const resolved = moduleUrl ?? defaultAndCoreModuleUrl;
  const loaded = await import(resolved);
  if (typeof loaded.emitCanonical !== 'function') {
    throw new Error(`and-core module at ${resolved} does not export emitCanonical`);
  }
  return loaded as AndCoreModule;
}

async function collectMarkdownFiles(
  directoryPath: string,
  recursive: boolean,
  includeHidden: boolean,
): Promise<string[]> {
  const queue = [directoryPath];
  const files: string[] = [];

  while (queue.length > 0) {
    const nextDirectory = queue.shift();
    if (nextDirectory === undefined) {
      break;
    }

    const entries = await readdir(nextDirectory, { withFileTypes: true });
    for (const entry of entries) {
      if (!includeHidden && entry.name.startsWith('.')) {
        continue;
      }

      const absoluteEntryPath = join(nextDirectory, entry.name);
      if (entry.isDirectory()) {
        if (recursive) {
          queue.push(absoluteEntryPath);
        }
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (!markdownExtensions.has(extname(entry.name).toLowerCase())) {
        continue;
      }

      files.push(absoluteEntryPath);
    }

    if (!recursive) {
      break;
    }
  }

  files.sort((left, right) => left.localeCompare(right));
  return files;
}

function projectBlock(node: NodeLike, source: string, diagnostics: ConvertDiagnostic[]): NdBlockNode[] {
  switch (node.type) {
    case 'yaml':
      return [
        {
          type: 'extension_block',
          name: 'document/meta',
          text: node.value ?? '',
          fallback: createFallbackFromText(node.value ?? ''),
        },
      ];
    case 'heading':
      return [
        {
          type: 'heading',
          level: clampHeadingLevel(node.depth),
          children: projectInlineNodes(node.children ?? [], source, diagnostics),
        },
      ];
    case 'paragraph':
      return [
        {
          type: 'paragraph',
          children: projectInlineNodes(node.children ?? [], source, diagnostics),
        },
      ];
    case 'blockquote':
      return [
        {
          type: 'blockquote',
          children: projectChildren(node.children ?? [], source, diagnostics),
        },
      ];
    case 'list':
      return [
        {
          type: 'list',
          ordered: node.ordered === true,
          items: (node.children ?? []).map((child) => ({
            type: 'list_item',
            children: projectChildren(child.children ?? [], source, diagnostics),
          })),
        },
      ];
    case 'code':
      return [
        {
          type: 'code_block',
          ordered: true,
          language: node.lang ?? null,
          text: node.value ?? '',
        },
      ];
    case 'thematicBreak':
      return [{ type: 'horizontal_rule' }];
    default: {
      const raw = extractNodeSource(node, source);
      diagnostics.push(createWarning(
        'MD_UNSUPPORTED_BLOCK',
        `Unsupported Markdown block "${node.type}" was preserved as extension_block fallback.`,
        node,
      ));
      return [createUnsupportedBlock(node.type, raw)];
    }
  }
}

function projectChildren(nodes: readonly NodeLike[], source: string, diagnostics: ConvertDiagnostic[]): NdBlockNode[] {
  const children: NdBlockNode[] = [];
  for (const child of nodes) {
    children.push(...projectBlock(child, source, diagnostics));
  }
  return children;
}

function projectInlineNodes(
  nodes: readonly NodeLike[],
  source: string,
  diagnostics: ConvertDiagnostic[],
): NdInlineNode[] {
  const children: NdInlineNode[] = [];

  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        children.push({ type: 'text', value: node.value ?? '' });
        break;
      case 'strong':
        children.push({
          type: 'strong',
          children: projectInlineNodes(node.children ?? [], source, diagnostics),
        });
        break;
      case 'emphasis':
        children.push({
          type: 'emphasis',
          children: projectInlineNodes(node.children ?? [], source, diagnostics),
        });
        break;
      case 'inlineCode':
        children.push({ type: 'code', value: node.value ?? '' });
        break;
      case 'link':
        children.push({
          type: 'link',
          href: node.url ?? '',
          children: projectInlineNodes(node.children ?? [], source, diagnostics),
        });
        break;
      case 'break':
        children.push({ type: 'text', value: '\n' });
        break;
      default: {
        const raw = extractNodeSource(node, source);
        diagnostics.push(createWarning(
          'MD_UNSUPPORTED_INLINE',
          `Unsupported Markdown inline "${node.type}" was preserved as text.`,
          node,
        ));
        children.push({ type: 'text', value: raw });
      }
    }
  }

  return mergeAdjacentText(children);
}

function extractNodeSource(node: NodeLike, source: string): string {
  const startOffset = node.position?.start?.offset;
  const endOffset = node.position?.end?.offset;

  if (typeof startOffset === 'number' && typeof endOffset === 'number' && endOffset >= startOffset) {
    return source.slice(startOffset, endOffset);
  }

  const startLine = node.position?.start?.line;
  const endLine = node.position?.end?.line;
  if (typeof startLine === 'number' && typeof endLine === 'number' && endLine >= startLine) {
    const lines = source.split('\n');
    return lines.slice(startLine - 1, endLine).join('\n');
  }

  return '';
}

function createUnsupportedBlock(nodeType: string, raw: string): NdExtensionBlock {
  const payload = raw.trim().length > 0 ? raw : `[unsupported:${nodeType}]`;
  return {
    type: 'extension_block',
    name: 'markdown/unsupported',
    text: payload,
    fallback: createFallbackFromText(payload),
  };
}

function createFallbackFromText(text: string): NdDocumentFragment {
  return {
    type: 'document_fragment',
    children: [
      {
        type: 'paragraph',
        children: [{ type: 'text', value: text }],
      },
    ],
  };
}

function clampHeadingLevel(level: number | undefined): 1 | 2 | 3 | 4 | 5 | 6 {
  if (level === undefined || Number.isNaN(level)) {
    return 1;
  }
  return Math.max(1, Math.min(6, Math.trunc(level))) as 1 | 2 | 3 | 4 | 5 | 6;
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith('\n') ? value : `${value}\n`;
}

function createWarning(code: string, message: string, node: NodeLike): ConvertDiagnostic {
  const line = node.position?.start?.line;
  const column = node.position?.start?.column;
  return {
    severity: 'warning',
    code,
    message,
    ...(line === undefined || column === undefined
      ? {}
      : {
          location: { line, column },
        }),
  };
}

function mergeAdjacentText(nodes: readonly NdInlineNode[]): NdInlineNode[] {
  const merged: NdInlineNode[] = [];
  for (const node of nodes) {
    const previous = merged[merged.length - 1];
    if (previous?.type === 'text' && node.type === 'text') {
      merged[merged.length - 1] = {
        type: 'text',
        value: previous.value + node.value,
      };
      continue;
    }
    merged.push(node);
  }
  return merged;
}

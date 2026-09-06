#!/usr/bin/env node
/**
 * Purpose: run source-lane CTS suites against a CLI SUT with normalized output.
 *
 * The JSON read and written here is the cts.protocol.v1 control envelope. It is
 * not an AES interchange contract. AES tests that request the portable
 * projection set input.options.portable_aes and are forwarded to the SUT with
 * --portable-aes.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

function parseArgs(argv) {
  const out = { sut: '', cts: '', lane: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--sut' && i + 1 < argv.length) out.sut = argv[++i];
    else if (a === '--cts' && i + 1 < argv.length) out.cts = argv[++i];
    else if (a === '--lane' && i + 1 < argv.length) out.lane = argv[++i];
  }
  return out;
}

function fail(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(3);
}

function normalizeSpan(span) {
  if (!span || typeof span !== 'object') return null;
  const start = span.start?.offset;
  const end = span.end?.offset;
  if (typeof start !== 'number' || typeof end !== 'number') return null;
  return [start, end];
}

function normalizeDiagnostics(errors) {
  if (!Array.isArray(errors)) return [];
  return errors.map((e) => ({
    code: String(e?.code ?? ''),
    path: e?.path == null ? null : normalizePath(String(e.path)),
    phase: e?.phase ?? e?.phaseLabel ?? null,
    span: normalizeSpan(e?.span),
  }));
}

function normalizeCoreBindings(events) {
  if (!Array.isArray(events)) return [];
  const eventByPath = new Map(
    events
      .filter((e) => e && typeof e === 'object')
      .map((e) => [normalizePath(String(e?.path ?? '')), e]),
  );
  return events.filter((e) => !isLegacyNodeChildProjection(e, eventByPath)).map((e) => ({
    path: normalizePath(String(e?.path ?? '')),
    datatype: typeof e?.datatype === 'string' ? normalizeDatatype(e.datatype) : null,
    kind: 'binding',
  }));
}

function normalizeAesEvents(events) {
  if (!Array.isArray(events)) return [];
  const eventByPath = new Map(
    events
      .filter((e) => e && typeof e === 'object')
      .map((e) => [normalizePath(String(e?.path ?? '')), e]),
  );
  return events.filter((e) => !isLegacyNodeChildProjection(e, eventByPath)).map((e) => {
    const valueKind = typeof e?.kind === 'string'
      ? e.kind
      : typeof e?.value?.type === 'string'
        ? e.value.type
        : null;
    const reference = valueKind === 'CloneReference' || valueKind === 'PointerReference'
      ? typeof e?.value === 'string'
        ? normalizePath(e.value)
        : typeof e?.value?.path === 'string'
          ? normalizePath(e.value.path)
          : (e?.value?.path ?? null)
      : null;
    return {
      path: normalizePath(String(e?.path ?? '')),
      identity:
        typeof e?.identity === 'string'
          ? e.identity
          : typeof e?.structuralId === 'string'
            ? e.structuralId
            : typeof e?.structural_id === 'string'
              ? e.structural_id
              : null,
      datatype: typeof e?.datatype === 'string' ? normalizeDatatype(e.datatype) : null,
      value_kind: valueKind,
      reference,
    };
  });
}

function isLegacyNodeChildProjection(event, eventByPath) {
  if (typeof event?.kind === 'string') return false;
  const eventPath = normalizePath(String(event?.path ?? ''));
  const match = eventPath.match(/^(.*)\[(\d+)\]$/u);
  if (!match) return false;
  return eventByPath.get(match[1])?.value?.type === 'NodeLiteral';
}

function normalizePath(path) {
  let normalized = path.trim();
  normalized = normalized.replace(/\$\.\[/g, '$[');
  normalized = normalized.replace(/\[\$"([^"\\]*(?:\\.[^"\\]*)*)"\]/g, '["$1"]');
  normalized = normalized.replace(/\$\["([^"\\]*(?:\\.[^"\\]*)*)"\]/g, (_m, key) => {
    return isIdentifier(key) ? `$.${key}` : `$["${key}"]`;
  });
  normalized = normalized.replace(/\.\["([^"\\]*(?:\\.[^"\\]*)*)"\]/g, (_m, key) => {
    return isIdentifier(key) ? `.${key}` : `.["${key}"]`;
  });
  normalized = normalized.replace(/\[(\d+)\]/g, (_m, digits) => `[${String(Number(digits))}]`);
  return normalized;
}

function normalizeDatatype(value) {
  return String(value).replace(/\s+/gu, '');
}

function isIdentifier(value) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

function compareExpectedDiagnostics(expected, actual) {
  const failures = [];
  const used = new Set();
  for (const exp of expected ?? []) {
    const idx = actual.findIndex((a, i) => {
      if (used.has(i)) return false;
      if (String(a.code) !== String(exp.code)) return false;
      if ('path' in exp) {
        if ((a.path ?? null) !== (exp.path == null ? null : normalizePath(String(exp.path)))) return false;
      }
      if ('phase' in exp && exp.phase != null && (a.phase ?? null) !== exp.phase) return false;
      if ('phaseLabel' in exp && exp.phaseLabel != null && (a.phase ?? null) !== exp.phaseLabel) return false;
      return true;
    });
    if (idx < 0) {
      failures.push(`Missing expected diagnostic ${String(exp.code)} at ${String(exp.path)}`);
      continue;
    }
    used.add(idx);
    if (exp.span) {
      const got = actual[idx]?.span ?? null;
      if (!got || got[0] !== exp.span[0] || got[1] !== exp.span[1]) {
        failures.push(`Span mismatch for ${String(exp.code)} at ${String(exp.path)}`);
      }
    }
  }
  return failures;
}

function compareExpectedArray(expected, actual, label) {
  const failures = [];
  if (!Array.isArray(expected)) return failures;
  if (actual.length !== expected.length) {
    failures.push(`${label} length mismatch: expected ${expected.length}, got ${actual.length}`);
    return failures;
  }
  for (let i = 0; i < expected.length; i += 1) {
    const exp = expected[i];
    const got = actual[i];
    for (const k of Object.keys(exp)) {
      const ev = (k === 'path' || k === 'reference') && typeof exp[k] === 'string'
        ? normalizePath(exp[k])
        : exp[k];
      const gv = (k === 'path' || k === 'reference') && typeof got?.[k] === 'string'
        ? normalizePath(got[k])
        : k === 'datatype' && typeof got?.[k] === 'string'
          ? normalizeDatatype(got[k])
          : got?.[k];
      const normalizedExpected = k === 'datatype' && typeof ev === 'string'
        ? normalizeDatatype(ev)
        : ev;
      if (JSON.stringify(normalizedExpected) !== JSON.stringify(gv)) {
        failures.push(`${label}[${i}].${k} mismatch: expected ${JSON.stringify(normalizedExpected)}, got ${JSON.stringify(gv)}`);
      }
    }
  }
  return failures;
}

function mergeObjects(base, overlay) {
  if (!base || typeof base !== 'object' || Array.isArray(base)) return overlay;
  if (!overlay || typeof overlay !== 'object' || Array.isArray(overlay)) return overlay ?? base;
  const merged = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    merged[key] = key in merged ? mergeObjects(merged[key], value) : value;
  }
  return merged;
}

function renderAeonValue(value, indent = 0) {
  if (typeof value === 'string') return JSON.stringify(value);
  if (Number.isSafeInteger(value) && value >= 0) return String(value);
  if (Array.isArray(value)) {
    const padding = ' '.repeat(indent + 2);
    return `[\n${value.map((entry) => `${padding}${renderAeonValue(entry, indent + 2)}`).join('\n')}\n${' '.repeat(indent)}]`;
  }
  if (value && typeof value === 'object') {
    const padding = ' '.repeat(indent + 2);
    return `{\n${Object.entries(value).map(([key, entry]) => `${padding}${key} = ${renderAeonValue(entry, indent + 2)}`).join('\n')}\n${' '.repeat(indent)}}`;
  }
  fail(`Unsupported CTS limits value: ${JSON.stringify(value)}`);
}

function renderLimitsFile(limits) {
  return Object.entries(limits)
    .map(([key, value]) => `${key} = ${renderAeonValue(value)}`)
    .join('\n\n') + '\n';
}

async function runInspect({ sutPath, source, mode, datatypePolicy, rich, portableAes, maxAttributeDepth, maxSeparatorDepth, maxGenericDepth, maxEvents, limits }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aeon-cts-source-'));
  const file = path.join(dir, 'input.aeon');
  fs.writeFileSync(file, source, 'utf8');

  const isJs = sutPath.endsWith('.js') || sutPath.endsWith('.mjs') || sutPath.endsWith('.cjs');
  const command = isJs ? process.execPath : sutPath;
  const args = isJs ? [sutPath, 'inspect', file, '--json'] : ['inspect', file, '--json'];
  if (limits) {
    const limitsFile = path.join(dir, 'limits.aeon');
    fs.writeFileSync(limitsFile, renderLimitsFile(limits), 'utf8');
    args.push('--limits-file', limitsFile);
  }
  if (mode === 'transport') args.push('--transport');
  else if (mode === 'strict') args.push('--strict');
  if (rich) args.push('--rich');
  if (portableAes) args.push('--portable-aes');
  if (datatypePolicy) args.push('--datatype-policy', datatypePolicy);
  if (Number.isInteger(maxAttributeDepth)) args.push('--max-attribute-depth', String(maxAttributeDepth));
  if (Number.isInteger(maxSeparatorDepth)) args.push('--max-separator-depth', String(maxSeparatorDepth));
  if (Number.isInteger(maxGenericDepth)) args.push('--max-generic-depth', String(maxGenericDepth));
  if (Number.isInteger(maxEvents)) args.push('--max-events', String(maxEvents));

  const { stdout, stderr, code } = await new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const out = [];
    const err = [];
    child.stdout.on('data', (d) => out.push(Buffer.from(d)));
    child.stderr.on('data', (d) => err.push(Buffer.from(d)));
    child.on('close', (c) => resolve({ code: c, stdout: Buffer.concat(out).toString('utf8').trim(), stderr: Buffer.concat(err).toString('utf8') }));
  });

  fs.rmSync(dir, { recursive: true, force: true });

  try {
    return { ok: true, parse: JSON.parse(stdout), stderr, code };
  } catch {
    const inputLimit = stderr.match(/Input size (\d+) bytes exceeds configured limit(?: of)? (\d+) bytes/u);
    if (code !== 0 && inputLimit) {
      return {
        ok: true,
        parse: {
          events: [],
          errors: [{
            code: 'INPUT_SIZE_EXCEEDED',
            path: '$',
            message: inputLimit[0],
          }],
        },
        stderr,
        code,
      };
    }
    if (code !== 0) {
      return { ok: false, parse: null, stderr: `${stderr}\nSUT exited ${code} without valid JSON envelope`, code };
    }
    return { ok: false, parse: null, stderr: `${stderr}\nInvalid JSON: ${stdout}`, code };
  }
}

function loadManifest(ctsPath) {
  const full = path.resolve(process.cwd(), ctsPath);
  const manifest = JSON.parse(fs.readFileSync(full, 'utf8'));
  if (manifest?.meta?.sut_protocol !== 'cts.protocol.v1') {
    fail(`Manifest ${full} missing sut_protocol=cts.protocol.v1`);
  }
  return { full, manifest };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.sut || !args.cts || !args.lane) {
    fail('Usage: node scripts/cts-source-lane-runner.mjs --sut <path> --cts <manifest> --lane <core|aes>');
  }
  if (args.lane !== 'core' && args.lane !== 'aes' && args.lane !== 'canonical') {
    fail(`Unsupported lane: ${args.lane}`);
  }

  const { full: manifestPath, manifest } = loadManifest(args.cts);
  let pass = 0;
  let failCount = 0;
  console.log(`Running ${args.lane.toUpperCase()} CTS (protocol=${manifest.meta.sut_protocol}) against SUT: ${args.sut}`);

  for (const suiteRef of manifest.suites ?? []) {
    const suitePath = path.resolve(path.dirname(manifestPath), suiteRef.file);
    const suite = JSON.parse(fs.readFileSync(suitePath, 'utf8'));
    const excludedTests = new Set(Array.isArray(suiteRef.exclude_tests) ? suiteRef.exclude_tests : []);
    console.log(`\n--- Suite: ${suite.title} ---`);
    for (const test of suite.tests ?? []) {
      if (excludedTests.has(test.id)) continue;
      const source = String(test.input?.source ?? '');
      // input.mode describes the fixture's source-level expectation. Only the
      // explicit effective_mode option overrides the CLI's own mode resolution.
      const mode = typeof test.input?.options?.effective_mode === 'string'
        ? test.input.options.effective_mode
        : undefined;
      const datatypePolicy = test.input?.options?.datatype_policy;
      const rich = Boolean(test.input?.options?.rich);
      const portableAes = Boolean(test.input?.options?.portable_aes);
      const maxAttributeDepth = Number.isInteger(test.input?.options?.max_attribute_depth) ? test.input.options.max_attribute_depth : undefined;
      const maxSeparatorDepth = Number.isInteger(test.input?.options?.max_separator_depth) ? test.input.options.max_separator_depth : undefined;
      const maxGenericDepth = Number.isInteger(test.input?.options?.max_generic_depth) ? test.input.options.max_generic_depth : undefined;
      const maxEvents = Number.isInteger(test.input?.options?.max_events) ? test.input.options.max_events : undefined;
      const limits = test.input?.options?.limits === undefined
        ? undefined
        : mergeObjects(suite.meta?.limits_defaults, test.input.options.limits);
      let errors = [];
      let warnings = [];
      let ok = false;
      let result;

      if (args.lane === 'canonical') {
        const formatted = await runFmt({ sutPath: args.sut, source });
        if (!formatted.ok) {
          console.error(`❌ ${test.id}: harness failure`);
          if (formatted.stderr) console.error(formatted.stderr.trim());
          process.exit(3);
        }

        errors = normalizeGenericDiagnostics(formatted.errors);
        warnings = [];
        ok = errors.length === 0;
        result = {
          canonical_text: ok ? normalizeCanonicalText(formatted.stdout) : '',
        };
      } else {
        const inspect = await runInspect({
          sutPath: args.sut,
          source,
          mode,
          datatypePolicy: typeof datatypePolicy === 'string' ? datatypePolicy : undefined,
          rich,
          portableAes,
          maxAttributeDepth,
          maxSeparatorDepth,
          maxGenericDepth,
          maxEvents,
          limits,
        });
        if (!inspect.ok || !inspect.parse) {
          console.error(`❌ ${test.id}: harness failure`);
          if (inspect.stderr) console.error(inspect.stderr.trim());
          process.exit(3);
        }

        errors = normalizeDiagnostics(inspect.parse.errors);
        warnings = [];
        ok = errors.length === 0;
        result =
          args.lane === 'core'
            ? {
                parse_ok: ok,
                bindings: ok ? normalizeCoreBindings(inspect.parse.events) : [],
              }
            : {
                events: ok ? normalizeAesEvents(inspect.parse.events) : [],
              };
      }

      const failures = [];
      if (ok !== Boolean(test.expected?.ok)) {
        failures.push(`ok mismatch: expected ${Boolean(test.expected?.ok)}, got ${ok}`);
      }
      failures.push(...compareExpectedDiagnostics(test.expected?.errors ?? [], errors));
      failures.push(...compareExpectedDiagnostics(test.expected?.warnings ?? [], warnings));

      if (args.lane === 'core') {
        if (test.expected?.result && 'parse_ok' in test.expected.result) {
          if (Boolean(test.expected.result.parse_ok) !== result.parse_ok) {
            failures.push(`result.parse_ok mismatch: expected ${Boolean(test.expected.result.parse_ok)}, got ${result.parse_ok}`);
          }
        }
        failures.push(...compareExpectedArray(test.expected?.result?.bindings, result.bindings, 'bindings'));
      } else if (args.lane === 'canonical') {
        const expectedText = test.expected?.result?.canonical_text;
        if (typeof expectedText === 'string') {
          const normalizedExpected = normalizeCanonicalText(expectedText);
          if (normalizedExpected !== result.canonical_text) {
            failures.push(`canonical_text mismatch: expected ${JSON.stringify(normalizedExpected)}, got ${JSON.stringify(result.canonical_text)}`);
          }
        }
      } else {
        failures.push(...compareExpectedArray(test.expected?.result?.events, result.events, 'events'));
      }

      if (failures.length > 0) {
        failCount += 1;
        console.error(`❌ ${test.id}: FAIL`);
        for (const f of failures) console.error(`  - ${f}`);
      } else {
        pass += 1;
        console.log(`✅ ${test.id}: PASS`);
      }
    }
  }

  console.log(`\nSummary: pass=${pass} fail=${failCount}`);
  process.exit(failCount > 0 ? 1 : 0);
}

function normalizeGenericDiagnostics(errors) {
  if (!Array.isArray(errors)) return [];
  return errors.map((e) => ({
    code: e?.code == null ? '' : String(e.code),
    path: e?.path == null ? null : normalizePath(String(e.path)),
    phase: e?.phase ?? e?.phaseLabel ?? null,
    span: normalizeSpan(e?.span),
  }));
}

function normalizeCanonicalText(text) {
  return String(text).replace(/\r\n/g, '\n').replace(/\s+$/u, '');
}

function parseCliSpan(source, encodedSpan) {
  if (typeof encodedSpan !== 'string' || encodedSpan === '?:?-?:?') return null;
  const match = /^(\d+):(\d+)-(\d+):(\d+)$/u.exec(encodedSpan);
  if (!match) return null;

  const startLine = Number(match[1]);
  const startColumn = Number(match[2]);
  const endLine = Number(match[3]);
  const endColumn = Number(match[4]);
  const normalizedSource = String(source).replace(/\r\n/g, '\n');
  const lineStarts = [0];

  for (let i = 0; i < normalizedSource.length; i += 1) {
    if (normalizedSource[i] === '\n') {
      lineStarts.push(i + 1);
    }
  }

  function toOffset(line, column) {
    if (!Number.isInteger(line) || !Number.isInteger(column) || line < 1 || column < 1) return null;
    const lineStart = lineStarts[line - 1];
    if (lineStart == null) return null;
    return lineStart + column - 1;
  }

  const start = toOffset(startLine, startColumn);
  const end = toOffset(endLine, endColumn);
  if (start == null || end == null) return null;
  return [start, end];
}

async function runFmt({ sutPath, source }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aeon-cts-fmt-'));
  const file = path.join(dir, 'input.aeon');
  fs.writeFileSync(file, source, 'utf8');

  const isJs = sutPath.endsWith('.js') || sutPath.endsWith('.mjs') || sutPath.endsWith('.cjs');
  const command = isJs ? process.execPath : sutPath;
  const args = isJs ? [sutPath, 'fmt', file] : ['fmt', file];

  const { stdout, stderr, code } = await new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const out = [];
    const err = [];
    child.stdout.on('data', (d) => out.push(Buffer.from(d)));
    child.stderr.on('data', (d) => err.push(Buffer.from(d)));
    child.on('close', (c) => resolve({
      code: c,
      stdout: Buffer.concat(out).toString('utf8'),
      stderr: Buffer.concat(err).toString('utf8').trim(),
    }));
  });

  fs.rmSync(dir, { recursive: true, force: true });

  const errors = code === 0
    ? []
    : stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const match = /^(.*?)(?:\s+\[([A-Z0-9_]+)\])(?:\s+path=(\S+))?(?:\s+span=(\S+))?$/u.exec(line);
          return {
            code: match?.[2] ?? '',
            message: match?.[1]?.trim() ?? line,
            path: match?.[3] ?? '$',
            span: parseCliSpan(source, match?.[4]),
          };
        });

  return { ok: true, stdout, stderr, errors };
}

main().catch((err) => {
  fail(String(err));
});

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createConverter, loadCompiler, formats } from './convert.mjs';
import { cases } from '../examples/validate-and-query/cases.mjs';
import { createPipelineRunner } from './pipeline.mjs';

export function createPlaygroundServer(convert, { runPipeline = createPipelineRunner() } = {}) {
  const assets = new Map([
    ['/', ['public/index.html', 'text/html']],
    ['/favicon.svg', ['public/favicon.svg', 'image/svg+xml']],
    ['/examples.js', ['public/examples.js', 'text/javascript']],
    ['/app.js', ['public/app.js', 'text/javascript']],
    ['/pipeline.js', ['public/pipeline.js', 'text/javascript']],
    ['/editor-highlighting.js', ['public/editor-highlighting.js', 'text/javascript']],
    ['/source-highlighting.js', ['public/source-highlighting.js', 'text/javascript']],
    ['/result-highlighting.js', ['public/result-highlighting.js', 'text/javascript']],
    ['/style.css', ['public/style.css', 'text/css']],
    ['/highlighter.js', ['../../../web/highlighter/aeon-code-block/aeon-code-block.js', 'text/javascript']],
  ]);
  // Serve only the installed highlighter's browser dependency graph, never an
  // arbitrary node_modules path. Package versions remain pinned by the root lock.
  for (const [name, files] of [
    ['aeon-highlight', ['index.js', 'renderer.js', 'aeon-token-highlight.mjs', 'presentation-highlight.mjs']],
    ['aeon-lexer', ['index.js', 'lexer.js', 'tokens.js', 'errors.js']],
  ]) {
    const entry = import.meta.resolve(`@altopelago/${name}`);
    for (const file of files) assets.set(`/vendor/${name}/${file}`, [new URL(file, entry), 'text/javascript']);
  }
  return http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    const reply = (status, data) => { res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8'}); res.end(JSON.stringify(data)); };
    // No cross-origin requests or filesystem paths are accepted.
    const expectedHost = `127.0.0.1:${req.socket.localPort}`;
    if (req.headers.host !== expectedHost && req.headers.host !== `localhost:${req.socket.localPort}`) return reply(403, {error: 'Use the local playground URL.'});
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return reply(403, {error: 'Cross-origin requests are not allowed.'});
    if (req.url === '/api/formats' && req.method === 'GET') return reply(200, {formats});
    if (req.url === '/api/pipeline/examples' && req.method === 'GET') return reply(200, {examples: cases});
    if (['/api/convert', '/api/pipeline'].includes(req.url) && req.method === 'POST') {
      if (!req.headers['content-type']?.startsWith('application/json')) return reply(415, {error: 'Expected JSON request.'});
      try {
        const chunks = []; let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 2_097_152) { reply(413, {error: 'Input is too large (1 MiB source limit).'}); req.resume(); return; }
          chunks.push(chunk);
        }
        const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (typeof input?.source !== 'string' || Buffer.byteLength(input.source) > 1_048_576) return reply(413, {error: 'Source must be text up to 1 MiB.'});
        reply(200, req.url === '/api/pipeline' ? await runPipeline(input) : convert(input));
      } catch (error) {
        reply(422, {error: error.message, code: error.code ?? 'CONVERSION_ERROR', path: error.path, line: error.line, column: error.column});
      }
      return;
    }
    if (req.method !== 'GET' || !assets.has(req.url)) return reply(404, {error: 'Not found'});
    try {
      const [path, type] = assets.get(req.url);
      let content = await readFile(new URL(path, import.meta.url));
      if (type === 'text/javascript') {
        // Browser ESM has no Node package resolution. Keep relative imports and
        // replace the two known bare imports with same-origin allowlisted URLs.
        content = content.toString('utf8');
        for (const name of ['aeon-highlight', 'aeon-lexer']) {
          for (const quote of ["'", '"']) content = content.replaceAll(
            `from ${quote}@altopelago/${name}${quote}`,
            `from ${quote}/vendor/${name}/index.js${quote}`);
        }
      }
      res.writeHead(200, {'Content-Type': `${type}; charset=utf-8`}); res.end(content);
    } catch { reply(500, {error: 'Unable to load playground asset.'}); }
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const convert = createConverter(await loadCompiler());
    const port = Number(process.env.PORT ?? 4317);
    const server = createPlaygroundServer(convert);
    server.on('error', error => { console.error(error.message); process.exitCode = 1; });
    server.listen(port, '127.0.0.1', () => console.log(`Adapter playground: http://127.0.0.1:${server.address().port}`));
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

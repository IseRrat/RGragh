import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash, timingSafeEqual, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';
import { createStore } from './mysql-store.mjs';
import { validateDocument } from './document.mjs';
import { readPaperPdf, savePaperPdf } from './pdf-files.mjs';
import { modelConfiguration } from './paper-analyzer.mjs';
import { runPaperImport, undoPaperPlacement } from './paper-import.mjs';
import { aiEnvironment, setRuntimeAiConfig } from './ai-config.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 4173);
const password = process.env.APP_PASSWORD;
const username = process.env.APP_USER || 'map';
if (!password && !['127.0.0.1', 'localhost', '::1'].includes(host)) {
  throw new Error('公开监听必须设置 APP_PASSWORD');
}
const store = await createStore();
let importQueue = Promise.resolve();
function enqueueImport(id) {
  importQueue = importQueue.catch(() => {}).then(async () => {
    await store.updateImport(id, 'processing');
    await runPaperImport(store, id);
  }).catch(async (error) => {
    console.error('Paper import:', error);
    await store.updateImport(id, 'failed', null, error.message).catch(console.error);
  });
}
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

function json(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  response.end(JSON.stringify(body));
}
function authorized(request) {
  if (!password) return true;
  const header = request.headers.authorization || '';
  if (!header.startsWith('Basic ')) return false;
  let supplied;
  try { supplied = Buffer.from(header.slice(6), 'base64').toString('utf8'); }
  catch { return false; }
  const a = createHash('sha256').update(supplied).digest();
  const b = createHash('sha256').update(`${username}:${password}`).digest();
  return timingSafeEqual(a, b);
}
async function readJson(request) {
  const chunks = []; let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 3_000_000) throw Object.assign(new Error('请求超过 3 MB'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('JSON 格式错误'), { status: 400 }); }
}

const server = createServer(async (request, response) => {
  try {
    if (!authorized(request)) {
      response.writeHead(401, { 'www-authenticate': 'Basic realm="RGragh", charset="UTF-8"' });
      response.end('Authentication required');
      return;
    }
    const pathname = new URL(request.url, `http://${request.headers.host || 'localhost'}`).pathname;
    if (pathname === '/api/ai') {
      if (request.method === 'GET') {
        try { const config = modelConfiguration(aiEnvironment()); return json(response, 200, { configured: true, provider: config.provider, model: config.model }); }
        catch { return json(response, 200, { configured: false, provider: aiEnvironment().AI_PROVIDER || 'deepseek' }); }
      }
      if (request.method === 'POST') {
        const body = await readJson(request);
        setRuntimeAiConfig(body);
        const config = modelConfiguration(aiEnvironment());
        return json(response, 200, { configured: true, provider: config.provider, model: config.model });
      }
      return json(response, 405, { error: '不支持此方法' });
    }
    if (pathname === '/api/imports') {
      if (request.method === 'GET') return json(response, 200, { imports: await store.listImports() });
      if (request.method === 'POST') {
        modelConfiguration(aiEnvironment());
        let filename = 'paper.pdf';
        try { filename = decodeURIComponent(String(request.headers['x-file-name'] || filename)).slice(0, 255); } catch { /* Keep default. */ }
        const id = randomUUID();
        await savePaperPdf(id, request);
        await store.createImport(id, filename);
        enqueueImport(id);
        return json(response, 202, { id, status: 'queued' });
      }
      return json(response, 405, { error: '不支持此方法' });
    }
    const importAction = /^\/api\/imports\/([\w-]{1,80})\/(retry|undo)$/.exec(pathname);
    if (importAction) {
      if (request.method !== 'POST') return json(response, 405, { error: '不支持此方法' });
      const job = await store.getImport(importAction[1]);
      if (!job) return json(response, 404, { error: '导入记录不存在' });
      if (importAction[2] === 'retry') {
        if (job.status !== 'failed') return json(response, 409, { error: '只有失败的导入可以重试' });
        modelConfiguration(aiEnvironment());
        await store.updateImport(job.id, 'queued');
        enqueueImport(job.id);
        return json(response, 202, { id: job.id, status: 'queued' });
      }
      return json(response, 200, await undoPaperPlacement(store, job));
    }
    if (pathname === '/api/map') {
      if (request.method === 'GET') return json(response, 200, await store.read());
      if (request.method === 'PUT') {
        const body = await readJson(request);
        if (!body || !Number.isSafeInteger(body.revision) || body.revision < 0) return json(response, 400, { error: '版本号不合法' });
        const document = validateDocument(body.document);
        const result = await store.write(document, body.revision);
        return json(response, result.conflict ? 409 : 200, result.conflict ? result : { ...result, document });
      }
      return json(response, 405, { error: '不支持此方法' });
    }
    const paperPdf = /^\/api\/papers\/([\w-]{1,80})\/pdf$/.exec(pathname);
    if (paperPdf) {
      // The server-wide authorization guard above also protects this private PDF route.
      if (!authorized(request)) return json(response, 401, { error: '需要登录' });
      const paperId = paperPdf[1];
      if (request.method === 'PUT') {
        const current = await store.read();
        if (!current.document?.papers?.some((paper) => paper.id === paperId)) return json(response, 404, { error: '论文不存在' });
        return json(response, 200, await savePaperPdf(paperId, request));
      }
      if (request.method === 'GET' || request.method === 'HEAD') {
        const data = await readPaperPdf(paperId);
        response.writeHead(200, { 'content-type': 'application/pdf', 'content-length': data.length, 'content-disposition': 'inline', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
        return response.end(request.method === 'HEAD' ? undefined : data);
      }
      return json(response, 405, { error: '不支持此方法' });
    }
    if (!['GET', 'HEAD'].includes(request.method)) return json(response, 405, { error: '不支持此方法' });
    const path = pathname === '/' ? '/index.html' : pathname;
    const clean = normalize(path).replace(/^[/\\]+/, '');
    if (clean.startsWith('..') || clean.includes('..\\') || clean.includes('../')) return json(response, 403, { error: '禁止访问' });
    const file = join(root, clean);
    const data = await readFile(file);
    response.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    response.end(request.method === 'HEAD' ? undefined : data);
  } catch (error) {
    const status = error.status || (error.code === 'ENOENT' ? 404 : error.message.includes('节点') || error.message.includes('地图') || error.message.includes('父节点') ? 400 : 500);
    if (status === 500) console.error(error);
    json(response, status, { error: status === 500 ? '服务器暂时无法处理请求' : error.message });
  }
});
server.listen(port, host, () => console.log(`RGragh: http://${host}:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => store.close().finally(() => process.exit(0))));

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Store, AppError } from './store.js';
import { Workflow } from './workflow.js';
import { Fish } from './fish/service.js';
import { handleFishApi } from './fish/api.js';
import { startFishDaemon } from './fish/daemon.js';
import { ManualVerification } from './verification.js';
import { dataRoot, isIsh, platformInfo } from './platform.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const ASSETS = new Map([['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']], ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  // iSH / iOS 适配层（Minis 添加）
  ['/ios.css', ['ios.css', 'text/css; charset=utf-8']],
  ['/manifest.webmanifest', ['manifest.webmanifest', 'application/manifest+json; charset=utf-8']],
  ['/icon.svg', ['icon.svg', 'image/svg+xml; charset=utf-8']]]);
function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}
async function readBody(req) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new AppError('请求必须使用 JSON', 415);
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 128 * 1024) throw new AppError('请求过大', 413);
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch { throw new AppError('JSON 格式错误'); }
}
// 演示版跳「正式版」用的端口；iSH 单实例默认不提供（0 = 不提供）。
const livePort = () => Number(process.env.XHS_WHALE_LIVE_PORT || 0) || null;

export async function startServer({ port = 18061, demo = false, dataDir, host, clients, verificationOptions = {} } = {}) {
  // iSH：数据默认落到 /var/minis/shared（项目目录可能被清理），见 lib/platform.js
  const dir = dataDir || dataRoot(demo);
  const store = new Store(dir);
  const workflow = new Workflow(store, { demo, clients });
  const verification = new ManualVerification({ workflow, serviceDir: path.join(ROOT, 'data', 'xhs-service'), ...verificationOptions });
  // 养鱼只在正式版存在：演示版连真实账号都没有，谈"自己刷"没有意义。
  const fish = demo ? null : new Fish({ dataDir: dir, workflow });
  const daemon = fish ? startFishDaemon(fish, { log: m => console.log(m) }) : null;
  const csrf = randomBytes(32).toString('hex');
  let origin;
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; manifest-src 'self'; img-src 'self' data: https://*.xhscdn.com https://*.xiaohongshu.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const expectedHost = new URL(origin).host;
      // iSH 里 Shell 容器的回环只在容器内部可见：App 自带浏览器访问时必须走 en0 局域网地址，
      // 因此 iSH 下额外允许"本机 IP + 监听端口"直连（仍只接受"本机"这一台设备）。
      const lanHosts = isIsh() ? Object.values(os.networkInterfaces()).flat().filter(Boolean)
        .filter(n => !n.internal && n.family === 'IPv4').map(n => `${n.address}:${port}`) : [];
      if (![...lanHosts, expectedHost].includes(req.headers.host) ||
          !['127.0.0.1', '::ffff:127.0.0.1', '::1'].includes(req.socket.remoteAddress)) {
        throw new AppError('只允许本机访问', 403);
      }
      if ((req.headers.origin && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site') {
        throw new AppError('不允许跨站请求', 403);
      }
      const url = new URL(req.url, origin);
      if (ASSETS.has(url.pathname) && req.method === 'GET') {
        const [file, type] = ASSETS.get(url.pathname);
        res.writeHead(200, { 'Content-Type': type }); res.end(fs.readFileSync(path.join(ROOT, 'public', file))); return;
      }
      if (url.pathname === '/api/session' && req.method === 'GET') {
        json(res, 200, { csrf, demo, version: '0.2.0' }); return;
      }
      if (url.pathname === '/health' && req.method === 'GET') {
        json(res, 200, { ok: true, app: 'dsh-xhs-whale', demo, dataDir: dir }); return;
      }
      // 注意：/api/platform 必须在 CSRF 校验之后（它会带出数据目录与上游服务地址）。
      const supplied = String(req.headers['x-xhs-csrf'] || '');
      if (supplied.length !== csrf.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(csrf))) {
        throw new AppError('页面会话已失效，请刷新页面', 403);
      }
      if (url.pathname.startsWith('/api/fish')) {
        // 养鱼的读取可能真的去开一次浏览器（收件箱/刷一轮），比普通接口慢得多；
        // 请求体与超时都在这里单独处理，超时时间在 listen 之后统一放宽。
        // 只解析真正的 JSON 体：像 selftest 这种"POST 但没有参数"的请求不该被 415 挡掉。
        let body = {};
        if (req.method === 'POST' && String(req.headers['content-type'] || '').startsWith('application/json')) {
          body = await readBody(req);
        }
        json(res, 200, await handleFishApi({
          fish, method: req.method, pathname: url.pathname, query: url.searchParams, body,
        }));
        return;
      }
      if (url.pathname === '/api/platform' && req.method === 'GET') {
        json(res, 200, await platformInfo(Number(new URL(store.state.config.xhsUrl).port || 18060)), livePort()); return;
      }
      if (req.method === 'GET' && url.pathname === '/api/state') {
        // livePort：演示版跳「正式版」的端口，未提供时前端隐藏该链接。
        json(res, 200, { ...workflow.snapshot(), livePort: livePort(), verificationWindow: verification.status() }); return;
      }
      const exportMatch = url.pathname.match(/^\/api\/runs\/([a-f0-9-]+)\/export$/);
      if (req.method === 'GET' && exportMatch) {
        res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': 'attachment; filename="xhs-reading.md"' });
        res.end(workflow.exportMarkdown(exportMatch[1])); return;
      }
      if (req.method !== 'POST') throw new AppError('未找到接口', 404);
      const b = await readBody(req);
      let result;
      if (url.pathname === '/api/verification/open') result = await verification.open();
      else if (url.pathname === '/api/verification/complete') result = await verification.complete(b);
      else if (url.pathname === '/api/verification/close') { await verification.close(); result = { ok: true }; }
      else if (url.pathname === '/api/settings') {
        if (workflow.busy) throw new AppError('请等待当前操作结束后再修改连接设置', 409);
        result = store.saveSettings(b);
      } else if (url.pathname === '/api/login') result = await workflow.exclusive(() => workflow.clients().xhs.login());
      else if (url.pathname === '/api/qrcode') result = await workflow.exclusive(() => workflow.clients().xhs.qrcode());
      else if (url.pathname === '/api/model/test') result = await workflow.exclusive(() => workflow.clients().model.test());
      else if (url.pathname === '/api/runs') result = workflow.start(b);
      else if (url.pathname === '/api/runs/cancel') result = workflow.cancel(b.id);
      else if (url.pathname === '/api/drafts') result = await workflow.draft(b);
      else if (url.pathname === '/api/drafts/edit') result = workflow.editDraft(b.id, b);
      else if (url.pathname === '/api/drafts/reject') result = workflow.reject(b.id);
      else if (url.pathname === '/api/drafts/send') result = await workflow.send(b.id, b);
      else if (url.pathname === '/api/drafts/resolve') result = workflow.resolve(b.id, b);
      else throw new AppError('未找到接口', 404);
      json(res, 200, result);
    } catch (error) {
      if (!res.headersSent) json(res, error instanceof AppError ? error.status : 500,
        { error: error instanceof AppError ? error.message : '操作未完成，请检查配置后重试。',
          ...(error.code === 'XHS_VERIFICATION_REQUIRED' ? { code: error.code } : {}) });
      else res.end();
    }
  });
  // 养鱼的一次"刷一轮"或"扫收件箱"可能跑好几分钟：默认 5 分钟的请求超时会把它腰斩。
  server.requestTimeout = 600_000;
  server.headersTimeout = 65_000;
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host || '127.0.0.1', resolve); });
  } catch (e) { store.close(); throw e; }
  origin = `http://127.0.0.1:${server.address().port}`;
  const close = async () => {
    daemon?.stop();
    await verification.close();
    if (workflow.activeRun) workflow.cancel(workflow.activeRun);
    await new Promise(resolve => server.close(resolve));
    if (workflow.task) await workflow.task;
    store.close();
  };
  return { server, store, workflow, fish, dataDir: dir, url: origin, close };
}

#!/usr/bin/env node
// iSH / iOS 启动入口：node tools/ish.mjs [--demo|--live] [--port 18061] [--host 0.0.0.0] [--open]
// 与原项目的 tools/xhs.mjs 等价，但默认按 iOS 环境选数据目录、打印局域网地址、可自愈残留锁。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { startServer } from '../lib/server.js';
import { dataRoot, isIsh, platformInfo } from '../lib/platform.js';

const args = process.argv.slice(2);
const flag = name => args.includes(name);
const value = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

function lanAddresses() {
  try {
    return Object.values(os.networkInterfaces()).flat().filter(Boolean)
      .filter(n => !n.internal && n.family === 'IPv4').map(n => n.address);
  } catch { return []; }
}

/** 上次异常退出（Ctrl+C 之外）会留下 instance.lock，iSH 里进程号常常被复用，直接清掉更省事。 */
function clearStaleLock(dir) {
  try {
    const lock = path.join(dir, 'instance.lock');
    if (!fs.existsSync(lock)) return;
    const pid = Number(fs.readFileSync(lock, 'utf8'));
    let alive = false;
    try { process.kill(pid, 0); alive = true; } catch {}
    // 同一进程号活着但明显不是本程序（iSH pid 复用）时也清掉；只有确认为 node 时才保留。
    if (alive) {
      try { fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes('node'); } catch { alive = false; }
    }
    if (!alive) { fs.unlinkSync(lock); console.log(`已清理残留锁：${lock}`); }
  } catch {}
}

const demo = flag('--demo') || (!flag('--live') && isIsh());
const port = Number(value('--port', demo ? 18062 : 18061));
const host = value('--host', isIsh() ? '0.0.0.0' : '127.0.0.1');
const dir = dataRoot(demo, value('--data-dir', ''));

if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  console.error('端口应为 1024～65535'); process.exit(1);
}
clearStaleLock(dir);

const app = await startServer({ port, demo, dataDir: dir, host });
const lines = [
  `小鲸鱼 · 小红书阅读助手${demo ? '（演示模式）' : ''}已启动`,
  `本机：http://127.0.0.1:${port}`,
];
if (host === '0.0.0.0') for (const ip of lanAddresses()) lines.push(`局域网 / App 浏览器：http://${ip}:${port}`);
lines.push(`数据目录：${dir}`);
if (!demo) {
  const info = await platformInfo(Number(new URL(app.store.state.config.xhsUrl).port || 18060));
  lines.push(info.service.reachable
    ? `小红书服务：${info.service.url} 可达（${info.service.ms}ms）`
    : `小红书服务：${info.service.url} 不可达 —— iSH 内无法本地运行 Chromium 版服务，抓取/发送会失败；先试 --demo。`);
}
lines.push('按 Ctrl+C 停止。发送默认关闭。');
console.log(lines.join('\n'));

if (flag('--open')) {
  const url = `http://127.0.0.1:${port}`;
  const opener = process.platform === 'darwin' ? 'open' : isIsh() ? 'minis-open' : 'xdg-open';
  try { spawn(opener, [url], { stdio: 'ignore', detached: true }).unref(); } catch {}
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => { await app.close(); process.exit(0); });
}

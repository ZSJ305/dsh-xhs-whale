#!/usr/bin/env node
// 生成 vendor/checked-build.json —— 原项目由 PowerShell 脚本产出，
// 由 Windows 启动器用来核对服务二进制没有被替换过；这里改成跨平台版本，供 CI 与本地共用。
// 用法：node tools/build-manifest.mjs <binariesDir> > <binariesDir>/checked-build.json
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const dir = path.resolve(process.argv[2] || 'vendor');
const versionFile = new URL('../upstream/xiaohongshu-mcp/browser/browser_version.txt', import.meta.url);
const browserVersion = fs.existsSync(versionFile) ? fs.readFileSync(versionFile, 'utf8').trim() : null;

const files = {};
if (fs.existsSync(dir)) {
  for (const name of fs.readdirSync(dir).sort()) {
    if (name.endsWith('.json') || name.endsWith('.txt') || name.endsWith('.sha256')) continue;
    const full = path.join(dir, name);
    if (!fs.statSync(full).isFile()) continue;
    const hash = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
    files[name] = { sha256: hash, bytes: fs.statSync(full).size };
  }
}

// Windows 启动器只认 sha256 顶层字段 + 固定文件名，保留向后兼容。
const winKey = Object.keys(files).find(n => n === 'xiaohongshu-mcp-checked.exe')
  || Object.keys(files).find(n => /windows.*\.exe$/i.test(n));

process.stdout.write(`${JSON.stringify({
  upstream: 'v2.5.5',
  checked: true,
  browserVersion,
  sha256: winKey ? files[winKey].sha256 : null,
  builtAt: new Date().toISOString(),
  files,
}, null, 2)}\n`);

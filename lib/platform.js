// iSH / iOS 适配层（由 Minis 添加；原项目面向 Windows x64）。
// 只做"环境判定 + 路径归位 + 能力探测"，不改变任何业务逻辑。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));

/** iSH 里 process.platform 是 'linux'，但打不开 Chromium；用容器特征判断。 */
export function isIsh() {
  if (process.env.XHS_WHALE_PLATFORM === 'ish') return true;
  try { return fs.existsSync('/proc/ish') || fs.existsSync('/ish') || !!process.env.ISH; } catch { return false; }
}

export function isWindows() { return process.platform === 'win32'; }

/**
 * 数据目录：
 *  - Windows：项目内 data/（原行为）
 *  - iSH：默认 /var/minis/shared/xhs-whale/data，可用 XHS_WHALE_DATA_DIR 覆盖
 *    （项目目录在 Minis 里可能被清理，放到 shared 才留得住）
 */
export function dataRoot(demo, explicit) {
  if (explicit) return path.resolve(explicit);
  if (process.env.XHS_WHALE_DATA_DIR) return path.resolve(process.env.XHS_WHALE_DATA_DIR);
  if (!isWindows() && isIsh()) return path.join('/var/minis/shared/xhs-whale/data', demo ? 'demo' : 'live');
  return path.join(ROOT, 'data', demo ? 'demo' : 'live');
}

/**
 * 小红书服务（xiaohongshu-mcp）探测。
 * 原项目在 Windows 上靠 PowerShell 脚本安装/启动一个内置 Chromium 的 Go 服务；
 * iSH 没有 Chromium、也编不了 Go 服务，所以这里只能：
 *   1) 连一个已经在跑的本机服务（例如桌面电脑/另一台设备），或
 *   2) 通过 XHS_WHALE_EXTERNAL_URL 指定局域网地址（安全原因需显式设置）。
 */
export function serviceCandidates(port = 18060) {
  const list = [`http://127.0.0.1:${port}`];
  if (process.env.XHS_WHALE_EXTERNAL_URL) list.push(process.env.XHS_WHALE_EXTERNAL_URL.replace(/\/$/, ''));
  return list;
}

export async function probeService(base, timeout = 2500) {
  const started = Date.now();
  try {
    const res = await fetch(`${base}/api/v1/login/status`, { signal: AbortSignal.timeout(timeout) });
    return { url: base, reachable: true, status: res.status, ms: Date.now() - started };
  } catch (e) {
    return { url: base, reachable: false, error: e.name === 'TimeoutError' ? 'timeout' : String(e.message || e), ms: Date.now() - started };
  }
}

export async function platformInfo(port = 18060) {
  const probes = await Promise.all(serviceCandidates(port).map(u => probeService(u)));
  const service = probes.find(p => p.reachable) || probes[0];
  return {
    platform: isWindows() ? 'windows' : isIsh() ? 'ish' : process.platform,
    ish: isIsh(),
    node: process.version,
    arch: process.arch,
    cpus: os.cpus()?.length ?? 0,
    dataRoot: dataRoot(false),
    service,
    // 浏览器自动化服务在 iSH 上不可能本地运行：用 Apple 浏览器/手动验证代替。
    localBrowserAutomation: isWindows(),
    hint: isWindows() ? '' : 'iSH 内无 Chromium，小红书抓取/发送需要外部 xiaohongshu-mcp 服务；演示模式不依赖它。',
  };
}

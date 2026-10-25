# iSH / iOS 魔改说明（Minis 添加）

原项目面向 **Windows x64**：靠 PowerShell 脚本下载一个内置 Chromium 的 Go 服务（`upstream/xiaohongshu-mcp`，用 Rod 驱动浏览器）。
iSH 里没有 Chromium、也编不出那个 Go 服务，所以这次魔改分成三层：**能在 iSH 跑起来 → 用起来像 iOS 应用 → 说清楚什么做不到**。

## 一键使用

```sh
cd dsh-xhs-whale-main
sh start-ish.sh            # 演示模式（默认，不需要小红书服务）
sh start-ish.sh --live     # 正式模式（需要外部 xiaohongshu-mcp 可达）
sh start-ish.sh --status   # 查看运行状态与地址
sh start-ish.sh --stop     # 停止
```

打开终端里打印的 `http://127.0.0.1:18062`。想加到主屏幕：Safari 分享 →「添加到主屏幕」，会以独立窗口全屏运行。

## 改了什么

| 文件 | 改动 |
| --- | --- |
| `lib/platform.js` | 新增。判定 iSH 环境、数据目录归位、上游服务探活 |
| `lib/time.js` | 新增。iSH 的 Node 是**裁剪版 ICU**，`Intl` 不认 `Asia/Shanghai`（会输出 `10/25/2026`），这里用固定 +08:00 兜底 |
| `lib/server.js` | 数据目录默认 `/var/minis/shared/xhs-whale/data`；新增 `GET /api/platform`；`livePort` 透传；**把 `/api/platform` 移到 CSRF 校验之后**（原先任何网页都能跨站读到本机数据目录与服务地址） |
| `lib/store.js`、`lib/fish/clock.js`、`tools/fish.mjs` | 时区格式化改走 `lib/time.js`（养鱼的「今天」和作息窗口不再错乱） |
| `tools/ish.mjs` | 新增。iOS 启动入口：默认演示模式、自动清残留锁、打印可达地址 |
| `start-ish.sh` | 新增。一键启动/停止/状态，端口占用自动顺延 |
| `public/ios.css` | 新增。安全区、中文系统字体、44px 触控、16px 输入框（防 iOS 聚焦缩放）、竖屏 iPad 两列、手机单列、横屏矮视口压缩 |
| `public/index.html` | `viewport-fit=cover`、PWA meta、`manifest`、`ios.css` |
| `public/manifest.webmanifest`、`public/icon.svg` | 新增。可「添加到主屏幕」的独立窗口 |
| `public/app.js` | iSH 下显示平台提示条（原「打开正式版」链接会 404，改为按 `livePort` 决定）+ 设置页提示文案随平台切换 |

## 做不到的部分（不是 bug）

- **小红书抓取 / 评论 / 点赞**：必须由 `xiaohongshu-mcp` 驱动真实 Chromium，iSH 无法运行。
  唯一可行的用法是"工作台在 iSH，抓取服务在另一台电脑"：在「连接设置」把服务地址改成那台电脑的
  `http://<局域网IP>:18060`（`lib/store.js` 的校验只接受回环地址，需要这台电脑做反向代理，
  或把 `XHS_WHALE_EXTERNAL_URL` 用起来并放宽校验）。
- **养鱼的自动叫醒**：`lib/scheduler.js` 依赖 DSH 宿主的 `sessionController`，在工作台进程里不存在；
  iSH 的后台调度也不能保证（App 被挂起就停）。养鱼页的读写仍可手工触发。
- **人工验证窗口**：`lib/verification.js` 找的是 Windows 的 `chrome.exe`，iSH 上不可用。

## 回归

```sh
node --test test/*.test.js   # 112 项，iSH 上全绿（含两个依赖时区格式化的用例）
```

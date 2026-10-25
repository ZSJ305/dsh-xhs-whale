#!/bin/sh
# 小鲸鱼 · 小红书阅读助手 —— iSH / iOS 一键启动
# 用法：
#   sh start-ish.sh            # 演示模式（推荐，不需要小红书服务）
#   sh start-ish.sh --live     # 正式模式（需要外部 xiaohongshu-mcp 服务可达）
#   sh start-ish.sh --stop     # 停止本脚本启动的实例
#   sh start-ish.sh --status   # 查看是否在跑、地址是什么
set -u
cd "$(dirname "$0")" || exit 1

PORT_DEFAULT=18062
LOG="${TMPDIR:-/tmp}/xhs-whale.log"
PIDFILE="${TMPDIR:-/tmp}/xhs-whale.pid"

find_pid() {
  # iSH 的 ps 不可靠：直接扫 /proc 找本项目的启动进程
  for d in /proc/[0-9]*; do
    p=${d#/proc/}
    c=$(tr '\0' ' ' < "$d/cmdline" 2>/dev/null) || continue
    case "$c" in *tools/ish.mjs*) echo "$p"; return 0;; esac
  done
  return 1
}

lan_ip() {
  ip -4 addr 2>/dev/null | awk '/inet / && $2 !~ /^127\./ { sub(/\/.*/, "", $2); print $2; exit }'
}

case "${1:-}" in
  --stop)
    p=$(find_pid) || { echo "没有在跑的实例"; exit 0; }
    for x in $p; do kill -9 "$x" 2>/dev/null; done
    rm -f "$PIDFILE"; echo "已停止"; exit 0;;
  --status)
    p=$(find_pid) || { echo "未运行"; exit 1; }
    echo "运行中 pid=$p"; tail -6 "$LOG" 2>/dev/null; exit 0;;
esac

command -v node >/dev/null 2>&1 || { echo "缺少 Node.js（iSH：apk add nodejs）"; exit 1; }
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 22 ] || { echo "需要 Node.js 22+，当前 $(node -v)"; exit 1; }

if p=$(find_pid); then
  echo "已有实例在运行（pid=$p），先停止：sh start-ish.sh --stop"
  exit 0
fi

PORT=${PORT:-$PORT_DEFAULT}
# 端口被别的东西占着就往后找一个（iSH 下没有 lsof，用 /proc/net/tcp 判断足够）
if grep -qi ":$(printf '%04X' "$PORT") " /proc/net/tcp 2>/dev/null; then
  i=1; while [ $i -lt 20 ]; do
    p=$((PORT_DEFAULT + i))
    grep -qi ":$(printf '%04X' "$p") " /proc/net/tcp 2>/dev/null || { PORT=$p; break; }
    i=$((i + 1))
  done
fi

nohup node tools/ish.mjs --port "$PORT" "$@" > "$LOG" 2>&1 &
echo $! > "$PIDFILE"

i=0
while [ $i -lt 40 ]; do
  sleep 1
  if grep -q "已启动" "$LOG" 2>/dev/null; then break; fi
  find_pid >/dev/null 2>&1 || break
  i=$((i + 1))
done

sed -n '1,12p' "$LOG"
IP=$(lan_ip)
echo ""
echo "──────────────────────────────"
echo " 本机地址：     http://127.0.0.1:$PORT"
[ -n "$IP" ] && echo " App 浏览器：  http://$IP:$PORT"
echo " 数据目录：    ${XHS_WHALE_DATA_DIR:-/var/minis/shared/xhs-whale/data}"
echo " 日志：        $LOG"
echo " 停止：        sh start-ish.sh --stop"
echo "──────────────────────────────"

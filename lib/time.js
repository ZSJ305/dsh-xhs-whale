// iSH / iOS 适配（Minis 添加）：iSH 版 Node 的 ICU 是裁剪过的，
// `Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' })` 在这里只会返回 "10/25/2026"，
// 而且不认 TZ 环境变量。养鱼的"今天""作息分钟数"全靠它，所以这里给一个固定 +08:00 的实现兜底。
const SHANGHAI_OFFSET_MIN = 8 * 60;

function intlWorks() {
  try {
    const probe = new Date('2026-01-01T00:00:00Z');
    return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(probe) === '2026-01-01';
  } catch { return false; }
}

const INTL_OK = intlWorks();

/** 上海时区的 "YYYY-MM-DD"（与原来 Intl 的 sv-SE 输出格式一致）。 */
export function shanghaiDay(value = new Date()) {
  const iso = value instanceof Date ? value.toISOString() : String(value);
  if (INTL_OK) {
    try { return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date(iso)); } catch {}
  }
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) throw new Error('无效时间');
  return new Date(t + SHANGHAI_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
}

/** 上海时区的一天中的分钟数（0–1439），用于作息窗口判定。 */
export function shanghaiMinutes(value = new Date()) {
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  const shifted = new Date(t + SHANGHAI_OFFSET_MIN * 60_000);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

/** 上海时区的 "HH:MM"。 */
export function shanghaiHM(value = new Date()) {
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  const shifted = new Date(t + SHANGHAI_OFFSET_MIN * 60_000);
  return shifted.toISOString().slice(11, 16);
}

export const intlTimezoneSupported = INTL_OK;

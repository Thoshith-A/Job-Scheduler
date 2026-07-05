/** Formatting helpers used across panels. All pure, SSR-safe. */

export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diff = now - then;
  const abs = Math.abs(diff);
  const suffix = diff >= 0 ? "ago" : "from now";

  const sec = Math.round(abs / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ${suffix}`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ${suffix}`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ${suffix}`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ${suffix}`;
  const mo = Math.round(day / 30);
  if (mo < 12) return `${mo}mo ${suffix}`;
  return `${Math.round(mo / 12)}y ${suffix}`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 2 : 1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return `${m}m ${rem}s`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat().format(n);
}

export function formatPercent(fraction: number): string {
  return `${(fraction * 100).toFixed(fraction >= 0.1 || fraction === 0 ? 0 : 1)}%`;
}

export function pluralize(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Build a slug candidate from a display name. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

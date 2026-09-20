export const DEFAULT_ACCENT = "#7c3aed";

export const ACCENT_PRESETS = [
  "#7c3aed",
  "#4f46e5",
  "#2563eb",
  "#0284c7",
  "#0891b2",
  "#059669",
  "#65a30d",
  "#ca8a04",
  "#ea580c",
  "#dc2626",
  "#db2777",
  "#c026d3",
] as const;

const STORAGE_KEY = "zfm.accent";

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const v = m[1];
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

/** Darken a hex color by factor f (0..1). */
function shade(hex: string, f: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const [r, g, b] = rgb.map((c) => Math.max(0, Math.min(255, Math.round(c * f))));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

export function loadAccent(): string {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && hexToRgb(raw)) return raw.toLowerCase();
  } catch {
    // Storage unavailable — fall back to the default.
  }
  return DEFAULT_ACCENT;
}

export function saveAccent(hex: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, hex.toLowerCase());
  } catch {
    // Storage unavailable — the color still applies for this session.
  }
}

export function applyAccent(hex: string): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const b = hex.toLowerCase() === DEFAULT_ACCENT ? "#4f46e5" : shade(hex, 0.72);
  root.style.setProperty("--accent-a", hex);
  root.style.setProperty("--accent-b", b);
  root.style.setProperty("--accent-fill", hex);
}

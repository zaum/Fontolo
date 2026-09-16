

import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import type { FontFace as ZFontFace } from "./ipc";

type LoadState = "loading" | "loaded" | "failed";
interface CacheEntry {
  state: LoadState;
  failedAt?: number;
  lastUsed?: number;
}
const cache = new Map<string, CacheEntry>();
const listeners = new Map<string, Set<() => void>>();

// Bound memory: scrolling a big library loads hundreds of webfonts and they
// used to stay in `document.fonts` forever. Evict the least-recently-used.
const FONT_CACHE_MAX = 200;

// A font can briefly fail while it is being written (install/activate);
// keep the failure so cards render fast, but let a later view retry it.
const FAILED_RETRY_MS = 30_000;

function touch(name: string): void {
  const entry = cache.get(name);
  if (!entry) return;
  entry.lastUsed = Date.now();
  // Re-insert so iteration order stays recency-ordered for eviction below.
  cache.delete(name);
  cache.set(name, entry);
}

function getState(name: string): LoadState | undefined {
  const entry = cache.get(name);
  if (!entry) return undefined;
  if (entry.state === "failed" && entry.failedAt !== undefined) {
    if (Date.now() - entry.failedAt > FAILED_RETRY_MS) {
      cache.delete(name);
      return undefined;
    }
  }
  if (entry.state === "loaded") touch(name);
  return entry.state;
}

function cssName(face: ZFontFace): string {

  return `zfm-${hash(face.id)}`;
}

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function evictIfNeeded(): void {
  while (cache.size > FONT_CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    const entry = cache.get(oldest);
    cache.delete(oldest);
    // Release the webfont so the browser can free its glyph raster cache.
    if (entry?.state === "loaded") {
      const css = oldest;
      for (const ff of document.fonts) {
        if (ff.family === css) {
          document.fonts.delete(ff);
          break;
        }
      }
    }
  }
}

function ensureLoaded(face: ZFontFace): void {
  const name = cssName(face);
  if (getState(name) !== undefined) return;
  cache.set(name, { state: "loading", lastUsed: Date.now() });
  evictIfNeeded();

  const url = convertFileSrc(face.previewPath ?? face.path);
  const ff = new FontFace(name, `url("${url}")`);
  ff.load()
    .then(() => {
      document.fonts.add(ff);
      cache.set(name, { state: "loaded", lastUsed: Date.now() });
    })
    .catch(() => {
      cache.set(name, { state: "failed", failedAt: Date.now() });
    })
    .finally(() => {
      listeners.get(name)?.forEach((fn) => fn());
      listeners.delete(name);
    });
}

export function useFontCss(face: ZFontFace | null): {
  fontFamily: string | null;
  failed: boolean;
} {
  const name = face ? cssName(face) : null;
  const [, bump] = useState(0);

  useEffect(() => {
    if (!face || !name) return;
    ensureLoaded(face);
    if (getState(name) === "loading") {
      const set = listeners.get(name) ?? new Set();
      const fn = () => bump((n) => n + 1);
      set.add(fn);
      listeners.set(name, set);
      return () => {
        set.delete(fn);
      };
    }
  }, [face, name]);

  const state = name ? getState(name) : undefined;
  return {
    fontFamily: state === "loaded" && name ? name : null,
    failed: state === "failed",
  };
}

export function loadFaceCss(face: ZFontFace): Promise<string> {
  const name = cssName(face);
  ensureLoaded(face);
  const state = getState(name);
  if (state === "loaded") return Promise.resolve(name);
  if (state === "failed") return Promise.reject(new Error("font failed to load"));
  return new Promise((resolve, reject) => {
    const set = listeners.get(name) ?? new Set();
    set.add(() => {
      if (getState(name) === "loaded") resolve(name);
      else reject(new Error("font failed to load"));
    });
    listeners.set(name, set);
  });
}

export function pathBasename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}



import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import type { FontFace as ZFontFace, GooglePreviewFile } from "./ipc";

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
    // Release the webfont so the browser can free its glyph raster cache. One
    // family can consist of several faces (one per Unicode range), so all of
    // them have to go.
    if (entry?.state === "loaded") {
      const css = oldest;
      for (const ff of [...document.fonts]) {
        if (ff.family === css) document.fonts.delete(ff);
      }
    }
  }
}

/** One file of a preview: a cached web font and the ranges it covers. */
export interface PreviewSource {
  url: string;
  unicodeRange?: string;
}

/**
 * Registers one family from a list of files. Several files under the same name
 * is exactly how a webfont family works: each carries its own `unicode-range`,
 * so ASCII comes from the `latin` cut while Hungarian accented letters come
 * from `latin-ext`. Loading only one of them would show tofu boxes.
 */
function ensureSources(name: string, sources: PreviewSource[]): void {
  if (sources.length === 0) return;
  if (getState(name) !== undefined) return;
  cache.set(name, { state: "loading", lastUsed: Date.now() });
  evictIfNeeded();

  const faces = sources.map((source) => {
    const descriptors = source.unicodeRange ? { unicodeRange: source.unicodeRange } : undefined;
    return new FontFace(name, `url("${source.url}")`, descriptors);
  });
  Promise.all(faces.map((face) => face.load()))
    .then((loaded) => {
      for (const face of loaded) document.fonts.add(face);
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

function ensureLoaded(face: ZFontFace): void {
  const name = cssName(face);
  ensureSources(name, [{ url: convertFileSrc(face.previewPath ?? face.path) }]);
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

// --- Google Fonts previews -------------------------------------------------

/** The CSS family name a Google style is registered under. */
export function googleFaceName(family: string, style: string): string {
  return `zfm-google-${hash(`${family}|${style}`)}`;
}

/**
 * Loads the cached web fonts of one Google style. `files` is what the store
 * fetched for this style; until they arrive nothing is registered, and once
 * they do the family renders with the Unicode ranges the provider declares.
 */
export function useGoogleFaceCss(
  family: string,
  style: string,
  files: GooglePreviewFile[] | null,
): { fontFamily: string | null; failed: boolean } {
  const name = googleFaceName(family, style);
  const [, bump] = useState(0);

  useEffect(() => {
    if (!files || files.length === 0) return;
    ensureSources(
      name,
      files.map((file) => ({
        url: convertFileSrc(file.path),
        unicodeRange: file.unicodeRange,
      })),
    );
    if (getState(name) === "loading") {
      const set = listeners.get(name) ?? new Set();
      const fn = () => bump((n) => n + 1);
      set.add(fn);
      listeners.set(name, set);
      return () => {
        set.delete(fn);
      };
    }
  }, [name, files]);

  const state = getState(name);
  return {
    fontFamily: state === "loaded" ? name : null,
    failed: state === "failed",
  };
}

/** Drops a cached Google preview, so the next render fetches it again. */
export function forgetGoogleFace(family: string, style: string): void {
  const name = googleFaceName(family, style);
  cache.delete(name);
  for (const ff of [...document.fonts]) {
    if (ff.family === name) document.fonts.delete(ff);
  }
}



import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import type { FontFace as ZFontFace, GooglePreviewFile } from "./ipc";

type LoadState = "loading" | "loaded" | "failed";
interface CacheEntry {
  state: LoadState;
  failedAt?: number;
  lastUsed?: number;
  /** Identity token used to ignore a load that was evicted while in flight. */
  loadId: number;
  /** Exact browser faces registered for this entry, so eviction is cheap. */
  faces?: FontFace[];
}
const cache = new Map<string, CacheEntry>();
const listeners = new Map<string, Set<() => void>>();
let nextLoadId = 0;
let previewEnabled = false;
const previewGateListeners = new Set<() => void>();

/** Keep preview font I/O off the critical path while the library is scanning. */
export function setFontPreviewEnabled(enabled: boolean): void {
  if (previewEnabled === enabled) return;
  previewEnabled = enabled;
  for (const listener of previewGateListeners) listener();
}

function listenForPreviewGate(listener: () => void): () => void {
  previewGateListeners.add(listener);
  return () => previewGateListeners.delete(listener);
}

function schedulePreviewLoad(load: () => void): () => void {
  // Yield the initial card paint, but do not wait for requestIdleCallback: a
  // busy renderer can postpone that callback for seconds and make previews
  // appear broken while the user scrolls.
  const id = window.setTimeout(load, 40);
  return () => window.clearTimeout(id);
}

// Bound memory: scrolling a big library loads hundreds of webfonts and they
// used to stay in `document.fonts` forever. Evict the least-recently-used.
// A browser font is much more expensive than its file size: Chromium also
// keeps decoded tables and glyph caches. Keeping 200 families could therefore
// consume several GB, especially with CJK and variable fonts.
// This covers the visible rows plus the grid's small overscan without making
// mounted cards evict each other in a load/re-render loop.
const FONT_CACHE_MAX = 16;
const MAX_CONCURRENT_LOADS = 4;
// Loading a full desktop CJK/variable font into Chromium can expand a 20–80 MB
// file into hundreds of MB of renderer memory. Large fonts need a generated
// preview asset; never decode the original file automatically in a card.
const MAX_LOCAL_AUTO_PREVIEW_BYTES = 8 * 1024 * 1024;
let activeLoads = 0;
const loadQueue: Array<() => void> = [];

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

function notify(name: string): void {
  listeners.get(name)?.forEach((fn) => fn());
  listeners.delete(name);
}

function removeEntry(name: string, entry: CacheEntry): void {
  cache.delete(name);
  for (const face of entry.faces ?? []) document.fonts.delete(face);
  // Wake imperative callers as well as hooks. They can retry if the entry is
  // still needed, instead of waiting forever for an evicted in-flight load.
  notify(name);
}

function enqueueLoad(load: () => Promise<void>): void {
  const start = () => {
    activeLoads += 1;
    void load().finally(() => {
      activeLoads -= 1;
      loadQueue.shift()?.();
    });
  };
  if (activeLoads < MAX_CONCURRENT_LOADS) start();
  else loadQueue.push(start);
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
    if (entry) removeEntry(oldest, entry);
    else cache.delete(oldest);
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
  const entry: CacheEntry = {
    state: "loading",
    lastUsed: Date.now(),
    loadId: ++nextLoadId,
  };
  cache.set(name, entry);
  evictIfNeeded();

  enqueueLoad(async () => {
    // The card may have scrolled out and the entry may have been evicted while
    // this job waited in the bounded queue. In that case never decode it.
    if (cache.get(name)?.loadId !== entry.loadId) return;
    const faces = sources.map((source) => {
      const descriptors = source.unicodeRange ? { unicodeRange: source.unicodeRange } : undefined;
      return new FontFace(name, `url("${source.url}")`, descriptors);
    });
    try {
      const loaded = await Promise.all(faces.map((face) => face.load()));
      // An older implementation unconditionally registered completed loads.
      // That resurrected entries evicted during fast scrolling and bypassed
      // the cache limit. Only the still-current generation may be installed.
      if (cache.get(name)?.loadId !== entry.loadId) return;
      for (const face of loaded) document.fonts.add(face);
      entry.state = "loaded";
      entry.lastUsed = Date.now();
      entry.faces = loaded;
      touch(name);
      evictIfNeeded();
    } catch {
      if (cache.get(name)?.loadId !== entry.loadId) return;
      entry.state = "failed";
      entry.failedAt = Date.now();
    } finally {
      if (cache.get(name)?.loadId === entry.loadId) notify(name);
    }
  });
}

function ensureLoaded(face: ZFontFace): void {
  const name = cssName(face);
  ensureSources(name, [{ url: convertFileSrc(face.previewPath ?? face.path) }]);
}

function localPreviewTooLarge(face: ZFontFace): boolean {
  return face.previewPath === null && face.fileSize > MAX_LOCAL_AUTO_PREVIEW_BYTES;
}

export function useFontCss(face: ZFontFace | null): {
  fontFamily: string | null;
  failed: boolean;
} {
  const name = face ? cssName(face) : null;
  const [gateVersion, bump] = useState(0);

  useEffect(() => {
    if (!face || !name) return;
    if (localPreviewTooLarge(face)) return;
    if (!previewEnabled) return listenForPreviewGate(() => bump((n) => n + 1));
    let stop: (() => void) | undefined;
    const load = () => {
      ensureLoaded(face);
      if (getState(name) !== "loading") return;
      const set = listeners.get(name) ?? new Set();
      const fn = () => bump((n) => n + 1);
      set.add(fn);
      listeners.set(name, set);
      stop = () => set.delete(fn);
    };
    const cancel = schedulePreviewLoad(load);
    return () => {
      cancel();
      stop?.();
    };
  }, [face, name, gateVersion]);

  const tooLarge = face ? localPreviewTooLarge(face) : false;
  const state = previewEnabled && name && !tooLarge ? getState(name) : undefined;
  return {
    fontFamily: state === "loaded" && name ? name : null,
    failed: tooLarge || state === "failed",
  };
}

export function loadFaceCss(face: ZFontFace): Promise<string> {
  if (localPreviewTooLarge(face)) {
    return Promise.reject(new Error("font is too large for an automatic browser preview"));
  }
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
  const [gateVersion, bump] = useState(0);

  useEffect(() => {
    if (!files || files.length === 0) return;
    if (!previewEnabled) return listenForPreviewGate(() => bump((n) => n + 1));
    let stop: (() => void) | undefined;
    const load = () => {
      ensureSources(
        name,
        files.map((file) => ({
          url: convertFileSrc(file.path),
          unicodeRange: file.unicodeRange,
        })),
      );
      if (getState(name) !== "loading") return;
      const set = listeners.get(name) ?? new Set();
      const fn = () => bump((n) => n + 1);
      set.add(fn);
      listeners.set(name, set);
      stop = () => set.delete(fn);
    };
    const cancel = schedulePreviewLoad(load);
    return () => {
      cancel();
      stop?.();
    };
  }, [name, files, gateVersion]);

  const state = previewEnabled ? getState(name) : undefined;
  return {
    fontFamily: state === "loaded" ? name : null,
    failed: state === "failed",
  };
}

/** Drops a cached Google preview, so the next render fetches it again. */
export function forgetGoogleFace(family: string, style: string): void {
  const name = googleFaceName(family, style);
  const entry = cache.get(name);
  if (entry) removeEntry(name, entry);
}

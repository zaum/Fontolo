

import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { ipc } from "./ipc";
import type { FacePreviewAsset, FontFace as ZFontFace, GooglePreviewFile } from "./ipc";

type LoadState = "loading" | "loaded" | "failed";
interface CacheEntry {
  state: LoadState;
  failedAt?: number;
  lastUsed?: number;
  /** Identity token used to ignore a load that was evicted while in flight. */
  loadId: number;
  /** Estimated renderer cost of this preview, so the cache can stay bounded. */
  bytes?: number;
  /** Exact browser faces registered for this entry, so eviction is cheap. */
  faces?: FontFace[];
}
const cache = new Map<string, CacheEntry>();
/** Total estimated cost of what the cache holds. The entry limit alone is not
 * enough now that one entry can be a 20 MB CJK face: dozens of those would be
 * hundreds of megabytes decoded in the renderer. Visible previews stay pinned,
 * so the ceiling only decides how much *extra* warm-up is worth keeping. */
let cacheBytes = 0;
const listeners = new Map<string, Set<() => void>>();
const visiblePreviewNames = new Set<string>();
/** Previews mounted on screen right now, ref-counted: the card's lead preview
 * and an expanded style row can mount the same face twice. A mounted preview
 * must never be evicted — evicting it either loops load → evict → reload
 * (flicker) or leaves the sample silently rendered in the fallback font. */
const mountedPreviewNames = new Map<string, number>();
/** Mounted hooks stay subscribed for their whole lifetime: a later eviction
 * or a retried failure has to repaint the sample, not leave it stale. The
 * one-shot `listeners` above are for promise callers only. */
const previewSubscribers = new Map<string, Set<() => void>>();
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
  // Run after the card's first paint without adding an artificial delay to a
  // newly visible preview. The bounded queue still limits concurrent decodes.
  const id = window.setTimeout(load, 0);
  return () => window.clearTimeout(id);
}

// Bound memory: scrolling a big library loads hundreds of webfonts and they
// used to stay in `document.fonts` forever. Evict the least-recently-used.
// A browser font is much more expensive than its file size: Chromium also
// keeps decoded tables and glyph caches. Keeping 200 families could therefore
// consume several GB, especially with CJK and variable fonts.
// Keep a larger warm window for a stopped list, while the byte ceiling below
// remains the authority for large CJK and variable faces.
const FONT_CACHE_MAX = 48;
// A generated preview asset holds one face, so a collection — the big ones are
// CJK system fonts — can be previewed without handing the whole file to the
// renderer. Combined with the entry limit above, this keeps the browser font
// cache proportionate: a couple of large faces stay warm, and nothing else.
const FONT_CACHE_BYTES = 192 * 1024 * 1024;

const MAX_CONCURRENT_LOADS = 4;
// Loading a full desktop CJK/variable font into Chromium can expand a 20–80 MB
// file into hundreds of MB of renderer memory, so a large local file is only
// decoded when a generated preview asset stands in for it. `previewPath` is
// exactly that: the backend writes one face of a collection out as a standalone
// font, and the size check below deliberately only applies without one.
const MAX_LOCAL_AUTO_PREVIEW_BYTES = 8 * 1024 * 1024;
let activeLoads = 0;
const loadQueue: Array<{ name: string; start: () => void }> = [];

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
      dropEntry(name);
      return undefined;
    }
  }
  if (entry.state === "loaded") touch(name);
  return entry.state;
}

/** Forgets a cache entry and gives its estimated cost back to the budget. */
function dropEntry(name: string): void {
  const entry = cache.get(name);
  if (!entry) return;
  cacheBytes -= entry.bytes ?? 0;
  cache.delete(name);
}

function notify(name: string): void {
  listeners.get(name)?.forEach((fn) => fn());
  listeners.delete(name);
  previewSubscribers.get(name)?.forEach((fn) => fn());
}

/** Pins a mounted preview against eviction until the returned release runs. */
function pinPreview(name: string): () => void {
  mountedPreviewNames.set(name, (mountedPreviewNames.get(name) ?? 0) + 1);
  return () => {
    const remaining = (mountedPreviewNames.get(name) ?? 1) - 1;
    if (remaining <= 0) mountedPreviewNames.delete(name);
    else mountedPreviewNames.set(name, remaining);
  };
}

/** Wakes a mounted hook on every state change of its preview entry. */
function subscribePreview(name: string, fn: () => void): () => void {
  const set = previewSubscribers.get(name) ?? new Set();
  set.add(fn);
  previewSubscribers.set(name, set);
  return () => {
    set.delete(fn);
    if (set.size === 0) previewSubscribers.delete(name);
  };
}

function isPreviewPinned(name: string): boolean {
  return visiblePreviewNames.has(name) || mountedPreviewNames.has(name);
}

function removeEntry(name: string, entry: CacheEntry): void {
  dropEntry(name);
  for (const face of entry.faces ?? []) document.fonts.delete(face);
  // Wake imperative callers as well as hooks. They can retry if the entry is
  // still needed, instead of waiting forever for an evicted in-flight load.
  notify(name);
}

function prioritizeLoad(name: string): void {
  const index = loadQueue.findIndex((job) => job.name === name);
  if (index < 0) return;
  const [job] = loadQueue.splice(index, 1);
  loadQueue.unshift(job);
}

function enqueueLoad(name: string, load: () => Promise<void>, priority = false): void {
  const start = () => {
    activeLoads += 1;
    void load().finally(() => {
      activeLoads -= 1;
      loadQueue.shift()?.start();
    });
  };
  if (activeLoads < MAX_CONCURRENT_LOADS) start();
  // A card that is now on screen must be next in line, ahead of the lookahead
  // window queued for a scroll position the user has already passed.
  else if (priority) loadQueue.unshift({ name, start });
  else loadQueue.push({ name, start });
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
  // Two limits, one decision: an entry count for the many small families and a
  // byte ceiling for the few large ones. Pinned (visible) previews are never
  // evicted, even when they alone exceed the ceiling — a card on screen must
  // not fall back to the browser font while it is being looked at.
  while (cache.size > FONT_CACHE_MAX || cacheBytes > FONT_CACHE_BYTES) {
    const oldest = [...cache.keys()].find((name) => !isPreviewPinned(name));
    if (oldest === undefined) break;
    const entry = cache.get(oldest);
    if (entry) removeEntry(oldest, entry);
    else dropEntry(oldest);
  }
}

/** One file of a preview: a cached web font and the ranges it covers. `bytes` is
 * what decoding it costs the renderer; sources that do not report it fall back
 * to the entry's estimate. */
export interface PreviewSource {
  url: string;
  unicodeRange?: string;
  bytes?: number;
}

/**
 * Registers one family from a list of files. Several files under the same name
 * is exactly how a webfont family works: each carries its own `unicode-range`,
 * so ASCII comes from the `latin` cut while Hungarian accented letters come
 * from `latin-ext`. Loading only one of them would show tofu boxes.
 *
 * `loadSources` resolves the files to register; a collection face asks the
 * backend for its generated single-face asset here, which is why resolving is
 * part of the load instead of happening before it. `bytes` is the estimated
 * renderer cost of the preview, used only to keep the cache inside its budget.
 * Resolving to nothing marks the entry failed, exactly like a font that cannot
 * be decoded.
 */
function ensureSources(
  name: string,
  loadSources: () => Promise<PreviewSource[]>,
  bytes: number,
  priority = true,
): void {
  const state = getState(name);
  if (state !== undefined) {
    if (state === "loading" && priority) prioritizeLoad(name);
    return;
  }
  const entry: CacheEntry = {
    state: "loading",
    lastUsed: Date.now(),
    loadId: ++nextLoadId,
    bytes,
  };
  cache.set(name, entry);
  cacheBytes += bytes;
  evictIfNeeded();

  enqueueLoad(name, async () => {
    try {
      // The card may have scrolled out and the entry may have been evicted
      // while this job waited in the bounded queue. In that case never
      // decode it.
      if (cache.get(name)?.loadId !== entry.loadId) return;
      const sources = await loadSources();
      // Resolving can take a moment — the backend may have to write a 20 MB
      // single-face font first — so re-check who is waiting for this entry.
      if (cache.get(name)?.loadId !== entry.loadId) return;
      if (sources.length === 0) {
        entry.state = "failed";
        entry.failedAt = Date.now();
        return;
      }
      // A resolved source reports its real cost; update what this entry holds
      // against the budget to it.
      const resolved = sources.reduce((sum, source) => sum + (source.bytes ?? 0), 0);
      if (resolved > 0) {
        cacheBytes += resolved - (entry.bytes ?? 0);
        entry.bytes = resolved;
      }
      const faces = sources.map((source) => {
        const descriptors = source.unicodeRange ? { unicodeRange: source.unicodeRange } : undefined;
        return new FontFace(name, `url("${source.url}")`, descriptors);
      });
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
  }, priority);
}

function ensureLoaded(face: ZFontFace, priority = true): void {
  // The estimate reserves budget until the resolved sources report their real
  // cost back; for a collection that is the whole file up front, replaced by
  // the single generated face a moment later.
  ensureSources(cssName(face), () => localSources(face), face.fileSize, priority);
}

/** How a local face reaches the renderer. A collection is always served from a
 * generated asset — the webview would decode the collection's first face and
 * every card would show those glyphs — while anything else uses its own file
 * unless it is too large for the renderer to survive. */
function previewSource(face: ZFontFace): "file" | "asset" | "none" {
  if (face.previewPath) return "file";
  if (face.isCollection) return "asset";
  return face.fileSize > MAX_LOCAL_AUTO_PREVIEW_BYTES ? "none" : "file";
}

/** An unavailable face is exactly what the old size rule kept out of the
 * renderer: too large, and no generated asset exists to stand in for it. */
function localPreviewTooLarge(face: ZFontFace): boolean {
  return previewSource(face) === "none";
}

/** The files a local face previews with, or an empty list when none of them can
 * be decoded safely. A generated asset carries its own size, so the budget
 * counts the single face instead of the whole collection. */
async function localSources(face: ZFontFace): Promise<PreviewSource[]> {
  const kind = previewSource(face);
  if (kind === "none") return [];
  if (kind === "file") return [{ url: convertFileSrc(face.previewPath ?? face.path) }];
  const asset = await previewAssetFor(face);
  if (asset) return [{ url: convertFileSrc(asset.path), bytes: asset.bytes }];
  // The backend refused the face — too large to write out. A collection small
  // enough for the renderer still previews from its own file; it would show
  // the first face's glyphs, but that beats no preview at all.
  if (face.fileSize <= MAX_LOCAL_AUTO_PREVIEW_BYTES) return [{ url: convertFileSrc(face.path) }];
  return [];
}

/** The generated asset of one collection face, requested once and remembered.
 * Failures are remembered too: a font the backend cannot serve must not be
 * asked for again on every card render. */
function previewAssetFor(face: ZFontFace): Promise<FacePreviewAsset | null> {
  const key = `${face.path}\u0000${face.faceIndex}`;
  let pending = assetRequests.get(key);
  if (!pending) {
    pending = ipc
      .facePreviewAsset(face.path, face.faceIndex)
      .catch(() => null)
      .finally(() => {
        // Keep the answer; the request bookkeeping itself can go.
        window.setTimeout(() => assetRequests.delete(key), 30_000);
      });
    assetRequests.set(key, pending);
  }
  return pending;
}
const assetRequests = new Map<string, Promise<FacePreviewAsset | null>>();

/** Warm a small lookahead window. Visible card loads jump ahead of this work. */
export function preloadFaces(faces: ZFontFace[]): void {
  if (!previewEnabled) return;
  for (const face of faces) {
    if (face.source !== "google" && !localPreviewTooLarge(face)) {
      // Starting the asynchronous FontFace request immediately prevents a
      // continuously moving scroll from repeatedly resetting a debounce timer.
      ensureLoaded(face, false);
    }
  }
}

/** Keep the currently rendered cards in the browser font cache. Preloading
 * neighbouring rows may be discarded first, but a visible card must never
 * fall back to the browser default while it remains on screen. */
export function setVisiblePreviewFaces(faces: ZFontFace[]): void {
  visiblePreviewNames.clear();
  for (const face of faces) {
    if (face.source !== "google" && !localPreviewTooLarge(face)) {
      visiblePreviewNames.add(cssName(face));
      prioritizeLoad(cssName(face));
    }
  }
  evictIfNeeded();
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
    // Pin for the mount's lifetime: an expanded style row is on screen, so the
    // cache must never evict its font from under the visible sample.
    const unpin = pinPreview(name);
    // Subscribe for the mount's lifetime too — a later eviction or retry has
    // to repaint this sample, not leave it showing the fallback font.
    const unsubscribe = subscribePreview(name, () => bump((n) => n + 1));
    const cancel = schedulePreviewLoad(() => ensureLoaded(face));
    return () => {
      unpin();
      unsubscribe();
      cancel();
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
    const unpin = pinPreview(name);
    const unsubscribe = subscribePreview(name, () => bump((n) => n + 1));
    const cancel = schedulePreviewLoad(() => {
      ensureSources(
        name,
        // Web font cuts are a few tens of KB each; the byte budget only has to
        // stay honest, not exact.
        () => Promise.resolve(files.map((file) => ({ url: convertFileSrc(file.path), unicodeRange: file.unicodeRange }))),
        files.length * 64 * 1024,
      );
    });
    return () => {
      unpin();
      unsubscribe();
      cancel();
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

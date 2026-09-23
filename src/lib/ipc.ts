import { invoke } from "@tauri-apps/api/core";

export type FontFormat = "otf" | "ttf" | "woff" | "woff2" | "unknown";
export type FontSource = "system" | "user" | "managed" | "google";
export type Classification = "serif" | "sans" | "mono" | "display" | "script" | "unknown";

export interface VariationAxis {
  tag: string;
  min: number;
  default: number;
  max: number;
}

/** A generated single-face preview file and its size, which is what the
 * frontend's preview cache is budgeted against. */
export interface FacePreviewAsset {
  path: string;
  bytes: number;
}

export interface FontFace {
  id: string;
  path: string;

  previewPath: string | null;
  /** Several faces in one file; such a face needs a generated asset to preview. */
  isCollection: boolean;
  faceIndex: number;
  family: string;
  style: string;
  postscriptName: string | null;
  foundry: string | null;
  designers: string[];
  category: string | null;
  license: string | null;
  licenseUrl: string | null;
  format: FontFormat;
  isVariable: boolean;
  axes: VariationAxis[];
  weight: number;
  italic: boolean;
  monospaced: boolean;
  classification: Classification;
  scripts: string[];
  fileSize: number;
  source: FontSource;
  deactivatable: boolean;
  active: boolean;
}

export interface TrashEntry {
  id: string;
  originalPath: string;
  trashedPath: string;
  family: string;
  trashedAt: number;
}

export interface InstallResult {
  installed: FontFace[];
  errors: string[];
  duplicates: string[];
}

export interface ScanProgress {
  done: number;
  total: number;
  families: number;
}

export interface GoogleFontsProgress {
  phase: "checking" | "ready";
  done: number;
  total: number;
  family: string | null;
  /** Families the last catalogue refresh added. */
  downloaded: number;
  failed: number;
  error: string | null;
}

/** One family of the Google Fonts catalogue. Metadata only — no font file. */
export interface GoogleFamily {
  family: string;
  category: string | null;
  designers: string[];
  subsets: string[];
  axes: unknown[];
  lastModified: string | null;
}

/** A desktop style of a family. `key` is what the backend takes back. */
export interface GoogleStyle {
  key: string;
  label: string;
  weight: number;
  italic: boolean;
  postscript?: string | null;
  fileName?: string | null;
}

export interface GoogleFamilyInfo {
  family: string;
  license: string | null;
  styles: GoogleStyle[];
}

/** A cached web font, and the Unicode ranges it is responsible for. */
export interface GooglePreviewFile {
  path: string;
  unicodeRange: string;
}

export interface GoogleInstallResult {
  faces: FontFace[];
  installed: string[];
  errors: string[];
}

export interface InstallProgress {
  file: string;
  done: number;
  total: number;
  ok: boolean;
  error: string | null;
}

export type AdobeApp = "photoshop" | "illustrator";

export interface AppSettings {
  extraDirs: string[];
  watchEnabled: boolean;
  autoActivateImports: boolean;
  libraryDir: string | null;
  libraryDirEnabled: boolean;
  affinityEnabled: boolean;
  affinityDeactivateOnQuit: boolean;
  googleFontsEnabled: boolean;
  glyphSize: number;
  swapActivationButtons: boolean;
}

export interface AffinityConnection {
  reachable: boolean;
  version: string | null;
  docCount: number;
  error: string | null;
}

export type InstallMode = "link" | "move";

export const ipc = {
  getSettings: () => invoke<AppSettings>("get_settings"),
  setSettings: (settings: AppSettings) => invoke<void>("set_settings", { settings }),
  defaultLibraryDir: () => invoke<string>("default_library_dir"),
  affinityConnection: () => invoke<AffinityConnection>("affinity_connection"),
  affinitySessionActivate: (paths: string[]) =>
    invoke<string[]>("affinity_session_activate", { paths }),
  scanFonts: () => invoke<FontFace[]>("scan_fonts"),
  initialFonts: () => invoke<FontFace[]>("initial_fonts"),
  peekFonts: () => invoke<FontFace[] | null>("peek_fonts"),
  // May be stale (files added since the cache was written are missing), so it
  // is only a first paint: a real scan always follows and replaces it.
  warmFonts: () => invoke<FontFace[] | null>("warm_fonts"),
  setFontActive: (path: string, active: boolean) =>
    invoke<void>("set_font_active", { path, active }),
  setFontsActive: (paths: string[], active: boolean) =>
    invoke<void>("set_fonts_active", { paths, active }),
  setFontsActiveSession: (paths: string[]) =>
    invoke<void>("set_fonts_active_session", { paths }),
  installFonts: (paths: string[], existing: string[], mode: InstallMode) =>
    invoke<InstallResult>("install_fonts", { paths, existing, mode }),
  uninstallFont: (path: string, family: string) =>
    invoke<TrashEntry>("uninstall_font", { path, family }),
  listTrash: () => invoke<TrashEntry[]>("list_trash"),
  restoreFromTrash: (entryId: string) => invoke<void>("restore_from_trash", { entryId }),
  deleteTrashEntry: (entryId: string) => invoke<void>("delete_trash_entry", { entryId }),
  emptyTrash: () => invoke<void>("empty_trash"),
  getTags: () => invoke<Record<string, string[]>>("get_tags"),
  getProtectedTags: () => invoke<string[]>("get_protected_tags"),
  setTags: (family: string, tags: string[]) => invoke<void>("set_tags", { family, tags }),
  getFavorites: () => invoke<string[]>("get_favorites"),
  getNotes: () => invoke<Record<string, string>>("get_notes"),
  setNote: (family: string, note: string) => invoke<void>("set_note", { family, note }),
  setFavorite: (family: string, favorite: boolean) =>
    invoke<void>("set_favorite", { family, favorite }),
  getCharset: (path: string, faceIndex: number) =>
    invoke<number[]>("get_charset", { path, faceIndex }),
  // Only collections get an asset; a plain font previews its own file, so the
  // answer is a single fast read of its header.
  facePreviewAsset: (path: string, faceIndex: number) =>
    invoke<FacePreviewAsset | null>("face_preview_asset", { path, faceIndex }),
  getFeatures: (path: string, faceIndex: number) =>
    invoke<string[]>("get_features", { path, faceIndex }),
  readTextFile: (path: string) => invoke<string>("read_text_file", { path }),
  writeBinaryFile: (path: string, dataBase64: string) =>
    invoke<void>("write_binary_file", { path, dataBase64 }),
  getCollections: () => invoke<Record<string, string[]>>("get_collections"),
  setCollection: (name: string, families: string[]) =>
    invoke<void>("set_collection", { name, families }),
  deleteCollection: (name: string) => invoke<void>("delete_collection", { name }),
  renameCollection: (from: string, to: string) =>
    invoke<void>("rename_collection", { from, to }),
  exportFont: (src: string, dest: string) => invoke<void>("export_font", { src, dest }),
  writeTextFile: (path: string, content: string) =>
    invoke<void>("write_text_file", { path, content }),
  exportFonts: (paths: string[], destDir: string) =>
    invoke<number>("export_fonts", { paths, destDir }),
  adobeAvailable: () => invoke<boolean>("adobe_available"),
  // Google Fonts: the catalogue is metadata, the previews are fetched on
  // demand, and a style only becomes a real font file when it is activated.
  googleCatalog: () => invoke<GoogleFamily[]>("google_catalog"),
  refreshGoogleCatalog: () => invoke<number>("refresh_google_catalog"),
  googleStyles: (family: string) => invoke<GoogleFamilyInfo>("google_styles", { family }),
  googlePreview: (family: string, style: string) =>
    invoke<GooglePreviewFile[]>("google_preview", { family, style }),
  installGoogleFont: (family: string, styles: string[]) =>
    invoke<GoogleInstallResult>("install_google_font", { family, styles }),
  googleCacheBytes: () => invoke<number>("google_cache_bytes"),
  clearGoogleCache: () => invoke<number>("clear_google_cache"),
  applyFontInApp: (app: AdobeApp, postscriptName: string, label: string) =>
    invoke<string>("apply_font_in_app", { app, postscriptName, label }),
  getPrefs: () => invoke<Record<string, unknown> | null>("get_prefs"),
  setPrefs: (prefs: Record<string, unknown>) => invoke<void>("set_prefs", { prefs }),
};

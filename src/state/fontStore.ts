import { create } from "zustand";
import { ScanQueue } from "../lib/scanQueue";
import { listen } from "@tauri-apps/api/event";
import {
  ipc,
  type AdobeApp,
  type AffinityConnection,
  type AppSettings,
  type Classification,
  type FontFace,
  type InstallMode,
  type ScanProgress,
  type TrashEntry,
} from "../lib/ipc";
import { matchAffinityFonts, type AffinityEvent } from "../lib/affinity";
import { applyAccent, loadAccent, saveAccent } from "../lib/accent";
import { toast } from "../design/primitives/Toast";
import { setSoundLevel, type SoundLevel } from "../lib/sound";
import { applyTheme, type ThemePref } from "../lib/theme";
import {
  getLocalePref,
  hydrateLocalePref,
  isLocalePref,
  setLocalePref as applyLocalePref,
  t,
  type LocalePref,
} from "../lib/i18n";

export const SIZES = [8, 14, 18, 24, 32, 48, 64, 96] as const;

// Width of the left filter column (Sidebar). The current 248px is the
// minimum — the column can only grow from there.
export const SIDEBAR_WIDTH_MIN = 248;
export const SIDEBAR_WIDTH_MAX = 520;
export const SIDEBAR_WIDTH_DEFAULT = 248;

// init() subscribes to backend events; React StrictMode runs the mounting
// effect twice in dev, so guard it — a second run would attach every
// listener twice and each toast would appear twice.
let initStarted = false;

// Every rescan gets a sequence number. A slow scan that started before a
// newer delete/restore must not overwrite the fresher state when it lands
// (that is what briefly put deleted fonts back into the list).
let scanGen = 0;

// Requests during a scan invalidate its result and schedule one trailing scan.
const scanQueue = new ScanQueue(async (isCurrent) => {
  const before = useFontStore.getState();
  useFontStore.setState({ phase: "scanning", scanProgress: { done: 0, total: 0 } });
  try {
    const [fonts, tags, collections, favorites, notes, trash] = await Promise.all([
      ipc.scanFonts(), ipc.getTags(), ipc.getCollections(),
      ipc.getFavorites(), ipc.getNotes(), ipc.listTrash(),
    ]);
    if (!isCurrent()) return;
    const now = useFontStore.getState();
    // A user edit during IPC wins over metadata read before that edit.
    applyLibrary(useFontStore.setState, useFontStore.getState, {
      fonts,
      tags: now.tags === before.tags ? tags : now.tags,
      collections: now.collections === before.collections ? collections : now.collections,
      favorites: now.favorites === before.favorites ? favorites : now.favorites,
      notes: now.notes === before.notes ? notes : now.notes,
      trash: now.trash === before.trash ? trash : now.trash,
    });
  } catch (e) {
    if (!isCurrent()) return;
    useFontStore.setState({ phase: "error" });
    toast.error(t("toast.couldntScan"), String(e));
  }
});

export type ViewMode = "grid" | "list" | "waterfall";
export type MotionPref = "system" | "reduced";
export type SortMode = "name" | "styles" | "size";
export type Nav =
  | { kind: "library" }
  | { kind: "trash" }
  | { kind: "about" }
  | { kind: "tag"; tag: string }
  | { kind: "collection"; name: string }
  | { kind: "foundry"; foundry: string }
  | { kind: "favorites" }
  | { kind: "activated" }
  | { kind: "activatedSession" }
  | { kind: "affinity" }
  | { kind: "deactivated" }
  | { kind: "system" }
  | { kind: "lastImported" };

export type TagCollectionNav =
  | { kind: "tag"; tag: string }
  | { kind: "collection"; name: string };

export type BrowseKind =
  | "library"
  | "favorites"
  | "lastImported"
  | "activated"
  | "activatedSession"
  | "affinity"
  | "deactivated"
  | "system";

export type AreaKind = "main" | "trash" | "about";

export interface Family {
  name: string;
  faces: FontFace[];
  formats: string[];
  isVariable: boolean;
  active: boolean;
  deactivatable: boolean;
  tags: string[];
  totalSize: number;
  foundry: string | null;
  classification: Classification;
  scripts: string[];
}

interface FontStore {
  phase: "scanning" | "ready" | "error";
  scanProgress: ScanProgress;
  fonts: FontFace[];
  tags: Record<string, string[]>;
  collections: Record<string, string[]>;
  favorites: string[];
  sessionActivated: string[];
  affinityActivated: string[];
  lastImported: string[];
  notes: Record<string, string>;
  trash: TrashEntry[];
  panelWidth: number;
  sidebarWidth: number;

  selection: string[];

  visibleOrder: string[];

  compare: string[] | null;

  comparePicking: boolean;
  settingsOpen: boolean;
  helpOpen: boolean;
  paletteOpen: boolean;
  settings: AppSettings;
  affinityConnection: AffinityConnection | null;

  adobeAvailable: boolean;
  motionPref: MotionPref;
  soundPref: SoundLevel;
  themePref: ThemePref;
  localePref: LocalePref;

  bulkTagFor: string[] | null;

  onboarded: boolean;

  tourStep: number | null;

  sampleText: string;
  sizeIndex: number;
  viewMode: ViewMode;
  sort: SortMode;
  search: string;
  expandSignal: number;
  expandOpen: boolean;
  accent: string;

  classFilter: Classification[];

  scriptFilter: string[];
  variableOnly: boolean;
  browseSel: BrowseKind;
  colSel: string[];
  tagSel: string[];
  foundrySel: string[];
  area: AreaKind;
  selectedFamily: string | null;

  pendingCollectionFor: string | null;

  duplicateReport: { names: string[]; at: number } | null;

  init: () => Promise<void>;
  rescan: () => Promise<void>;
  setFamilyActive: (family: string, active: boolean) => Promise<void>;
  activateFamilySession: (family: string) => Promise<void>;
  setFontFileActive: (path: string, active: boolean) => Promise<void>;
  uninstallFontFile: (path: string) => Promise<void>;
  installPaths: (paths: string[], mode: InstallMode) => Promise<void>;
  uninstallFamily: (family: string) => Promise<void>;
  restoreTrash: (entryId: string) => Promise<void>;
  deleteTrashEntry: (entryId: string) => Promise<void>;
  emptyTrash: () => Promise<void>;
  setFamilyTags: (family: string, tags: string[]) => Promise<void>;
  createCollection: (name: string) => Promise<void>;
  deleteCollection: (name: string) => Promise<void>;
  renameCollection: (from: string, to: string) => Promise<void>;
  toggleFamilyInCollection: (collection: string, family: string) => Promise<void>;
  toggleFavorite: (family: string) => Promise<void>;
  favoriteMany: (families: string[]) => Promise<void>;
  setFamilyNote: (family: string, note: string) => Promise<void>;
  setFamiliesActiveBulk: (families: string[], active: boolean) => Promise<void>;
  applyFamilyInApp: (family: string, app: AdobeApp) => Promise<void>;
  setPanelWidth: (w: number) => void;
  setSidebarWidth: (w: number) => void;
  selectWith: (family: string, mode: "single" | "toggle" | "range", order: string[]) => void;
  selectAllVisible: () => void;
  openCompare: (families: string[]) => void;
  closeCompare: () => void;
  setComparePicking: (on: boolean) => void;
  togglePick: (family: string) => void;
  setAllExpanded: (open: boolean) => void;
  setAccent: (hex: string) => void;
  setSettingsOpen: (open: boolean) => void;
  setHelpOpen: (open: boolean) => void;
  setPaletteOpen: (open: boolean) => void;
  updateSettings: (settings: AppSettings) => Promise<void>;
  refreshAffinityConnection: () => Promise<void>;
  setMotionPref: (pref: MotionPref) => void;
  setSoundPref: (pref: SoundLevel) => void;
  setThemePref: (pref: ThemePref) => void;
  setLocalePref: (pref: LocalePref) => void;
  startTour: () => void;
  setTourStep: (step: number) => void;
  endTour: () => void;
  setBulkTagFor: (families: string[] | null) => void;
  applyTagToFamilies: (tag: string, families: string[]) => Promise<void>;
  toggleTagForFamily: (tag: string, family: string) => Promise<void>;
  setDuplicateReport: (r: { names: string[]; at: number } | null) => void;

  setSampleText: (t: string) => void;
  setSizeIndex: (i: number) => void;
  setViewMode: (m: ViewMode) => void;
  setSort: (s: SortMode) => void;
  setSearch: (s: string) => void;
  toggleClassFilter: (c: Classification) => void;
  toggleScriptFilter: (s: string) => void;
  setVariableOnly: (on: boolean) => void;
  exportLibraryData: (dest: string) => Promise<void>;
  importLibraryData: (src: string) => Promise<void>;
  setNav: (n: Nav) => void;
  setBrowse: (b: BrowseKind) => void;
  setFilterSel: (cols: string[], tags: string[], foundrys?: string[]) => void;
  setArea: (a: AreaKind) => void;
  select: (family: string | null) => void;
}

function applyMotionPref(pref: MotionPref) {
  document.documentElement.dataset.motion = pref;
}

let prefsTimer: ReturnType<typeof setTimeout> | undefined;
function persistPrefs(get: () => FontStore) {
  clearTimeout(prefsTimer);
  prefsTimer = setTimeout(() => {
    const s = get();
    void ipc.setPrefs({
      sampleText: s.sampleText,
      sizeIndex: s.sizeIndex,
      viewMode: s.viewMode,
      sort: s.sort,
      panelWidth: s.panelWidth,
      sidebarWidth: s.sidebarWidth,
      motionPref: s.motionPref,
      soundPref: s.soundPref,
      themePref: s.themePref,
      localePref: s.localePref,
      onboarded: s.onboarded,
      lastImported: s.lastImported,
    });
  }, 600);
}

// The library fields a finished scan / warm snapshot delivers.
type LibrarySlice = {
  fonts: FontFace[];
  tags: Record<string, string[]>;
  collections: Record<string, string[]>;
  favorites: string[];
  notes: Record<string, string>;
  trash: TrashEntry[];
};

// Folds a freshly loaded library into the store. Shared by the startup path
// (warm backend snapshot or first blocking scan) and every later rescan, so the
// derived cleanup of stale "last imported" and "session activated" entries
// happens on both.
function applyLibrary(
  set: (data: Partial<FontStore>) => void,
  get: () => FontStore,
  data: LibrarySlice,
) {
  set({ ...data, phase: "ready" });
  // Drop last-imported entries that no longer exist.
  const names = new Set(data.fonts.map((f) => f.family));
  const keptImported = get().lastImported.filter((n) => names.has(n));
  if (keptImported.length !== get().lastImported.length) set({ lastImported: keptImported });
  // Drop session entries that no longer exist or are no longer active.
  const alive = new Set(data.fonts.filter((f) => f.active).map((f) => f.family));
  const kept = get().sessionActivated.filter((n) => alive.has(n));
  if (kept.length !== get().sessionActivated.length) set({ sessionActivated: kept });
  const keptAffinity = get().affinityActivated.filter((n) => alive.has(n));
  if (keptAffinity.length !== get().affinityActivated.length)
    set({ affinityActivated: keptAffinity });
}

export const useFontStore = create<FontStore>((set, get) => ({
  phase: "scanning",
  scanProgress: { done: 0, total: 0 },
  fonts: [],
  tags: {},
  collections: {},
  favorites: [],
  sessionActivated: [],
  affinityActivated: [],
  lastImported: [],
  notes: {},
  trash: [],
  panelWidth: 348,
  sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
  selection: [],
  visibleOrder: [],
  compare: null,
  comparePicking: false,
  settingsOpen: false,
  helpOpen: false,
  paletteOpen: false,
  settings: { extraDirs: [], watchEnabled: false, autoActivateImports: false, libraryDir: null, libraryDirEnabled: false, affinityEnabled: false, affinityDeactivateOnQuit: true },
  affinityConnection: null,
  adobeAvailable: false,
  motionPref: "system",
  soundPref: "off",
  themePref: "dark",
  localePref: getLocalePref(),
  bulkTagFor: null,
  onboarded: false,
  tourStep: null,

  sampleText: t("preview.defaultSample"),
  sizeIndex: 3,
  viewMode: "grid",
  sort: "name",
  search: "",
  expandSignal: 0,
  expandOpen: false,
  accent: loadAccent(),
  classFilter: [],
  scriptFilter: [],
  variableOnly: false,
  browseSel: "library",
  colSel: [],
  tagSel: [],
  foundrySel: [],
  area: "main",
  selectedFamily: null,
  pendingCollectionFor: null,
  duplicateReport: null,

  init: async () => {
    if (initStarted) return;
    initStarted = true;
    await listen<ScanProgress>("scan:progress", (e) => {
      set({ scanProgress: e.payload });
    });
    try {
      const prefs = (await ipc.getPrefs()) ?? {};
      set({
        sampleText: typeof prefs.sampleText === "string" ? prefs.sampleText : get().sampleText,
        sizeIndex: typeof prefs.sizeIndex === "number" ? prefs.sizeIndex : get().sizeIndex,
        viewMode: (["grid", "list", "waterfall"] as const).includes(
          prefs.viewMode as ViewMode,
        )
          ? (prefs.viewMode as ViewMode)
          : "grid",
        sort: (["name", "styles", "size"] as const).includes(prefs.sort as SortMode)
          ? (prefs.sort as SortMode)
          : "name",
        panelWidth:
          typeof prefs.panelWidth === "number"
            ? Math.min(560, Math.max(300, prefs.panelWidth))
            : 348,
        sidebarWidth:
          typeof prefs.sidebarWidth === "number"
            ? Math.min(
                SIDEBAR_WIDTH_MAX,
                Math.max(SIDEBAR_WIDTH_MIN, prefs.sidebarWidth),
              )
            : SIDEBAR_WIDTH_DEFAULT,
        motionPref: prefs.motionPref === "reduced" ? "reduced" : "system",
        soundPref: (["off", "subtle", "on"] as const).includes(prefs.soundPref as SoundLevel)
          ? (prefs.soundPref as SoundLevel)
          : "off",
        themePref: (["dark", "light", "system"] as const).includes(prefs.themePref as ThemePref)
          ? (prefs.themePref as ThemePref)
          : "dark",
        onboarded: prefs.onboarded === true,
        localePref: isLocalePref(prefs.localePref) ? prefs.localePref : get().localePref,
        lastImported: Array.isArray(prefs.lastImported)
          ? (prefs.lastImported as unknown[]).filter((n): n is string => typeof n === "string")
          : [],
      });
      setSoundLevel(get().soundPref);
      hydrateLocalePref(get().localePref);
    } catch {

    }
    applyTheme(get().themePref);
    applyMotionPref(get().motionPref);
    try {
      set({ settings: await ipc.getSettings() });
    } catch {

    }
    try {
      set({ adobeAvailable: await ipc.adobeAvailable() });
    } catch {

    }

    let watchTimer: ReturnType<typeof setTimeout> | undefined;
    await listen("fonts:changed", () => {
      clearTimeout(watchTimer);
      watchTimer = setTimeout(() => {
        // Queue a trailing scan even when another scan is in progress.
        const before = get().fonts.length;
        void get()
          .rescan()
          .then(() => {
            const after = get().fonts.length;
            if (after !== before) {
              toast.success(
                t("toast.libraryUpdated"),
                after > before
                  ? t("toast.newFontsFound", { count: after - before })
                  : t("toast.fontsRemoved", { count: before - after }),
              );
            }
          });
      }, 1500);
    });
    await listen<AffinityEvent>("affinity:event", (e) => {
      const evt = e.payload;
      if (evt.kind === "needs") {
        const paths = matchAffinityFonts(
          get().fonts,
          evt.docs.flatMap((d) => d.fonts),
        );
        if (paths.length === 0) return;
        void (async () => {
          try {
            const activated = await ipc.affinitySessionActivate(paths);
            if (activated.length === 0) return;
            const byPath = new Map(get().fonts.map((f) => [f.path, f.family]));
            const families = [...new Set(activated.map((p) => byPath.get(p)).filter((n): n is string => Boolean(n)))];
            if (families.length > 0) {
              set({
                affinityActivated: [...new Set([...get().affinityActivated, ...families])],
              });
            }
            const titles = [...new Set(evt.docs.map((d) => d.title))].join("\n");
            toast.success(
              t("toast.affinityActivated", { count: activated.length }),
              titles || undefined,
              "activate",
            );
            await get().rescan();
          } catch (err) {
            toast.error(t("toast.affinityError"), String(err));
          }
        })();
      } else if (evt.kind === "deactivated") {
        set({ affinityActivated: [] });
        toast.success(t("toast.affinityDeactivated"), undefined, "activate");
        void get().rescan();
      } else if (evt.kind === "error") {
        toast.error(t("toast.affinityError"), evt.message ?? "");
      }
    });
    // A warm parse cache is provisional, not a completed scan. Keep the
    // indicator visible and do not prune history until fresh data arrives.
    const myGen = scanGen;
    const before = get();
    try {
      const finished = await ipc.peekFonts().catch(() => null);
      const warm = finished ? null : await ipc.warmFonts().catch(() => null);
      const [tags, collections, favorites, notes, trash] = await Promise.all([
        ipc.getTags(), ipc.getCollections(), ipc.getFavorites(), ipc.getNotes(), ipc.listTrash(),
      ]);
      if (myGen !== scanGen) return;
      const now = get();
      const metadata = {
        tags: now.tags === before.tags ? tags : now.tags,
        collections: now.collections === before.collections ? collections : now.collections,
        favorites: now.favorites === before.favorites ? favorites : now.favorites,
        notes: now.notes === before.notes ? notes : now.notes,
        trash: now.trash === before.trash ? trash : now.trash,
      };
      if (finished) {
        applyLibrary(set, get, { fonts: finished, ...metadata });
        return;
      }
      set({ ...metadata, ...(warm ? { fonts: warm } : {}), phase: "scanning" });
      // This command waits for startup or reuses its completed result. Unlike
      // an event subscription it cannot miss completion during registration,
      // and a slow scan does not silently expire after thirty seconds.
      const fonts = await ipc.initialFonts();
      if (myGen !== scanGen) return;
      applyLibrary(set, get, {
        fonts, tags: get().tags, collections: get().collections,
        favorites: get().favorites, notes: get().notes, trash: get().trash,
      });
    } catch (e) {
      if (myGen !== scanGen) return;
      set({ phase: "error" });
      toast.error(t("toast.couldntScan"), String(e));
    }
  },

  rescan: () => {
    ++scanGen;
    set({ phase: "scanning" });
    return scanQueue.request();
  },

  setFamilyActive: async (family, active) => {
    const faces = get().fonts.filter((f) => f.family === family && f.deactivatable);
    const paths = [...new Set(faces.map((f) => f.path))];
    if (paths.length === 0) return;

    const prevSession = get().sessionActivated;
    const prevAffinity = get().affinityActivated;
    const prevFonts = get().fonts;
    set({
      fonts: prevFonts.map((f) =>
        f.family === family && f.deactivatable ? { ...f, active } : f,
      ),
      sessionActivated: prevSession.filter((n) => n !== family),
      affinityActivated: prevAffinity.filter((n) => n !== family),
    });
    try {
      await ipc.setFontsActive(paths, active);
    } catch (e) {
      set({
        fonts: prevFonts,
        sessionActivated: prevSession,
        affinityActivated: prevAffinity,
      });
      toast.error(t(active ? "toast.couldntActivate" : "toast.couldntDeactivate"), String(e));
    }
  },

  activateFamilySession: async (family) => {
    const faces = get().fonts.filter((f) => f.family === family && f.deactivatable);
    const paths = [...new Set(faces.map((f) => f.path))];
    if (paths.length === 0) return;
    const prevFonts = get().fonts;
    set({
      fonts: prevFonts.map((f) =>
        f.family === family && f.deactivatable ? { ...f, active: true } : f,
      ),
    });
    try {
      await ipc.setFontsActiveSession(paths);
      set({ sessionActivated: [...new Set([...get().sessionActivated, family])] });
      toast.success(
        t("toast.activeUntilClose", { family }),
        t("toast.activeUntilCloseSub"),
        "toggle-on",
      );
    } catch (e) {
      set({
        fonts: prevFonts,
      });
      toast.error(t("toast.couldntActivate"), String(e));
    }
  },

  setFontFileActive: async (path, active) => {
    const faces = get().fonts.filter((f) => f.path === path);
    if (faces.length === 0) return;
    // System files are protected: never deactivate or remove them from here.
    if (faces.every((f) => f.source === "system")) {
      toast.error(t("toast.cantUninstallSystem"), t("toast.cantUninstallSystemSub"));
      return;
    }
    const targets = faces.filter((f) => f.deactivatable);
    if (targets.length === 0) return;
    const prevFonts = get().fonts;
    set({
      fonts: prevFonts.map((f) =>
        f.path === path && f.deactivatable ? { ...f, active } : f,
      ),
    });
    try {
      await ipc.setFontsActive([path], active);
    } catch (e) {
      set({ fonts: prevFonts });
      toast.error(t(active ? "toast.couldntActivate" : "toast.couldntDeactivate"), String(e));
    }
  },

  uninstallFontFile: async (path) => {
    const faces = get().fonts.filter((f) => f.path === path);
    if (faces.length === 0) return;
    // System files are protected: they cannot be moved to trash.
    if (faces.some((f) => f.source === "system")) {
      toast.error(t("toast.cantUninstallSystem"), t("toast.cantUninstallSystemSub"));
      return;
    }
    const family = faces[0].family;
    try {
      const entry = await ipc.uninstallFont(path, family);
      const remaining = get().fonts.filter((f) => f.path !== path);
      const familyAlive = remaining.some((f) => f.family === family);
      set({
        fonts: remaining,
        trash: await ipc.listTrash(),
        selectedFamily: !familyAlive && get().selectedFamily === family ? null : get().selectedFamily,
        selection: !familyAlive ? get().selection.filter((f) => f !== family) : get().selection,
        lastImported: !familyAlive
          ? get().lastImported.filter((f) => f !== family)
          : get().lastImported,
      });
      // Converge to the backend truth: a watcher-triggered scan that started
      // before this delete must not put the file back into the list.
      await get().rescan();

      if (!familyAlive) {
        const { tags, favorites, collections } = get();
        if (tags[family]) void get().setFamilyTags(family, []);
        if (favorites.includes(family)) void get().toggleFavorite(family);
        for (const [name, members] of Object.entries(collections)) {
          if (members.includes(family)) {
            const next = members.filter((m) => m !== family);
            set({ collections: { ...get().collections, [name]: next } });
            void ipc.setCollection(name, next);
          }
        }
      }
      toast.success(t("toast.movedToTrash", { family }), t("toast.movedToTrashSub"), "trash", {
        label: t("toast.undo"),
        run: () => {
          void (async () => {
            try {
              await ipc.restoreFromTrash(entry.id);
              set({ trash: await ipc.listTrash() });
              await get().rescan();
              toast.success(t("toast.restoredFamily", { family }), undefined, "restore");
            } catch (e) {
              toast.error(t("toast.couldntRestore"), String(e));
            }
          })();
        },
      });
    } catch (e) {
      toast.error(t("toast.couldntMoveToTrash"), String(e));
      // The backend may have moved the file before failing (or a watcher
      // scan may hold stale data): re-read so list and trash agree.
      await get().rescan();
    }
  },

  installPaths: async (paths, mode) => {
    try {
      const dupKeyOf = (f: { postscriptName: string | null; family: string; style: string }) =>
        f.postscriptName ?? `${f.family} ${f.style}`;
      const existing = get().fonts.map(dupKeyOf);
      const result = await ipc.installFonts(paths, existing, mode);
      if (result.installed.length > 0) {
        const families = [...new Set(result.installed.map((f) => f.family))];
        set({ fonts: [...get().fonts, ...result.installed], lastImported: families });
        // Invalidate any older scan and refresh even when the watcher is off
        // (linked imports can live outside every watched directory).
        void get().rescan();
        persistPrefs(get);
        toast.success(
          families.length === 1
            ? t("toast.installedOne", { name: families[0] })
            : t("toast.installedMany", { count: families.length }),
          undefined,
          "install",
        );
      }
      for (const err of result.errors) toast.error(t("toast.installFailed"), err);
      if (
        result.installed.length === 0 &&
        result.errors.length === 0 &&
        result.duplicates.length === 0
      ) {
        toast.error(t("toast.nothingToInstall"), t("toast.nothingToInstallSub"));
      }
      if (result.duplicates.length > 0) {
        set({
          duplicateReport: { names: [...result.duplicates], at: Date.now() },
        });
      }
    } catch (e) {
      toast.error(t("toast.installFailed"), String(e));
    }
  },

  uninstallFamily: async (family) => {
    const faces = get().fonts.filter(
      (f) => f.family === family && f.source !== "system",
    );
    if (faces.length === 0) {
      toast.error(t("toast.cantUninstallSystem"), t("toast.cantUninstallSystemSub"));
      return;
    }
    const paths = [...new Set(faces.map((f) => f.path))];
    try {
      // Move files one by one: a locked file must not silently cancel the
      // rest of the family, nor leave moved files out of the UI update.
      const entryIds: string[] = [];
      const movedPaths: string[] = [];
      const failed: string[] = [];
      for (const path of paths) {
        try {
          entryIds.push((await ipc.uninstallFont(path, family)).id);
          movedPaths.push(path);
        } catch (e) {
          failed.push(`${path}: ${String(e)}`);
        }
      }
      if (movedPaths.length === 0) {
        toast.error(t("toast.couldntMoveToTrash"), failed.join("\n"));
        await get().rescan();
        return;
      }
      const remaining = get().fonts.filter((f) => !movedPaths.includes(f.path));
      const familyAlive = remaining.some((f) => f.family === family);
      set({
        fonts: remaining,
        trash: await ipc.listTrash(),
        selectedFamily:
          !familyAlive && get().selectedFamily === family ? null : get().selectedFamily,
        selection: !familyAlive
          ? get().selection.filter((f) => f !== family)
          : get().selection,
        lastImported: !familyAlive
          ? get().lastImported.filter((f) => f !== family)
          : get().lastImported,
      });
      // Converge to the backend truth (see uninstallFontFile).
      await get().rescan();

      if (!familyAlive) {
        const { tags, favorites, collections } = get();
        if (tags[family]) void get().setFamilyTags(family, []);
        if (favorites.includes(family)) void get().toggleFavorite(family);
        for (const [name, members] of Object.entries(collections)) {
          if (members.includes(family)) {
            const next = members.filter((m) => m !== family);
            set({ collections: { ...get().collections, [name]: next } });
            void ipc.setCollection(name, next);
          }
        }
      }
      if (failed.length > 0) {
        toast.error(t("toast.couldntMoveToTrash"), failed.join("\n"));
      }
      toast.success(t("toast.movedToTrash", { family }), t("toast.movedToTrashSub"), "trash", {
        label: t("toast.undo"),
        run: () => {
          void (async () => {
            try {
              for (const id of entryIds) await ipc.restoreFromTrash(id);
              set({ trash: await ipc.listTrash() });
              await get().rescan();
              toast.success(t("toast.restoredFamily", { family }), undefined, "restore");
            } catch (e) {
              toast.error(t("toast.couldntRestore"), String(e));
            }
          })();
        },
      });
    } catch (e) {
      toast.error(t("toast.couldntMoveToTrash"), String(e));
      await get().rescan();
    }
  },

  restoreTrash: async (entryId) => {
    try {
      await ipc.restoreFromTrash(entryId);
      set({ trash: await ipc.listTrash() });
      await get().rescan();
      toast.success(t("toast.fontRestored"), undefined, "restore");
    } catch (e) {
      toast.error(t("toast.couldntRestore"), String(e));
    }
  },

  deleteTrashEntry: async (entryId) => {
    try {
      await ipc.deleteTrashEntry(entryId);
      set({ trash: await ipc.listTrash() });
    } catch (e) {
      toast.error(t("toast.couldntDelete"), String(e));
    }
  },

  emptyTrash: async () => {
    try {
      await ipc.emptyTrash();
      set({ trash: [] });
      toast.success(t("toast.trashEmptied"), undefined, "trash-empty");
    } catch (e) {
      toast.error(t("toast.couldntEmptyTrash"), String(e));
    }
  },

  setFamilyTags: async (family, tags) => {
    const prev = get().tags;
    const next = { ...prev };
    if (tags.length === 0) delete next[family];
    else next[family] = tags;
    set({ tags: next });
    try {
      await ipc.setTags(family, tags);
    } catch (e) {
      set({ tags: prev });
      toast.error(t("toast.couldntSaveTags"), String(e));
    }
  },

  createCollection: async (name) => {
    const clean = name.trim();
    if (!clean) return;
    if (get().collections[clean]) {
      toast.error(t("toast.collectionExists"), t("toast.collectionExistsSub", { name: clean }));
      return;
    }
    const prev = get().collections;
    const pending = get().pendingCollectionFor;
    const families = pending ? [pending] : [];
    set({
      collections: { ...prev, [clean]: families },
      pendingCollectionFor: null,
    });
    try {
      await ipc.setCollection(clean, families);
      toast.success(
        t("toast.createdCollection", { name: clean }),
        pending ? t("toast.familyAdded", { name: pending }) : t("toast.rightClickToAdd"),
      );
    } catch (e) {
      set({ collections: prev });
      toast.error(t("toast.couldntCreateCollection"), String(e));
    }
  },

  deleteCollection: async (name) => {
    const prev = get().collections;
    const next = { ...prev };
    delete next[name];
    set({
      collections: next,
      colSel: get().colSel.filter((c) => c !== name),
    });
    try {
      await ipc.deleteCollection(name);
    } catch (e) {
      set({ collections: prev });
      toast.error(t("toast.couldntDeleteCollection"), String(e));
    }
  },

  renameCollection: async (from, to) => {
    const clean = to.trim();
    if (!clean || clean === from) return;
    const prev = get().collections;
    if (prev[clean]) {
      toast.error(t("toast.nameTaken"), t("toast.nameTakenSub", { name: clean }));
      return;
    }
    const next = { ...prev, [clean]: prev[from] ?? [] };
    delete next[from];
    set({
      collections: next,
      colSel: get().colSel.map((c) => (c === from ? clean : c)),
    });
    try {
      await ipc.renameCollection(from, clean);
    } catch (e) {
      set({ collections: prev });
      toast.error(t("toast.couldntRenameCollection"), String(e));
    }
  },

  toggleFamilyInCollection: async (collection, family) => {
    const prev = get().collections;
    const current = prev[collection] ?? [];
    const families = current.includes(family)
      ? current.filter((f) => f !== family)
      : [...current, family];
    set({ collections: { ...prev, [collection]: families } });
    try {
      await ipc.setCollection(collection, families);
    } catch (e) {
      set({ collections: prev });
      toast.error(t("toast.couldntUpdateCollection"), String(e));
    }
  },

  toggleFavorite: async (family) => {
    const prev = get().favorites;
    const favorite = !prev.includes(family);
    set({ favorites: favorite ? [...prev, family] : prev.filter((f) => f !== family) });
    try {
      await ipc.setFavorite(family, favorite);
    } catch (e) {
      set({ favorites: prev });
      toast.error(t("toast.couldntUpdateFavorites"), String(e));
    }
  },

  favoriteMany: async (families) => {
    const prev = get().favorites;
    const missing = families.filter((f) => !prev.includes(f));
    if (missing.length === 0) return;
    set({ favorites: [...prev, ...missing] });
    try {
      for (const f of missing) await ipc.setFavorite(f, true);
    } catch (e) {
      set({ favorites: prev });
      toast.error(t("toast.couldntUpdateFavorites"), String(e));
    }
  },

  setFamilyNote: async (family, note) => {
    const prev = get().notes;
    const next = { ...prev };
    if (note.trim()) next[family] = note;
    else delete next[family];
    set({ notes: next });
    try {
      await ipc.setNote(family, note);
    } catch (e) {
      set({ notes: prev });
      toast.error(t("toast.couldntSaveNote"), String(e));
    }
  },

  setFamiliesActiveBulk: async (families, active) => {
    const paths = [
      ...new Set(
        get()
          .fonts.filter((f) => families.includes(f.family) && f.deactivatable)
          .map((f) => f.path),
      ),
    ];
    if (paths.length === 0) return;
    const prevFonts = get().fonts;
    const prevSession = get().sessionActivated;
    const prevAffinity = get().affinityActivated;
    set({
      fonts: prevFonts.map((f) =>
        families.includes(f.family) && f.deactivatable ? { ...f, active } : f,
      ),
      sessionActivated: prevSession.filter((n) => !families.includes(n)),
      affinityActivated: prevAffinity.filter((n) => !families.includes(n)),
    });
    try {
      await ipc.setFontsActive(paths, active);
      toast.success(
        t(active ? "toast.activatedCount" : "toast.deactivatedCount", {
          count: families.length,
        }),
        undefined,
        undefined,
        { label: t("toast.undo"), run: () => void get().setFamiliesActiveBulk(families, !active) },
      );
    } catch (e) {
      set({ fonts: prevFonts, sessionActivated: prevSession, affinityActivated: prevAffinity });
      toast.error(t("toast.bulkUpdateFailed"), String(e));
    }
  },

  applyFamilyInApp: async (family, app) => {
    const appName = t(`adobe.${app}`);
    const fam = familiesFor(get().fonts, get().tags).get(family);
    if (!fam) return;
    const lead = fam.faces.find((f) => f.style === "Regular") ?? fam.faces[0];
    if (!lead.postscriptName) {
      toast.error(t("toast.noPostScriptName"), t("toast.noPostScriptNameSub", { app: appName }));
      return;
    }

    if (!fam.active) {
      if (!fam.deactivatable) return;
      await get().activateFamilySession(family);
      if (!familiesFor(get().fonts, get().tags).get(family)?.active) return;
      await new Promise((r) => setTimeout(r, 600));
    }
    try {
      const outcome = await ipc.applyFontInApp(app, lead.postscriptName, family);
      if (outcome.startsWith("applied:")) {
        const count = Number(outcome.slice("applied:".length)) || 1;
        toast.success(
          t("toast.appliedInApp", { family, app: appName }),
          t("toast.appliedLayers", { count }),
          "success",
        );
      } else if (outcome === "created") {
        toast.success(
          t("toast.createdInApp", { app: appName }),
          t("toast.createdInAppSub", { family }),
          "success",
        );
      } else if (outcome === "not-running") {
        toast.error(t("toast.appNotRunning", { app: appName }), t("toast.appNotRunningSub"));
      } else if (outcome === "no-document") {
        toast.error(t("toast.noDocumentInApp", { app: appName }), t("toast.noDocumentInAppSub"));
      } else if (outcome === "font-not-found") {
        toast.error(
          t("toast.fontUnknownToApp", { app: appName, family }),
          t("toast.fontUnknownToAppSub"),
        );
      } else {
        toast.error(t("toast.couldntApplyIn", { app: appName }), outcome);
      }
    } catch (e) {
      toast.error(t("toast.couldntApplyIn", { app: appName }), String(e));
    }
  },

  selectWith: (family, mode, order) => {
    const { selection, selectedFamily } = get();
    if (mode === "single" && selectedFamily === family && selection.length <= 1) {
      set({ selection: [], selectedFamily: null });
      return;
    }
    if (mode === "toggle") {
      const next = selection.includes(family)
        ? selection.filter((f) => f !== family)
        : [...selection, family];
      set({ selection: next, selectedFamily: family });
      return;
    }
    if (mode === "range" && selectedFamily) {
      const a = order.indexOf(selectedFamily);
      const b = order.indexOf(family);
      if (a !== -1 && b !== -1) {
        const range = order.slice(Math.min(a, b), Math.max(a, b) + 1);
        set({ selection: [...new Set([...selection, ...range])], selectedFamily: family });
        return;
      }
    }
    set({ selection: [family], selectedFamily: family });
  },

  selectAllVisible: () => {
    const order = get().visibleOrder;
    if (order.length === 0) return;
    set({ selection: [...order], selectedFamily: order[order.length - 1] });
  },

  openCompare: (families) => set({ compare: families.slice(0, 4), comparePicking: false }),
  closeCompare: () => set({ compare: null }),
  setComparePicking: (comparePicking) => set({ comparePicking }),
  setAllExpanded: (expandOpen) =>
    set((s) => ({ expandOpen, expandSignal: s.expandSignal + 1 })),
  setAccent: (accent) => {
    saveAccent(accent);
    applyAccent(accent);
    set({ accent });
  },

  togglePick: (family) =>
    set((s) => ({
      selection: s.selection.includes(family)
        ? s.selection.filter((f) => f !== family)
        : [...s.selection, family],
    })),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setHelpOpen: (helpOpen) => set({ helpOpen }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),

  updateSettings: async (settings) => {
    const prev = get().settings;
    set({ settings });
    try {
      await ipc.setSettings(settings);
    } catch (e) {
      set({ settings: prev });
      toast.error(t("toast.couldntSaveSettings"), String(e));
      return;
    }

    const dirsChanged =
      prev.extraDirs.length !== settings.extraDirs.length ||
      prev.extraDirs.some((d, i) => d !== settings.extraDirs[i]) ||
      prev.libraryDir !== settings.libraryDir ||
      prev.libraryDirEnabled !== settings.libraryDirEnabled;
    if (!dirsChanged || get().phase === "scanning") return;
    const before = get().fonts.length;
    await get().rescan();
    if (get().phase !== "ready") return;
    const after = get().fonts.length;
    const added = settings.extraDirs.length > prev.extraDirs.length;
    toast.success(
      t("toast.libraryUpdated"),
      after > before
        ? t("toast.newFontsFound", { count: after - before })
        : after < before
          ? t("toast.fontsRemoved", { count: before - after })
          : added
            ? t("toast.noFontsInFolder")
            : t("toast.libraryUnchanged"),
    );
  },

  refreshAffinityConnection: async () => {
    try {
      set({ affinityConnection: await ipc.affinityConnection() });
    } catch {
      set({
        affinityConnection: { reachable: false, version: null, docCount: 0, error: null },
      });
    }
  },

  setMotionPref: (motionPref) => {
    set({ motionPref });
    applyMotionPref(motionPref);
    persistPrefs(get);
  },

  setSoundPref: (soundPref) => {
    set({ soundPref });
    setSoundLevel(soundPref);
    persistPrefs(get);
  },

  setThemePref: (themePref) => {
    set({ themePref });
    applyTheme(themePref, true);
    persistPrefs(get);
  },

  setLocalePref: (localePref) => {
    set({ localePref });
    applyLocalePref(localePref);
    persistPrefs(get);
  },

  setBulkTagFor: (bulkTagFor) => set({ bulkTagFor }),

  startTour: () => set({ tourStep: 0 }),
  setTourStep: (tourStep) => set({ tourStep }),
  endTour: () => {
    set({ tourStep: null, onboarded: true, selectedFamily: null, selection: [] });
    persistPrefs(get);
  },

  applyTagToFamilies: async (tag, families) => {
    const clean = tag.trim().toLowerCase();
    if (!clean) return;
    const all = families.every((f) => (get().tags[f] ?? []).includes(clean));
    for (const family of families) {
      const current = get().tags[family] ?? [];
      const next = all
        ? current.filter((t) => t !== clean)
        : current.includes(clean)
          ? current
          : [...current, clean];
      if (next !== current) await get().setFamilyTags(family, next);
    }
  },

  toggleTagForFamily: async (tag, family) => {
    const current = get().tags[family] ?? [];
    const next = current.includes(tag)
      ? current.filter((t) => t !== tag)
      : [...current, tag];
    await get().setFamilyTags(family, next);
  },

  setDuplicateReport: (duplicateReport) => set({ duplicateReport }),

  setPanelWidth: (panelWidth) => {
    set({ panelWidth: Math.min(560, Math.max(300, panelWidth)) });
    persistPrefs(get);
  },

  setSidebarWidth: (sidebarWidth) => {
    set({
      sidebarWidth: Math.min(
        SIDEBAR_WIDTH_MAX,
        Math.max(SIDEBAR_WIDTH_MIN, sidebarWidth),
      ),
    });
    persistPrefs(get);
  },

  setSampleText: (sampleText) => {
    set({ sampleText });
    persistPrefs(get);
  },
  setSizeIndex: (sizeIndex) => {
    set({ sizeIndex });
    persistPrefs(get);
  },
  setViewMode: (viewMode) => {
    set({ viewMode });
    persistPrefs(get);
  },
  setSort: (sort) => {
    set({ sort });
    persistPrefs(get);
  },
  setSearch: (search) => set({ search }),
  toggleClassFilter: (c) => {
    const cur = get().classFilter;
    set({ classFilter: cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c] });
  },
  toggleScriptFilter: (s) => {
    const cur = get().scriptFilter;
    set({ scriptFilter: cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s] });
  },
  setVariableOnly: (variableOnly) => set({ variableOnly }),

  exportLibraryData: async (dest) => {
    const { tags, collections, favorites, notes } = get();
    const payload = {
      app: "ZFontManager",
      version: 1,
      exportedAt: new Date().toISOString(),
      tags,
      collections,
      favorites,
      notes,
    };
    try {
      await ipc.writeTextFile(dest, JSON.stringify(payload, null, 2));
      toast.success(t("toast.libraryDataExported"), dest, "install");
    } catch (e) {
      toast.error(t("toast.exportFailed"), String(e));
    }
  },

  importLibraryData: async (src) => {
    try {
      const raw: unknown = JSON.parse(await ipc.readTextFile(src));
      const d = raw as Partial<{
        app: string;
        tags: Record<string, string[]>;
        collections: Record<string, string[]>;
        favorites: string[];
        notes: Record<string, string>;
      }>;
      if (d?.app !== "ZFontManager") {
        toast.error(t("toast.notAnExport"), t("toast.notAnExportSub"));
        return;
      }
      let touched = 0;
      const state = get();
      if (d.tags) {
        for (const [family, list] of Object.entries(d.tags)) {
          if (!Array.isArray(list)) continue;
          const existing = state.tags[family] ?? [];
          const merged = [...new Set([...existing, ...list.map(String)])];
          if (merged.length === existing.length) continue;
          await get().setFamilyTags(family, merged);
          touched++;
        }
      }
      if (d.collections) {
        for (const [name, members] of Object.entries(d.collections)) {
          if (!Array.isArray(members)) continue;
          const existing = get().collections[name];
          const merged = [...new Set([...(existing ?? []), ...members.map(String)])];
          if (existing && merged.length === existing.length) continue;
          set({ collections: { ...get().collections, [name]: merged } });
          await ipc.setCollection(name, merged);
          touched++;
        }
      }
      if (Array.isArray(d.favorites)) {
        for (const family of d.favorites.map(String)) {
          if (!get().favorites.includes(family)) {
            set({ favorites: [...get().favorites, family] });
            await ipc.setFavorite(family, true);
            touched++;
          }
        }
      }
      if (d.notes) {
        for (const [family, note] of Object.entries(d.notes)) {
          if (typeof note !== "string" || get().notes[family]) continue;
          await get().setFamilyNote(family, note);
          touched++;
        }
      }
      toast.success(
        t("toast.libraryDataImported"),
        t("toast.entriesMerged", { count: touched }),
        "restore",
      );
    } catch (e) {
      toast.error(t("toast.importFailed"), String(e));
    }
  },
  setNav: (nav) => {
    // Compatibility entry point (command palette, onboarding): an exclusive
    // jump — clears the other blocks and returns to the main area.
    if (nav.kind === "trash") {
      set({ area: "trash", selectedFamily: null, selection: [] });
      return;
    }
    if (nav.kind === "about") {
      set({ area: "about", selectedFamily: null, selection: [] });
      return;
    }
    if (nav.kind === "tag") {
      set({
        area: "main",
        browseSel: "library",
        colSel: [],
        tagSel: [nav.tag],
        foundrySel: [],
        selectedFamily: null,
        selection: [],
      });
      return;
    }
    if (nav.kind === "collection") {
      set({
        area: "main",
        browseSel: "library",
        colSel: [nav.name],
        tagSel: [],
        foundrySel: [],
        selectedFamily: null,
        selection: [],
      });
      return;
    }
    if (nav.kind === "foundry") {
      set({
        area: "main",
        browseSel: "library",
        colSel: [],
        tagSel: [],
        foundrySel: [nav.foundry],
        selectedFamily: null,
        selection: [],
      });
      return;
    }
    set({
      area: "main",
      browseSel: nav.kind,
      colSel: [],
      tagSel: [],
      foundrySel: [],
      selectedFamily: null,
      selection: [],
    });
  },
  setBrowse: (browseSel) =>
    set({ area: "main", browseSel, foundrySel: [], selectedFamily: null, selection: [] }),
  setFilterSel: (colSel, tagSel, foundrySel) =>
    set((s) => ({
      area: "main",
      colSel,
      tagSel,
      foundrySel: foundrySel ?? s.foundrySel,
      selectedFamily: null,
      selection: [],
    })),
  setArea: (area) => set({ area, selectedFamily: null, selection: [] }),
  select: (selectedFamily) =>
    set({ selectedFamily, selection: selectedFamily ? [selectedFamily] : [] }),
}));

const styleOrder = (f: FontFace) => f.weight * 2 + (f.italic ? 1 : 0);

export function computeFamilies(
  fonts: FontFace[],
  tags: Record<string, string[]>,
): Map<string, Family> {
  const map = new Map<string, Family>();
  for (const f of fonts) {
    let fam = map.get(f.family);
    if (!fam) {
      fam = {
        name: f.family,
        faces: [],
        formats: [],
        isVariable: false,
        active: false,
        deactivatable: false,
        tags: tags[f.family] ?? [],
        totalSize: 0,
        foundry: null,
        classification: "unknown",
        scripts: [],
      };
      map.set(f.family, fam);
    }
    fam.faces.push(f);
    if (!fam.formats.includes(f.format)) fam.formats.push(f.format);
    fam.isVariable ||= f.isVariable;
    fam.foundry ??= f.foundry;

    if (fam.classification === "unknown") fam.classification = f.classification;
    for (const s of f.scripts ?? []) {
      if (!fam.scripts.includes(s)) fam.scripts.push(s);
    }
    fam.active ||= f.active;
    fam.deactivatable ||= f.deactivatable;
    fam.totalSize += f.fileSize;
  }
  for (const fam of map.values()) {
    fam.faces.sort((a, b) => styleOrder(a) - styleOrder(b));
  }
  return map;
}

export function selectVisibleFamilies(s: {
  fonts: FontFace[];
  tags: Record<string, string[]>;
  collections: Record<string, string[]>;
  favorites: string[];
  sessionActivated: string[];
  affinityActivated: string[];
  lastImported: string[];
  notes: Record<string, string>;
  search: string;
  classFilter: Classification[];
  scriptFilter: string[];
  variableOnly: boolean;
  browse: BrowseKind;
  selCols: string[];
  selTags: string[];
  selFoundrys?: string[];
  sort: SortMode;
}): Family[] {
  const families = [...familiesFor(s.fonts, s.tags).values()];
  const q = s.search.trim().toLowerCase();
  let out = families;
  if (s.classFilter.length > 0) {
    out = out.filter((f) => s.classFilter.includes(f.classification));
  }
  if (s.scriptFilter.length > 0) {
    out = out.filter((f) => s.scriptFilter.every((sc) => f.scripts.includes(sc)));
  }
  if (s.variableOnly) {
    out = out.filter((f) => f.isVariable);
  }
  // Browse is the base set; selected collections/tags narrow it further.
  let browsePred: ((f: Family) => boolean) | null = null;
  if (s.browse === "favorites") browsePred = (f) => s.favorites.includes(f.name);
  if (s.browse === "lastImported") browsePred = (f) => s.lastImported.includes(f.name);
  if (s.browse === "activated") {
    browsePred = (f) =>
      f.active &&
      !s.sessionActivated.includes(f.name) &&
      !(f.faces.length > 0 && f.faces.every((face) => face.source === "system"));
  }
  if (s.browse === "activatedSession") {
    browsePred = (f) => s.sessionActivated.includes(f.name);
  }
  if (s.browse === "affinity") {
    browsePred = (f) => s.affinityActivated.includes(f.name);
  }
  if (s.browse === "deactivated") browsePred = (f) => !f.active;
  if (s.browse === "system") {
    browsePred = (f) =>
      f.faces.length > 0 && f.faces.every((face) => face.source === "system");
  }
  let groupPred: ((f: Family) => boolean) | null = null;
  // Collections and tags widen the view together (union), but a selected
  // foundry NARROWS that set: a family must belong to one of the selected
  // collections/tags AND come from one of the selected foundries. When only
  // foundries are selected they act as the filter on their own.
  const hasColTag = s.selCols.length > 0 || s.selTags.length > 0;
  const hasFoundry = (s.selFoundrys?.length ?? 0) > 0;
  if (hasColTag || hasFoundry) {
    const members = new Set(s.selCols.flatMap((c) => s.collections[c] ?? []));
    const foundryGroups = hasFoundry ? foundryGroupsFor(familiesFor(s.fonts, s.tags)) : null;
    const inColOrTag = (f: Family) =>
      members.has(f.name) || s.selTags.some((tg) => f.tags.includes(tg));
    const inFoundry = (f: Family) =>
      s.selFoundrys!.includes(foundryGroups!.get(f.foundry ?? "") ?? f.foundry ?? "");
    groupPred =
      hasColTag && hasFoundry
        ? (f) => inColOrTag(f) && inFoundry(f)
        : hasColTag
          ? inColOrTag
          : inFoundry;
  }
  if (browsePred || groupPred) {
    out = out.filter(
      (f) => (!browsePred || browsePred(f)) && (!groupPred || groupPred(f)),
    );
  }
  if (q) {
    out = out.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        f.tags.some((t) => t.toLowerCase().includes(q)) ||
        f.formats.some((fmt) => fmt.includes(q)) ||
        (f.foundry?.toLowerCase().includes(q) ?? false) ||
        (s.notes[f.name]?.toLowerCase().includes(q) ?? false),
    );
  }
  switch (s.sort) {
    case "styles":
      out.sort((a, b) => b.faces.length - a.faces.length || a.name.localeCompare(b.name));
      break;
    case "size":
      out.sort((a, b) => b.totalSize - a.totalSize || a.name.localeCompare(b.name));
      break;
    default:
      out.sort((a, b) => a.name.localeCompare(b.name));
  }
  return out;
}

export function allTags(tags: Record<string, string[]>): Map<string, number> {
  const m = new Map<string, number>();
  for (const list of Object.values(tags)) {
    for (const t of list) m.set(t, (m.get(t) ?? 0) + 1);
  }
  return new Map([...m.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

export interface FontConflict {
  key: string;
  paths: string[];
}

const familyCache = new WeakMap<FontFace[], WeakMap<object, Map<string, Family>>>();

export function familiesFor(
  fonts: FontFace[],
  tags: Record<string, string[]>,
): Map<string, Family> {
  let byTags = familyCache.get(fonts);
  if (!byTags) {
    byTags = new WeakMap();
    familyCache.set(fonts, byTags);
  }
  let result = byTags.get(tags);
  if (!result) {
    result = computeFamilies(fonts, tags);
    byTags.set(tags, result);
  }
  return result;
}

const conflictCache = new WeakMap<FontFace[], Map<string, FontConflict[]>>();

const activeConflictCache = new WeakMap<FontFace[], Map<string, FontConflict[]>>();

/** Conflicts among ACTIVE fonts only: these are the ones apps can actually see. */
export function activeConflictsFor(fonts: FontFace[]): Map<string, FontConflict[]> {
  let cached = activeConflictCache.get(fonts);
  if (!cached) {
    cached = computeConflicts(fonts.filter((f) => f.active));
    activeConflictCache.set(fonts, cached);
  }
  return cached;
}

export function conflictsFor(fonts: FontFace[]): Map<string, FontConflict[]> {
  let cached = conflictCache.get(fonts);
  if (!cached) {
    cached = computeConflicts(fonts);
    conflictCache.set(fonts, cached);
  }
  return cached;
}

export function computeConflicts(fonts: FontFace[]): Map<string, FontConflict[]> {
  const byKey = new Map<string, { paths: Set<string>; families: Set<string> }>();
  for (const f of fonts) {
    const key = f.postscriptName ?? `${f.family} ${f.style}`;
    let entry = byKey.get(key);
    if (!entry) {
      entry = { paths: new Set(), families: new Set() };
      byKey.set(key, entry);
    }
    entry.paths.add(f.path);
    entry.families.add(f.family);
  }
  const out = new Map<string, FontConflict[]>();
  for (const [key, { paths, families }] of byKey) {
    if (paths.size < 2) continue;
    for (const fam of families) {
      const list = out.get(fam) ?? [];
      list.push({ key, paths: [...paths] });
      out.set(fam, list);
    }
  }
  return out;
}

export function allFoundrys(fonts: FontFace[]): string[] {
  const set = new Set<string>();
  for (const f of fonts) {
    if (f.foundry) set.add(f.foundry);
  }
  return [...set].sort();
}

// ---------------------------------------------------------------------------
// Foundry grouping
//
// Foundry strings read from font metadata vary a lot for the same company
// ("Dalton Maag" vs "Dalton Maag Ltd." vs "DaltonMaag"). Clustering them
// fuzzily keeps the sidebar to one entry per foundry: every raw variant maps
// to a canonical display name (the most frequent original spelling).
// ---------------------------------------------------------------------------

/** Legal/corporate words ignored when normalizing foundry names. */
const FOUNDRY_SUFFIXES = new Set([
  "ltd", "limited", "llc", "inc", "incorporated", "gmbh", "co", "corp",
  "corporation", "company", "sa", "ag", "bv", "nv", "plc", "kg", "ohg",
  "sas", "sarl", "srl", "spa", "ab", "as", "oy", "aps",
]);

/** Comparison key only: keep original metadata for display and search. */
function normalizeFoundry(name: string): string {
  const words = name
    .toLowerCase()
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}\p{M}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  // Only trailing corporate words are suffixes. Never erase an entire name.
  while (words.length > 1 && FOUNDRY_SUFFIXES.has(words[words.length - 1])) {
    words.pop();
  }
  return words.join("") || name.trim().toLowerCase();
}

const foundryGroupCache = new WeakMap<object, Map<string, string>>();

/**
 * Maps every raw foundry string appearing in the given families to its
 * canonical display name. Cached per families map, like `familiesFor`.
 */
export function foundryGroupsFor(
  families: Map<string, Family>,
): Map<string, string> {
  let groups = foundryGroupCache.get(families);
  if (!groups) {
    // Raw spelling -> how many families spell the foundry that way.
    const rawCounts = new Map<string, number>();
    for (const fam of families.values()) {
      if (fam.foundry) rawCounts.set(fam.foundry, (rawCounts.get(fam.foundry) ?? 0) + 1);
    }
    // Most frequent spelling first so the cluster's display name is the one
    // users see most; ties break alphabetically for stability.
    const sorted = [...rawCounts.entries()].sort(
      ([a, ca], [b, cb]) => cb - ca || a.localeCompare(b),
    );
    const clusters = new Map<string, string>();
    groups = new Map();
    for (const [raw] of sorted) {
      const norm = normalizeFoundry(raw);
      const display = clusters.get(norm) ?? raw;
      clusters.set(norm, display);
      groups.set(raw, display);
    }
    foundryGroupCache.set(families, groups);
  }
  return groups;
}

export function allFoundryCounts(fonts: FontFace[], tags: Record<string, string[]>): Map<string, number> {
  const fams = familiesFor(fonts, tags);
  const groups = foundryGroupsFor(fams);
  const m = new Map<string, number>();
  for (const fam of fams.values()) {
    if (!fam.foundry) continue;
    const key = groups.get(fam.foundry) ?? fam.foundry;
    m.set(key, (m.get(key) ?? 0) + 1);
  }
  return new Map([...m.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}


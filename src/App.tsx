import { getCurrentWindow } from "@tauri-apps/api/window";
import { MotionConfig, motion } from "motion/react";
import { Clock, FolderOpen, History, LoaderCircle, Monitor, Power, PowerOff, SearchX, Sparkles, Star, Tag as TagIcon, Type } from "lucide-react";
import { useEffect, useMemo } from "react";
import { DetailPanel } from "./components/DetailPanel";
import { Titlebar } from "./components/Titlebar";
import { DropZone } from "./components/DropZone";
import { FontGrid } from "./components/FontGrid";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { TrashView } from "./components/TrashView";
import { WaterfallView } from "./components/WaterfallView";
import { CompareOverlay } from "./components/CompareOverlay";
import { SettingsOverlay } from "./components/SettingsOverlay";
import { CommandPalette } from "./components/CommandPalette";
import { BulkTagPrompt } from "./components/BulkTagPrompt";
import { DuplicateDialog } from "./components/DuplicateDialog";
import { Onboarding } from "./components/Onboarding";
import { ContextMenuHost, openContextMenuAt } from "./design/primitives/ContextMenu";
import { buildFamilyMenu } from "./lib/menus";
import { Toaster } from "./design/primitives/Toast";
import { spring } from "./design/springs";
import { familiesFor, selectGoogleFamily, selectVisibleFamilies, useFontStore, type BrowseKind } from "./state/fontStore";
import { useT } from "./lib/i18n";
import { setFontPreviewEnabled } from "./lib/fontLoader";

// Live scan readout: a spinning loader plus the "reading N of M" counter. Used
// at the bottom of the first-run skeleton and, pinned above the content, while
// a background (re)scan runs so the list itself can stay in place.
function ScanStatus() {
  const t = useT();
  const { done, total } = useFontStore((s) => s.scanProgress);
  return (
    <div className="scan-progress tabular" role="status" aria-live="polite">
      <LoaderCircle size={13} strokeWidth={1.5} className="scan-spinner" aria-hidden="true" />
      {total > 0 ? t("scan.reading", { done, total }) : t("scan.finding")}
    </div>
  );
}

// Pinned to the bottom of the content column whenever the library is scanned
// while fonts are already on screen (file watcher, manual rescan, imports).
function ScanSkeleton() {
  return (
    <div className="scan-skeleton">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="skeleton skeleton-card" style={{ animationDelay: `${i * 0.08}s` }} />
      ))}
      <ScanStatus />
    </div>
  );
}

// Always-visible hint strip at the very bottom of the window, under every
// panel: spells out what the activation lamp does with each mouse button. The
// wording follows the swap setting so the bar never lies.
function InfoBar() {
  const t = useT();
  const swap = useFontStore((s) => s.settings.swapActivationButtons);
  return (
    <footer className="infobar" role="note">
      <span className="infobar-item">{t(swap ? "infobar.lampSwapped" : "infobar.lampDefault")}</span>
      <span className="infobar-sep" aria-hidden="true">
        ·
      </span>
      <span className="infobar-item">{t("infobar.capsLock")}</span>
    </footer>
  );
}

function EmptyLibrary({
  searching,
  browse,
  cols,
  tags,
}: {
  searching: boolean;
  browse: BrowseKind;
  cols: string[];
  tags: string[];
}) {
  const t = useT();

  let icon = <Type size={26} strokeWidth={1.5} />;
  let title = t("empty.library.title");
  let hint = t("empty.library.body");
  if (searching) {
    icon = <SearchX size={26} strokeWidth={1.5} />;
    title = t("empty.search.title");
    hint = t("empty.search.body");
  } else if (browse === "favorites") {
    icon = <Star size={26} strokeWidth={1.5} />;
    title = t("empty.favorites.title");
    hint = t("empty.favorites.body");
  } else if (browse === "lastImported") {
    icon = <History size={26} strokeWidth={1.5} />;
    title = t("empty.lastImported.title");
    hint = t("empty.lastImported.body");
  } else if (cols.length === 1 && tags.length === 0) {
    icon = <FolderOpen size={26} strokeWidth={1.5} />;
    title = t("empty.collection.title");
    hint = t("empty.collection.body", { name: cols[0] });
  } else if (tags.length === 1 && cols.length === 0) {
    icon = <TagIcon size={26} strokeWidth={1.5} />;
    title = t("empty.tag.title");
    hint = t("empty.tag.body");
  } else if (browse === "activated") {
    icon = <Power size={26} strokeWidth={1.5} />;
    title = t("empty.activated.title");
    hint = t("empty.activated.body");
  } else if (browse === "activatedSession") {
    icon = <Clock size={26} strokeWidth={1.5} />;
    title = t("empty.session.title");
    hint = t("empty.session.body");
  } else if (browse === "affinity") {
    icon = <Sparkles size={26} strokeWidth={1.5} />;
    title = t("empty.affinity.title");
    hint = t("empty.affinity.body");
  } else if (browse === "deactivated") {
    icon = <PowerOff size={26} strokeWidth={1.5} />;
    title = t("empty.deactivated.title");
    hint = t("empty.deactivated.body");
  } else if (browse === "system") {
    icon = <Monitor size={26} strokeWidth={1.5} />;
    title = t("empty.system.title");
    hint = t("empty.system.body");
  }
  return (
    <motion.div
      className="empty-state"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
    >
      <span className="empty-tile">{icon}</span>
      <h2>{title}</h2>
      <p>{hint}</p>
    </motion.div>
  );
}

function MainContent() {
  const phase = useFontStore((s) => s.phase);
  const area = useFontStore((s) => s.area);
  const browse = useFontStore((s) => s.browseSel);
  const colSel = useFontStore((s) => s.colSel);
  const tagSel = useFontStore((s) => s.tagSel);
  const viewMode = useFontStore((s) => s.viewMode);
  const fonts = useFontStore((s) => s.fonts);
  const tags = useFontStore((s) => s.tags);
  const collections = useFontStore((s) => s.collections);
  const favorites = useFontStore((s) => s.favorites);
  const sessionActivated = useFontStore((s) => s.sessionActivated);
  const sessionActivatedPaths = useFontStore((s) => s.sessionActivatedPaths);
  const affinityActivated = useFontStore((s) => s.affinityActivated);
  const lastImported = useFontStore((s) => s.lastImported);
  const notes = useFontStore((s) => s.notes);
  const search = useFontStore((s) => s.search);
  const classFilter = useFontStore((s) => s.classFilter);
  const scriptFilter = useFontStore((s) => s.scriptFilter);
  const variableOnly = useFontStore((s) => s.variableOnly);
  const sort = useFontStore((s) => s.sort);
  const googleCatalog = useFontStore((s) => s.googleCatalog);
  const googleMeta = useFontStore((s) => s.googleMeta);

  const foundrySel = useFontStore((s) => s.foundrySel);
  const families = useMemo(
    () =>
      selectVisibleFamilies({
        fonts, tags, collections, favorites, sessionActivated, sessionActivatedPaths, affinityActivated, lastImported, notes, search,
        classFilter, scriptFilter, variableOnly, browse, selCols: colSel, selTags: tagSel, selFoundrys: foundrySel, sort,
        googleCatalog, googleMeta,
      }),
    [fonts, tags, collections, favorites, sessionActivated, sessionActivatedPaths, affinityActivated, lastImported, notes, search, classFilter, scriptFilter, variableOnly, browse, colSel, tagSel, foundrySel, sort, googleCatalog, googleMeta],
  );

  const visibleOrder = useMemo(() => families.map((f) => f.name), [families]);

  useEffect(() => {
    const state = useFontStore.getState();
    const selectedInView = state.selection.filter((family) => visibleOrder.includes(family));
    // Entering a non-empty list starts on its first font. Subsequent plain
    // clicks still replace this with exactly one selection; modifiers extend it.
    const nextSelection = selectedInView.length > 0 ? selectedInView : visibleOrder.slice(0, 1);
    useFontStore.setState({
      visibleOrder,
      selection: nextSelection,
      selectedFamily: nextSelection[nextSelection.length - 1] ?? null,
    });
  }, [visibleOrder]);

  if (area === "trash") return <TrashView />;
  // Only blank the content area while there is nothing to show yet (first run).
  // Refreshes — the file watcher, or the manual rescan button — now happen in
  // the background: the current library stays on screen and the fresh data is
  // swapped in when it lands.
  if (phase === "scanning" && fonts.length === 0) return <ScanSkeleton />;
  if (families.length === 0)
    return (
      <EmptyLibrary
        browse={browse}
        cols={colSel}
        tags={tagSel}
        searching={
          search.trim().length > 0 ||
          classFilter.length > 0 ||
          scriptFilter.length > 0 ||
          variableOnly
        }
      />
    );
  if (viewMode === "waterfall") return <WaterfallView families={families} />;
  return <FontGrid families={families} />;
}

export default function App() {
  const init = useFontStore((s) => s.init);
  const motionPref = useFontStore((s) => s.motionPref);
  const scanReady = useFontStore((s) => s.phase === "ready");

  useEffect(() => {
    void init();

    const window = getCurrentWindow();
    void window.unminimize();
    void window.show();
    void window.center();
    void window.setFocus();
  }, [init]);

  useEffect(() => {
    setFontPreviewEnabled(scanReady);
  }, [scanReady]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inField =
        e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (e.key === "Escape" && !inField) {
        const st = useFontStore.getState();
        st.setComparePicking(false);
        st.select(null);
      }
      if (e.key === "/" && !inField) {
        e.preventDefault();
        document.getElementById("global-search")?.focus();
      }
      if (e.key === "?" && !inField) {
        e.preventDefault();
        const st = useFontStore.getState();
        if (st.settingsOpen && st.settingsCategory === "shortcuts") {
          st.setSettingsOpen(false);
        } else {
          st.setSettingsOpen(true, "shortcuts");
        }
      }

      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        const st = useFontStore.getState();
        st.setPaletteOpen(!st.paletteOpen);
      }

      const arrows = ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"];
      if (arrows.includes(e.key) && !inField) {
        const st = useFontStore.getState();
        if (st.compare || st.settingsOpen) return;
        const order = st.visibleOrder;
        if (order.length === 0) return;
        e.preventDefault();
        const anchor =
          st.selection.length > 0 ? st.selection[st.selection.length - 1] : null;
        const cur = anchor ? order.indexOf(anchor) : -1;
        const next =
          e.key === "Home" ? 0
          : e.key === "End" ? order.length - 1
          : e.key === "ArrowDown" || e.key === "ArrowRight"
            ? Math.min(cur + 1, order.length - 1)
            : Math.max(cur - 1, 0);
        st.selectWith(order[next], e.shiftKey ? "range" : "single", order);
      }
      if (e.key === " " && !inField) {
        const st = useFontStore.getState();
        const target =
          st.selection.length === 1 ? st.selection[0] : st.selectedFamily;
        if (st.compare || st.settingsOpen || !target) return;
        e.preventDefault();
        const fam = selectGoogleFamily(st, target) ?? familiesFor(st.fonts, st.tags).get(target);
        if (fam?.deactivatable) {
          void st.setFamilyActive(fam.name, !fam.active);
        }
      }

      if ((e.key === "a" || e.key === "A") && !inField && (e.ctrlKey || e.metaKey)) {
        const st = useFontStore.getState();
        if (st.compare || st.settingsOpen || st.paletteOpen) return;
        if (st.viewMode !== "grid") return;
        if (st.visibleOrder.length === 0) return;
        e.preventDefault();
        st.selectAllVisible();
      }

      if ((e.key === "c" || e.key === "C") && !inField && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const st = useFontStore.getState();
        if (st.compare || st.settingsOpen || st.selection.length < 2) return;
        e.preventDefault();
        st.openCompare(st.selection);
      }

      if ((e.key === "f" || e.key === "F") && !inField && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const st = useFontStore.getState();
        const target =
          st.selection.length === 1 ? st.selection[0] : st.selectedFamily;
        if (st.compare || st.settingsOpen || !target) return;
        e.preventDefault();
        void st.toggleFavorite(target);
      }
      if (e.key === "Delete" && !inField) {
        const st = useFontStore.getState();
        if (st.compare || st.settingsOpen) return;
        const doomed = st.selection.length > 0
          ? st.selection
          : st.selectedFamily ? [st.selectedFamily] : [];
        if (doomed.length === 0) return;
        e.preventDefault();
        for (const name of doomed) void st.uninstallFamily(name);
      }

      if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
        const st = useFontStore.getState();
        const target =
          st.selection.length === 1 ? st.selection[0] : st.selectedFamily;
        if (inField || st.compare || st.settingsOpen || !target) return;
        e.preventDefault();
        const fam = selectGoogleFamily(st, target) ?? familiesFor(st.fonts, st.tags).get(target);
        if (!fam) return;
        const card = document.querySelector(`[data-family="${CSS.escape(fam.name)}"]`);
        const r = card?.getBoundingClientRect();
        openContextMenuAt(
          r ? r.left + Math.min(r.width / 2, 240) : window.innerWidth / 2,
          r ? Math.min(r.top + 40, window.innerHeight - 80) : window.innerHeight / 2,
          buildFamilyMenu(fam),
        );
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <MotionConfig reducedMotion={motionPref === "reduced" ? "always" : "user"}>
      <div className="app-frame">
        <Titlebar />
        <div className="app-shell">
          <Sidebar />
          <div className="app-main">
            <TopBar />
            <div className="app-workspace">
              <main className="app-content">
                <MainContent />
              </main>
              <DetailPanel />
            </div>
          </div>
        </div>
        <InfoBar />

      </div>
      <DropZone />
      <CompareOverlay />
      <SettingsOverlay />
      <CommandPalette />
      <BulkTagPrompt />
      <Onboarding />
      <ContextMenuHost />
      <DuplicateDialog />
      <Toaster />
    </MotionConfig>
  );
}

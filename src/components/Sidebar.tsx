import { motion, AnimatePresence } from "motion/react";
import { Building2, ChevronDown, ChevronRight, Clock, FolderOpen, GripVertical, History, Library, Monitor, Plus, Power, PowerOff, RotateCcw, Settings, Sparkles, Star, Tag, Trash2, Globe2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { openContextMenu } from "../design/primitives/ContextMenu";
import { spring, springSoft, staggerDelay } from "../design/springs";
import { SIDEBAR_WIDTH_DEFAULT, SIDEBAR_WIDTH_MAX, SIDEBAR_WIDTH_MIN, allFoundryCounts, allTags, familiesFor, foundryGroupsFor, useFontStore, type BrowseKind, type Family } from "../state/fontStore";
import { exportFontList } from "../lib/menus";
import { t as translate, useT } from "../lib/i18n";
import { APP_VERSION } from "../lib/version";

// Anchor for shift+click range selection, and the key of the last picked
// row — it owns the gliding pill inside a multi-selected section.
let sidebarAnchor: { list: "cols" | "tags" | "foundrys"; name: string } | null = null;
let sidebarLead: string | null = null;

function NavRow({
  active,
  lead,
  pillId,
  onPick,
  icon,
  label,
  count,
  index,
  onContextMenu,
  related,
  pulsing,
  rowRef,
  dataTour,
  tag,
  onDropFamilies,
  onClear,
}: {
  active: boolean;
  lead: boolean;
  pillId: string;
  onPick: (e: React.MouseEvent) => void;
  icon?: React.ReactNode;
  label: string;
  count?: React.ReactNode;
  index: number;
  onContextMenu?: (e: React.MouseEvent) => void;
  /** The row belongs to the currently selected family (accent-tinted). */
  related?: boolean;
  pulsing?: boolean;
  /** Ref sink so the sidebar can scroll the row into view. */
  rowRef?: (el: HTMLElement | null) => void;
  dataTour?: string;
  /** Tags use the same outlined chip treatment as font-card tags. */
  tag?: boolean;
  onDropFamilies?: (families: string[]) => void;
  onClear?: () => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const dropTargetRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!onDropFamilies) return;
    const handleDrop = (event: Event) => {
      const target = event.target as HTMLElement;
      const families = (event as CustomEvent<string[]>).detail;
      if (target === dropTargetRef.current && Array.isArray(families)) onDropFamilies(families);
    };
    document.addEventListener("fontolo-drop-families", handleDrop);
    return () => document.removeEventListener("fontolo-drop-families", handleDrop);
  }, [onDropFamilies]);
  return (
    <motion.button
      ref={(el) => {
        dropTargetRef.current = el;
        rowRef?.(el);
      }}
      data-tour={dataTour}
      data-family-row={related ? label : undefined}
      data-font-drop-target={onDropFamilies ? true : undefined}
      className={`nav-row ${tag ? "nav-tag" : ""} ${active ? "nav-active" : ""} ${related ? "nav-related" : ""} ${pulsing ? "nav-sync-pulse" : ""} ${dragOver ? "nav-drop-target" : ""}`}
      onClick={onPick}
      onContextMenu={onContextMenu}
      onDragEnter={(e) => {
        if (!onDropFamilies) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragOver={(e) => {
        if (!onDropFamilies) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragOver(false);
      }}
      onDrop={(e) => {
        setDragOver(false);
        if (!onDropFamilies) return;
        e.preventDefault();
        try {
          const raw =
            e.dataTransfer.getData("application/x-fontolo-families") ||
            e.dataTransfer.getData("application/json") ||
            e.dataTransfer.getData("text/plain");
          const families = raw.startsWith("[")
            ? JSON.parse(raw)
            : raw.startsWith("{")
              ? JSON.parse(raw).families
              : raw.split("\n").map((name) => name.trim()).filter(Boolean);
          if (Array.isArray(families) && families.every((name) => typeof name === "string")) onDropFamilies(families);
        } catch { /* Ignore drops that did not originate in Fontolo. */ }
      }}
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ ...springSoft, delay: staggerDelay(index) }}
      whileTap={{ scale: 0.97 }}
    >
      {active && lead && (
        <motion.span className="nav-pill" layoutId={pillId} transition={spring} />
      )}
      {active && !lead && <span className="nav-pill" />}
      {icon && <span className="nav-icon">{icon}</span>}
      <span className="nav-label">{label}</span>
      {count !== undefined && <span className="nav-count tabular">{count}</span>}
      {active && onClear && (
        <span
          className="nav-clear"
          role="button"
          tabIndex={0}
          aria-label="Clear tag filter"
          onClick={(e) => {
            e.stopPropagation();
            onClear();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              onClear();
            }
          }}
        >
          ×
        </span>
      )}
    </motion.button>
  );
}

/**
 * Small round chip beside a section heading; visible only while the section
 * owns an active filter. Click clears that filter block.
 */
function SectionReset({ show, label, onReset }: { show: boolean; label: string; onReset: () => void }) {
  if (!show) return null;
  return (
    <motion.button
      className="sidebar-reset"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onReset();
      }}
      initial={{ opacity: 0, scale: 0.6 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.6 }}
      transition={springSoft}
      whileTap={{ scale: 0.85 }}
    >
      {/* Nearly-closed circular arrow — the app's reset icon (same as the
          detail panel's Reset action). */}
      <RotateCcw size={12} strokeWidth={2} />
    </motion.button>
  );
}

function ScannedFamilyCount() {
  const count = useFontStore((s) => s.scanProgress.families);
  return <>{count}</>;
}

function NewCollectionInput({ onDone }: { onDone: () => void }) {
  const t = useT();
  const createCollection = useFontStore((s) => s.createCollection);
  const [name, setName] = useState("");
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => ref.current?.focus(), []);

  const commit = () => {
    if (name.trim()) void createCollection(name);
    onDone();
  };

  return (
    <motion.div
      className="collection-input"
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
    >
      <FolderOpen size={15} strokeWidth={1.5} />
      <input
        ref={ref}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") onDone();
        }}
        onBlur={commit}
        placeholder={t("side.collectionPlaceholder")}
        aria-label={t("side.newCollectionAria")}
        spellCheck={false}
        autoComplete="off"
      />
    </motion.div>
  );
}

function RenameInput({
  initial,
  onCommit,
  onCancel,
  icon = <FolderOpen size={15} strokeWidth={1.5} />,
}: {
  initial: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
  icon?: React.ReactNode;
}) {
  const t = useT();
  const [name, setName] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const committed = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const commit = () => {
    if (committed.current) return;
    committed.current = true;
    onCommit(name);
  };
  const cancel = () => {
    committed.current = true;
    onCancel();
  };
  return (
    <div className="collection-input">
      {icon}
      <input
        ref={ref}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") cancel();
        }}
        onBlur={commit}
        aria-label={t("side.renameAria")}
        spellCheck={false}
        autoComplete="off"
      />
    </div>
  );
}

export function Sidebar() {
  const t = useT();
  const fonts = useFontStore((s) => s.fonts);
  const tags = useFontStore((s) => s.tags);
  const protectedTags = useFontStore((s) => s.protectedTags);
  const collections = useFontStore((s) => s.collections);
  const favorites = useFontStore((s) => s.favorites);
  const lastImported = useFontStore((s) => s.lastImported);
  const trash = useFontStore((s) => s.trash);
  const googleCatalog = useFontStore((s) => s.googleCatalog);
  const googleFontsProgress = useFontStore((s) => s.googleFontsProgress);
  const scanning = useFontStore((s) => s.phase === "scanning");
  const deleteCollection = useFontStore((s) => s.deleteCollection);
  const renameCollection = useFontStore((s) => s.renameCollection);
  const renameTag = useFontStore((s) => s.renameTag);
  const setFamilyTags = useFontStore((s) => s.setFamilyTags);
  const pendingCollectionFor = useFontStore((s) => s.pendingCollectionFor);

  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renamingTag, setRenamingTag] = useState<string | null>(null);
  // Section open/closed states live in the store so they are persisted with
  // the other prefs and the sidebar comes back as the user left it.
  const sidebarSections = useFontStore((s) => s.sidebarSections);
  const setSidebarSection = useFontStore((s) => s.setSidebarSection);
  const browseOpen = sidebarSections.browse;
  const collectionsOpen = sidebarSections.collections;
  const tagsOpen = sidebarSections.tags;
  const foundryOpen = sidebarSections.foundry;

  useEffect(() => {
    if (pendingCollectionFor) setCreating(true);
  }, [pendingCollectionFor]);

  const familyCount = familiesFor(fonts, tags).size;
  const sessionActivated = useFontStore((s) => s.sessionActivated);
  const affinityActivated = useFontStore((s) => s.affinityActivated);
  const allFamilies = [...familiesFor(fonts, tags).values()];
  const activatedCount = allFamilies.filter(
    (f) => f.active && !sessionActivated.includes(f.name),
  ).length;
  const sessionCount = allFamilies.filter((f) =>
    sessionActivated.includes(f.name),
  ).length;
  const affinityCount = allFamilies.filter((f) =>
    affinityActivated.includes(f.name),
  ).length;
  const deactivatedCount = allFamilies.filter((f) => !f.active).length;
  const systemCount = allFamilies.filter(
    (f) => f.faces.length > 0 && f.faces.every((face) => face.source === "system"),
  ).length;
  // The Google entry counts families in the catalogue; the ones already
  // installed into the library are marked with their own metadata.
  const googleFontsCount = googleCatalog.length > 0
    ? googleCatalog.length
    : allFamilies.filter((f) => f.faces.some((face) => face.source === "google")).length;
  const tagCounts = allTags(tags);
  const foundryCounts = allFoundryCounts(fonts, tags);
  // Foundries with more than one family come first (largest count first),
  // then a divider, then the singletons in ABC order.
  const foundryMulti = [...foundryCounts.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const foundrySingle = [...foundryCounts.entries()]
    .filter(([, count]) => count <= 1)
    .sort((a, b) => a[0].localeCompare(b[0]));
  const renderFoundryRow = ([foundry, count]: [string, number]) => (
    <NavRow
      key={foundry}
      active={foundrySel.includes(foundry)}
      lead={foundryLead === foundry}
      pillId="nav-pill-foundry"
      onPick={(e) => pickFromList(e, "foundrys", foundry)}
      icon={<Building2 size={15} strokeWidth={1.5} />}
      label={foundry}
      count={count}
      index={i++}
      related={hasRelated && related.foundry === foundry}
      rowRef={hasRelated && related.foundry === foundry ? setRowRef(`${focused}|f:${foundry}`) : undefined}
    />
  );
  const collectionNames = Object.keys(collections).sort((a, b) => a.localeCompare(b));
  const browse = useFontStore((s) => s.browseSel);
  const colSel = useFontStore((s) => s.colSel);
  const tagSel = useFontStore((s) => s.tagSel);
  const foundrySel = useFontStore((s) => s.foundrySel);
  const area = useFontStore((s) => s.area);
  const setBrowse = useFontStore((s) => s.setBrowse);
  const setFilterSel = useFontStore((s) => s.setFilterSel);
  const setArea = useFontStore((s) => s.setArea);
  const setSettingsOpen = useFontStore((s) => s.setSettingsOpen);
  const sidebarWidth = useFontStore((s) => s.sidebarWidth);
  const setSidebarWidth = useFontStore((s) => s.setSidebarWidth);

  // Drag resizes the aside node directly (no re-render per mousemove, so the
  // accent pill and rows never re-animate mid-drag); the store — and the
  // persisted pref — is updated once on release.
  const onSidebarResizeDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const grip = e.currentTarget as HTMLElement;
      const aside = grip.parentElement;
      if (!aside) return;
      grip.setPointerCapture(e.pointerId);
      aside.classList.add("sidebar-resizing");
      const startX = e.clientX;
      const startW = useFontStore.getState().sidebarWidth;
      let liveW = startW;
      const onMove = (ev: PointerEvent) => {
        liveW = Math.min(
          SIDEBAR_WIDTH_MAX,
          Math.max(SIDEBAR_WIDTH_MIN, startW + ev.clientX - startX),
        );
        aside.style.width = `${liveW}px`;
      };
      const onUp = () => {
        aside.classList.remove("sidebar-resizing");
        setSidebarWidth(liveW);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [setSidebarWidth],
  );

  // ---- Selected-family ties ---------------------------------------------
  // When a family is selected, the sidebar highlights its tags, foundry and
  // collections in accent color and scrolls the first matching row into view.
  // Auto-scroll only happens for a section whose filter is NOT manually
  // selected (scrolling a manually picked filter away would be confusing).
  const selectedFamily = useFontStore((s) => s.selectedFamily);
  const selection = useFontStore((s) => s.selection);
  const focused =
    selection.length === 1 ? selection[0] : (selectedFamily ?? selection[0] ?? null);

  const related = useMemo(() => {
    const fam = focused ? familiesFor(fonts, tags).get(focused) : undefined;
    const group = fam?.foundry
      ? (foundryGroupsFor(familiesFor(fonts, tags)).get(fam.foundry) ?? fam.foundry)
      : null;
    // Rows already picked as manual filters keep their active pill — never
    // pile the related tint on top of it (the two combined invert to
    // unreadable).
    return {
      cols: focused
        ? Object.entries(collections)
            .filter(([, members]) => members.includes(focused))
            .map(([name]) => name)
            .filter((name) => !colSel.includes(name))
        : [],
      tags: (fam?.tags ?? []).filter((tag) => !tagSel.includes(tag)),
      foundry: group && !foundrySel.includes(group) ? group : null,
    };
  }, [focused, fonts, tags, collections, colSel, tagSel, foundrySel]);
  const hasRelated =
    related.cols.length > 0 || related.tags.length > 0 || related.foundry !== null;

  // Scroll the selected family's first related row into view. A section whose
  // filter is manually selected is skipped — the user placed that view on
  // purpose, auto-scrolling away from it would be confusing.
  const rowRefs = useRef(new Map<string, HTMLElement | null>());
  const setRowRef = (key: string) => (el: HTMLElement | null) => {
    if (el) rowRefs.current.set(key, el);
    else rowRefs.current.delete(key);
  };
  useEffect(() => {
    if (!focused) return;
    // Refs of the previous family are gone anyway (the rowRef prop moved on);
    // drop them so stale rows never win the scroll.
    for (const key of [...rowRefs.current.keys()]) {
      if (!key.startsWith(focused + "|")) rowRefs.current.delete(key);
    }
    const rank = (k: string) => (k.includes("|c:") ? 0 : k.includes("|t:") ? 1 : 2);
    const skip = (k: string) =>
      k.includes("|c:") ? colSel.length > 0
      : k.includes("|t:") ? tagSel.length > 0
      : foundrySel.length > 0;
    const first = [...rowRefs.current.keys()]
      .filter((k) => !skip(k))
      .sort((a, b) => rank(a) - rank(b))[0];
    rowRefs.current.get(first ?? "")?.scrollIntoView({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused]);

  const pickBrowse = (b: BrowseKind) => {
    if (b === "library") {
      // Keep active filters while returning to the library.
      setBrowse("library");
    } else {
      setBrowse(b);
    }
    sidebarLead = b;
    sidebarAnchor = null;
  };

  const pickFromList = (
    e: React.MouseEvent,
    list: "cols" | "tags" | "foundrys",
    name: string,
  ) => {
    const st = useFontStore.getState();
    const names =
      list === "cols"
        ? collectionNames
        : list === "tags"
          ? [...tagCounts.keys()]
          : [...foundryCounts.keys()];
    const sel =
      list === "cols" ? st.colSel : list === "tags" ? st.tagSel : st.foundrySel;
    if (e.shiftKey) {
      if (sidebarAnchor && sidebarAnchor.list === list && names.includes(sidebarAnchor.name)) {
        const a = names.indexOf(sidebarAnchor.name);
        const b = names.indexOf(name);
        const range = names.slice(Math.min(a, b), Math.max(a, b) + 1);
        const merged = [...sel];
        for (const r of range) if (!merged.includes(r)) merged.push(r);
        if (list === "cols") setFilterSel(merged, st.tagSel, st.foundrySel);
        else if (list === "tags") setFilterSel(st.colSel, merged, st.foundrySel);
        else setFilterSel(st.colSel, st.tagSel, merged);
      } else if (list === "cols") {
        setFilterSel([name], st.tagSel, st.foundrySel);
        sidebarAnchor = { list, name };
      } else if (list === "tags") {
        setFilterSel(st.colSel, [name], st.foundrySel);
        sidebarAnchor = { list, name };
      } else {
        setFilterSel(st.colSel, st.tagSel, [name]);
        sidebarAnchor = { list, name };
      }
    } else if (e.ctrlKey || e.metaKey) {
      const next = sel.includes(name) ? sel.filter((n) => n !== name) : [...sel, name];
      if (list === "cols") setFilterSel(next, st.tagSel, st.foundrySel);
      else if (list === "tags") setFilterSel(st.colSel, next, st.foundrySel);
      else setFilterSel(st.colSel, st.tagSel, next);
      sidebarAnchor = { list, name };
    } else if (list === "cols") {
      // Plain click on an already selected row removes it; otherwise isolates it.
      setFilterSel(sel.includes(name) ? sel.filter((n) => n !== name) : [name], st.tagSel, st.foundrySel);
      sidebarAnchor = { list, name };
    } else if (list === "tags") {
      setFilterSel(st.colSel, sel.includes(name) ? sel.filter((n) => n !== name) : [name], st.foundrySel);
      sidebarAnchor = { list, name };
    } else {
      setFilterSel(st.colSel, st.tagSel, sel.includes(name) ? sel.filter((n) => n !== name) : [name]);
      sidebarAnchor = { list, name };
    }
    const prefix = list === "cols" ? "col" : list === "tags" ? "tag" : "foundry";
    sidebarLead = `${prefix}:${name}`;
  };

  // The lead row owns the gliding pill; extra multi-selections get a static one.
  const colLead =
    sidebarLead?.startsWith("col:") && colSel.includes(sidebarLead.slice(4))
      ? sidebarLead.slice(4)
      : colSel[0];
  const tagLead =
    sidebarLead?.startsWith("tag:") && tagSel.includes(sidebarLead.slice(4))
      ? sidebarLead.slice(4)
      : tagSel[0];
  const foundryLead =
    sidebarLead?.startsWith("foundry:") && foundrySel.includes(sidebarLead.slice(8))
      ? sidebarLead.slice(8)
      : foundrySel[0];

  const removeTagEverywhere = (tag: string) => {
    if (protectedTags.includes(tag)) return;
    for (const [family, list] of Object.entries(tags)) {
      if (list.includes(tag)) {
        void setFamilyTags(family, list.filter((t) => t !== tag));
      }
    }
    const st = useFontStore.getState();
    if (st.tagSel.includes(tag)) {
      useFontStore.setState({ tagSel: st.tagSel.filter((t) => t !== tag) });
    }
  };

  let i = 0;
  return (
    <motion.aside
      className="sidebar"
      style={{ width: sidebarWidth }}
      initial={{ x: -48, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={springSoft}
    >
      <div
        className="sidebar-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label={t("side.resize")}
        onPointerDown={onSidebarResizeDown}
        onDoubleClick={() => setSidebarWidth(SIDEBAR_WIDTH_DEFAULT)}
      >
        <GripVertical size={12} strokeWidth={1.5} />
      </div>
      <div className="sidebar-fixed">
      <div className="sidebar-section">
        <div className="sidebar-heading sidebar-heading-row">
          <button className="sidebar-heading sidebar-heading-collapsible" onClick={() => setSidebarSection("browse", !browseOpen)} aria-expanded={browseOpen} style={{ flex: 1 }}>
            <span className="sidebar-heading-chevron">{browseOpen ? <ChevronDown size={12} strokeWidth={2} /> : <ChevronRight size={12} strokeWidth={2} />}</span>
            <span>{t("side.browse")}</span>
          </button>
          <button className="sidebar-reset-all" onClick={() => { setBrowse("library"); setFilterSel([], [], []); }}>
            {t("side.resetAll")}
          </button>
        </div>
        <AnimatePresence initial={false}>
        {browseOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={springSoft}
            style={{ overflow: "hidden" }}
          >
        <NavRow
          active={browse === "library"}
          lead
          pillId="nav-pill-browse"
          onPick={() => pickBrowse("library")}
          icon={<Library size={15} strokeWidth={1.5} />}
          label={t("side.library")}
          count={scanning ? <ScannedFamilyCount /> : familyCount}
          index={i++}
          pulsing={scanning}
        />
        <NavRow
          active={browse === "favorites"}
          lead
          pillId="nav-pill-browse"
          onPick={() => pickBrowse("favorites")}
          icon={<Star size={15} strokeWidth={1.5} />}
          label={t("side.favorites")}
          count={favorites.length}
          index={i++}
          onDropFamilies={(families) => void useFontStore.getState().favoriteMany(families)}
        />
        <NavRow
          active={browse === "lastImported"}
          lead
          pillId="nav-pill-browse"
          onPick={() => pickBrowse("lastImported")}
          icon={<History size={15} strokeWidth={1.5} />}
          label={t("side.lastImported")}
          count={lastImported.length}
          index={i++}
        />
        <NavRow
          active={browse === "activated"}
          lead
          pillId="nav-pill-browse"
          onPick={() => pickBrowse("activated")}
          icon={<Power size={15} strokeWidth={1.5} />}
          label={t("side.activated")}
          count={activatedCount}
          index={i++}
          onDropFamilies={(families) => void useFontStore.getState().setFamiliesActiveBulk(families, true)}
        />
        <NavRow
          active={browse === "activatedSession"}
          lead
          pillId="nav-pill-browse"
          onPick={() => pickBrowse("activatedSession")}
          icon={<Clock size={15} strokeWidth={1.5} />}
          label={t("side.activatedUntilClose")}
          count={sessionCount}
          index={i++}
        />
        <NavRow
          active={browse === "affinity"}
          lead
          pillId="nav-pill-browse"
          onPick={() => pickBrowse("affinity")}
          icon={<Sparkles size={15} strokeWidth={1.5} />}
          label={t("side.affinityActivated")}
          count={affinityCount}
          index={i++}
        />
        <NavRow
          active={browse === "deactivated"}
          lead
          pillId="nav-pill-browse"
          onPick={() => pickBrowse("deactivated")}
          icon={<PowerOff size={15} strokeWidth={1.5} />}
          label={t("side.deactivated")}
          count={deactivatedCount}
          index={i++}
          onDropFamilies={(families) => void useFontStore.getState().setFamiliesActiveBulk(families, false)}
        />
        <NavRow
          active={browse === "system"}
          lead
          pillId="nav-pill-browse"
          onPick={() => pickBrowse("system")}
          icon={<Monitor size={15} strokeWidth={1.5} />}
          label={t("side.system")}
          count={systemCount}
          index={i++}
        />
        <NavRow
          active={browse === "googleFonts"}
          lead
          pillId="nav-pill-browse"
          onPick={() => pickBrowse("googleFonts")}
          icon={<Globe2 size={15} strokeWidth={1.5} />}
          label={t("side.googleFonts")}
          count={googleFontsProgress.phase === "checking"
            ? googleFontsProgress.done
            : googleFontsCount}
          index={i++}
          related={googleFontsProgress.phase === "checking"}
          pulsing={googleFontsProgress.phase === "checking"}
        />
          </motion.div>
        )}
        </AnimatePresence>
      </div>
      <div className="sidebar-fixed-divider" role="separator" />
      </div>
      <div className="sidebar-scroll">

      <div className="sidebar-section">
        <div className="sidebar-heading sidebar-heading-row">
          <button className="sidebar-heading sidebar-heading-collapsible" onClick={() => setSidebarSection("collections", !collectionsOpen)} aria-expanded={collectionsOpen} style={{ flex: 1 }}>
            <span className="sidebar-heading-chevron">{collectionsOpen ? <ChevronDown size={12} strokeWidth={2} /> : <ChevronRight size={12} strokeWidth={2} />}</span>
            <span>{t("side.collections")}</span>
          </button>
          <AnimatePresence>
            <SectionReset
              show={colSel.length > 0}
              label={t("side.resetFilter")}
              onReset={() => setFilterSel([], tagSel, foundrySel)}
            />
          </AnimatePresence>
          <motion.button
            className="sidebar-add"
            aria-label={t("side.newCollection")}
            onClick={() => setCreating(true)}
            whileTap={{ scale: 0.9 }}
          >
            <Plus size={13} strokeWidth={2} />
          </motion.button>
        </div>
        <AnimatePresence initial={false}>
        {collectionsOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={springSoft}
            style={{ overflow: "hidden" }}
          >
        {creating && (
          <NewCollectionInput
            onDone={() => {
              setCreating(false);
              useFontStore.setState({ pendingCollectionFor: null });
            }}
          />
        )}
        <div className="sidebar-list sidebar-cols">
        {collectionNames.map((name) =>
          renaming === name ? (
            <RenameInput
              key={name}
              initial={name}
              onCommit={(next) => {
                setRenaming(null);
                void renameCollection(name, next);
              }}
              onCancel={() => setRenaming(null)}
            />
          ) : (
            <NavRow
              key={name}
              active={colSel.includes(name)}
              lead={colLead === name}
              pillId="nav-pill-collections"
              onPick={(e) => pickFromList(e, "cols", name)}
              icon={<FolderOpen size={15} strokeWidth={1.5} />}
              label={name}
              count={(collections[name] ?? []).length}
              index={i++}
              onDropFamilies={(families) => {
                const st = useFontStore.getState();
                void Promise.all(families
                  .filter((family) => !(st.collections[name] ?? []).includes(family))
                  .map((family) => st.toggleFamilyInCollection(name, family)));
              }}
              related={hasRelated && related.cols.includes(name)}
              rowRef={hasRelated && related.cols.includes(name) ? setRowRef(`${focused}|c:${name}`) : undefined}
              onContextMenu={(e) =>
                openContextMenu(e, [
                  { label: translate("menu.rename"), action: () => setRenaming(name) },
                  {
                    label: translate("menu.exportFontList"),
                    action: () => {
                      const map = familiesFor(fonts, tags);
                      const fams = (collections[name] ?? [])
                        .map((n) => map.get(n))
                        .filter((f): f is Family => Boolean(f));
                      void exportFontList(fams, name);
                    },
                  },
                  { kind: "separator" },
                  {
                    label: translate("menu.deleteCollection"),
                    danger: true,
                    action: () => void deleteCollection(name),
                  },
                ])
              }
            />
          ),
        )}
        </div>
        {collectionNames.length === 0 && !creating && (
          <button className="sidebar-hint" onClick={() => setCreating(true)}>
            {t("side.firstCollection")}
          </button>
        )}
          </motion.div>
        )}
        </AnimatePresence>
      </div>

      {tagCounts.size > 0 && (
        <div className="sidebar-section">
          <div className="sidebar-heading sidebar-heading-row">
            <button className="sidebar-heading sidebar-heading-collapsible" onClick={() => setSidebarSection("tags", !tagsOpen)} aria-expanded={tagsOpen} style={{ flex: 1 }}>
              <span className="sidebar-heading-chevron">{tagsOpen ? <ChevronDown size={12} strokeWidth={2} /> : <ChevronRight size={12} strokeWidth={2} />}</span>
              <span>{t("side.tags")}</span>
            </button>
            <AnimatePresence>
              <SectionReset
                show={tagSel.length > 0 && !tagSel.some((tag) => protectedTags.includes(tag))}
                label={t("side.resetFilter")}
                onReset={() => setFilterSel(colSel, [], foundrySel)}
              />
            </AnimatePresence>
          </div>
          <AnimatePresence initial={false}>
          {tagsOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={springSoft}
              style={{ overflow: "hidden" }}
            >
          <div className="sidebar-list sidebar-cols">
          {[...tagCounts.entries()].map(([tag, count]) => (
            renamingTag === tag ? (
              <RenameInput
                key={tag}
                initial={tag}
                icon={<Tag size={15} strokeWidth={1.5} />}
                onCommit={(next) => {
                  setRenamingTag(null);
                  void renameTag(tag, next);
                }}
                onCancel={() => setRenamingTag(null)}
              />
            ) : (
              <NavRow
                key={tag}
                active={tagSel.includes(tag)}
                lead={tagLead === tag}
                pillId="nav-pill-tags"
                onPick={(e) => pickFromList(e, "tags", tag)}
                tag
                label={tag}
                count={count}
                index={i++}
                onClear={() => setFilterSel(colSel, tagSel.filter((name) => name !== tag), foundrySel)}
                onDropFamilies={(families) => void useFontStore.getState().applyTagToFamilies(tag, families)}
                related={hasRelated && related.tags.includes(tag)}
                rowRef={hasRelated && related.tags.includes(tag) ? setRowRef(`${focused}|t:${tag}`) : undefined}
                onContextMenu={
                  protectedTags.includes(tag)
                    ? undefined
                    : (e) =>
                        openContextMenu(e, [
                          {
                            label: translate("menu.renameTag"),
                            action: () => setRenamingTag(tag),
                          },
                          { kind: "separator" },
                          {
                            label: translate("menu.removeTagEverywhere", { tag }),
                            danger: true,
                            action: () => removeTagEverywhere(tag),
                          },
                        ])
                }
              />
            )
          ))}
          </div>
            </motion.div>
          )}
          </AnimatePresence>
        </div>
      )}

      {foundryCounts.size > 0 && (
        <div className="sidebar-section">
          <div className="sidebar-heading sidebar-heading-row">
            <button className="sidebar-heading sidebar-heading-collapsible" onClick={() => setSidebarSection("foundry", !foundryOpen)} aria-expanded={foundryOpen} style={{ flex: 1 }}>
              <span className="sidebar-heading-chevron">{foundryOpen ? <ChevronDown size={12} strokeWidth={2} /> : <ChevronRight size={12} strokeWidth={2} />}</span>
              <span>{t("side.foundry")}</span>
            </button>
            <AnimatePresence>
              <SectionReset
                show={foundrySel.length > 0}
                label={t("side.resetFilter")}
                onReset={() => setFilterSel(colSel, tagSel, [])}
              />
            </AnimatePresence>
          </div>
          <AnimatePresence initial={false}>
          {foundryOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={springSoft}
              style={{ overflow: "hidden" }}
            >
          <div className="sidebar-list sidebar-list-scrollable sidebar-cols">
          {foundryMulti.map(renderFoundryRow)}
          {foundryMulti.length > 0 && foundrySingle.length > 0 && (
            <div className="sidebar-divider" role="separator" />
          )}
          {foundrySingle.map(renderFoundryRow)}
          </div>
            </motion.div>
          )}
          </AnimatePresence>
        </div>
      )}
      </div>

      <div className="sidebar-footer">
        <NavRow
          active={area === "trash"}
          lead
          pillId="nav-pill-footer"
          onPick={() => setArea("trash")}
          icon={<Trash2 size={15} strokeWidth={1.5} />}
          label={t("side.trash")}
          count={trash.length}
          index={i++}
        />
        <NavRow
          active={false}
          lead
          pillId="nav-pill-footer"
          onPick={() => setSettingsOpen(true)}
          icon={<Settings size={15} strokeWidth={1.5} />}
          label={t("side.settings")}
          count={<span className="sidebar-version">v{APP_VERSION}</span>}
          index={i++}
          dataTour="settings"
        />
      </div>
    </motion.aside>
  );
}

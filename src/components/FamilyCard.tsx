import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, ChevronRight, Info, Star, X } from "lucide-react";
import { memo, useEffect, useState } from "react";
import { PillToggle } from "../design/primitives/PillToggle";
import { spring, springBouncy, springSnappy, springSoft } from "../design/springs";
import { useFontCss } from "../lib/fontLoader";
import { useGoogleCss } from "../lib/googlePreview";
import { buildFamilyMenu, buildTagMenu } from "../lib/menus";
import { openContextMenu, openContextMenuAt } from "../design/primitives/ContextMenu";
import { activeConflictsFor, conflictsFor, googlePreviewKey, isGoogleVirtualFace, SIZES, resolveSampleText, useFontStore, type Family } from "../state/fontStore";
import { playStar, playTag } from "../lib/sound";
import type { FontFace } from "../lib/ipc";
import { useT } from "../lib/i18n";

export function FormatBadge({ format, isVariable }: { format: string; isVariable: boolean }) {
  if (isVariable) return <span className="badge badge-variable">VAR</span>;
  return <span className={`badge badge-${format}`}>{format.toUpperCase()}</span>;
}

function FacePreview({
  face,
  family,
  text,
  size,
  synthesize,
}: {
  face: FontFace;
  /** Catalogue family name, when this style is not installed yet. */
  family: string;
  text: string;
  size: number;
  synthesize: boolean;
}) {
  const t = useT();
  const virtual = isGoogleVirtualFace(face);
  const google = useGoogleCss(virtual ? family : "", virtual ? face.id.split(":").pop() ?? "400" : "");
  const local = useFontCss(virtual ? null : face);
  const fontFamily = virtual ? google.fontFamily : local.fontFamily;
  const failed = virtual ? google.failed : local.failed;
  const setFontFileActive = useFontStore((s) => s.setFontFileActive);
  const installGoogleStyle = useFontStore((s) => s.installGoogleStyle);
  const styleKey = face.id.split(":").pop() ?? "400";
  // While the desktop file is on its way, the switch already reads as on.
  const installing = useFontStore((s) => Boolean(s.googleInstalling[googlePreviewKey(family, styleKey)]));
  return (
    <div className="face-row">
      <span className="face-style">{face.style}</span>
      {fontFamily ? (
        <span
          className="face-sample"
          style={{
            fontFamily,
            fontSize: Math.min(size, 32),
            fontStyle: face.italic ? "italic" : "normal",

            fontWeight: synthesize ? face.weight : undefined,
          }}
        >
          {text}
        </span>
      ) : failed ? (
        <span className="face-sample face-failed">
          {t("card.previewUnavailable")}
        </span>
      ) : (
        <span className="skeleton face-skeleton" />
      )}
      <span className="face-toggle">
        <PillToggle
          on={virtual ? installing || face.active : face.active}
          disabled={virtual ? installing : !face.deactivatable}
          onChange={(on) => {
            // A catalogue style has no file yet: switching it on downloads the
            // desktop font and activates it in one step.
            if (virtual) {
              if (on) void installGoogleStyle(family, styleKey);
              return;
            }
            void setFontFileActive(face.path, on);
          }}
          label={t(virtual ? "card.googleActivateStyle" : face.active ? "card.deactivate" : "card.activate", {
            name: face.style,
          })}
        />
      </span>
    </div>
  );
}

export const FamilyCard = memo(function FamilyCard({ family }: { family: Family }) {
  const t = useT();
  const sampleText = useFontStore((s) => s.sampleText);
  const sampleUseFontName = useFontStore((s) => s.sampleUseFontName);
  const sizeIndex = useFontStore((s) => s.sizeIndex);
  const setFamilyActive = useFontStore((s) => s.setFamilyActive);
  const setFamilyTags = useFontStore((s) => s.setFamilyTags);
  const select = useFontStore((s) => s.select);
  const selected = useFontStore((s) => s.selection.includes(family.name));
  const detailsOpen = useFontStore((s) => s.selectedFamily === family.name);
  const favorite = useFontStore((s) => s.favorites.includes(family.name));
  const toggleFavorite = useFontStore((s) => s.toggleFavorite);
  const hasActiveConflict = useFontStore((s) => activeConflictsFor(s.fonts).has(family.name));
  const hasDormantConflict = useFontStore((s) => conflictsFor(s.fonts).has(family.name));
  const [expanded, setExpanded] = useState(false);
  // Which tag chip is "armed": clicking a chip reveals the remove badge
  // floating above its top-right corner. Clicking it again disarms it.
  const [armedTag, setArmedTag] = useState<string | null>(null);
  // Bumps on every star press so the icon replays its zoom-out pop.
  const [starPop, setStarPop] = useState(0);
  const expandSignal = useFontStore((s) => s.expandSignal);
  const expandOpen = useFontStore((s) => s.expandOpen);
  // Google catalogue cards start with one fallback face until their real
  // metadata is fetched, so keep the expander available only while that
  // style count is still unknown.
  const canExpand =
    family.faces.length > 1 || Boolean(family.google && family.google.styles.length === 0);
  useEffect(() => {
    setExpanded(expandOpen && canExpand);
  }, [expandSignal]);
  useEffect(() => {
    // Once catalogue metadata confirms a single style, close the temporary
    // fallback expansion and remove its affordance.
    if (!canExpand) setExpanded(false);
  }, [canExpand]);

  const size = SIZES[sizeIndex];
  const lead = family.faces.find((f) => f.style === "Regular") ?? family.faces[0];
  // A catalogue family is previewed from its web fonts; once a style is
  // installed the ordinary local files take over.
  const catalogue = family.google && !family.google.installed ? family.google : null;
  const google = useGoogleCss(catalogue?.family ?? "", catalogue?.styles[0]?.key ?? "400");
  const local = useFontCss(catalogue ? null : lead);
  const fontFamily = catalogue ? google.fontFamily : local.fontFamily;
  const failed = catalogue ? google.failed : local.failed;
  const text = resolveSampleText(sampleText, sampleUseFontName, family.name);
  const ensureGoogleMeta = useFontStore((s) => s.ensureGoogleMeta);
  // The style list is fetched when the card is opened, never while scrolling:
  // that would be one request per visible card.
  useEffect(() => {
    if (expanded && catalogue) void ensureGoogleMeta(catalogue.family);
  }, [expanded, catalogue, ensureGoogleMeta]);

  return (
    <article
      className={`family-card ${selected ? "card-selected" : ""} ${expanded ? "card-expanded" : ""}`}
      data-family={family.name}
      onClick={(e) => {
        // Only the body toggles the style list — buttons (star, pill,
        // info strip, expander) handle themselves.
        if ((e.target as HTMLElement).closest("button")) return;
        setArmedTag(null);
        const st = useFontStore.getState();
        if (st.comparePicking) {
          st.togglePick(family.name);
          return;
        }
        // Opening the style list also selects the family (plain click) without
        // opening the detail panel. With
        // Ctrl/Shift the card behaves like a list row: toggle / extend the
        // selection, so the Compare button can arm on multi-selection.
        const mode =
          e.ctrlKey || e.metaKey ? "toggle" : e.shiftKey ? "range" : "single";
        st.selectWith(family.name, mode, st.visibleOrder);
        // Single-face families have no style list to open — clicking only
        // selects them, it never expands.
        if (canExpand) setExpanded((v) => !v);
      }}
      onContextMenu={(e) => openContextMenu(e, buildFamilyMenu(family))}
    >
      <header className="card-head">
        <motion.button
          className={`star-btn ${favorite ? "star-on" : ""}`}
          aria-label={t(favorite ? "card.unfavorite" : "card.favorite", { name: family.name })}
          aria-pressed={favorite}
          onClick={(e) => {
            e.stopPropagation();
            setStarPop((p) => p + 1);
            const st = useFontStore.getState();
            if (st.selection.length > 1 && st.selection.includes(family.name)) {
              playStar(true);
              void st.favoriteMany(st.selection);
              return;
            }
            playStar(!favorite);
            void toggleFavorite(family.name);
          }}
          whileTap={{ scale: 0.85 }}
        >
          <motion.span
            key={starPop}
            initial={starPop === 0 ? false : { scale: 1.8 }}
            animate={{ scale: 1 }}
            transition={springBouncy}
            style={{ display: "grid", placeItems: "center" }}
          >
            <Star size={14} strokeWidth={1.5} />
          </motion.span>
        </motion.button>
        <span className="card-name">{family.name}</span>
        {family.tags.map((tag) => (
          <span
            key={tag}
            className={`tag-chip tag-pick ${armedTag === tag ? "tag-pick-armed" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              setArmedTag((cur) => (cur === tag ? null : tag));
            }}
          >
            <span className="tag-pick-text">{tag}</span>
            {armedTag === tag && (
              <button
                className="tag-unpin"
                aria-label={t("tag.removeAria", { tag })}
                title={t("tag.removeAria", { tag })}
                onClick={(e) => {
                  e.stopPropagation();
                  playTag(false);
                  setArmedTag(null);
                  void setFamilyTags(
                    family.name,
                    family.tags.filter((x) => x !== tag),
                  );
                }}
              >
                <X size={10} strokeWidth={2.25} />
              </button>
            )}
          </span>
        ))}
        <button
          className="tag-add"
          aria-label={t("card.addTag")}
          title={t("card.addTag")}
          onClick={(e) => {
            e.stopPropagation();
            const r = e.currentTarget.getBoundingClientRect();
            openContextMenuAt(r.left, r.bottom + 6, buildTagMenu(family.name));
          }}
        >
          + {t("card.addTag")}
        </button>
        {canExpand && (
          <motion.button
            className="card-expand"
            aria-label={t(expanded ? "card.collapseStyles" : "card.expandStyles")}
            aria-expanded={expanded}
            onClick={(e) => {
              e.stopPropagation();
              const st = useFontStore.getState();
              // Same as the card body: expanding selects the family — but
              // only on a plain click; with modifiers the user is extending
              // a selection, don't clobber it. Never touches the detail panel.
              if (!st.comparePicking && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
                useFontStore.setState({ selection: [family.name] });
              }
              setExpanded((v) => !v);
            }}
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.94 }}
          >
            <motion.span
              className="chevron"
              animate={{ rotate: expanded ? 90 : 0 }}
              transition={springSnappy}
            >
              <ChevronRight size={13} strokeWidth={1.5} />
            </motion.span>
            <span className="tabular">
              {t("card.stylesCount", { count: family.faces.length })}
            </span>
          </motion.button>
        )}
        <span className="card-spacer" />
        {hasActiveConflict ? (
          <span
            className="conflict-badge conflict-badge-filled"
            title=""
            aria-label={t("card.conflict")}
          >
            <AlertTriangle size={13} strokeWidth={2} fill="currentColor" />
          </span>
        ) : (
          hasDormantConflict && (
            <span
              className="conflict-badge conflict-badge-dormant"
              title=""
              aria-label={t("card.conflictResolved")}
            >
              <AlertTriangle size={13} strokeWidth={1.5} />
            </span>
          )
        )}
        {/* A catalogue family has no family-wide switch: each style is
            installed on its own, from the style list. */}
        {!catalogue && (
          <PillToggle
            on={family.active}
            disabled={!family.deactivatable}
            onChange={(on) => void setFamilyActive(family.name, on)}
            label={t(family.active ? "card.deactivate" : "card.activate", { name: family.name })}
          />
        )}
      </header>

      <div className="card-preview" style={{ minHeight: size * 1.35 }}>
        {fontFamily ? (
          <motion.p
            className="preview-text"
            style={{
              fontFamily,
              fontSize: size,
              fontStyle: lead.italic ? "italic" : "normal",
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={spring}
          >
            {text}
          </motion.p>
        ) : failed ? (
          <p className="preview-text preview-failed">
            {t("card.noPreview")}
          </p>
        ) : (
          <span className="skeleton preview-skeleton" style={{ height: size * 1.1 }} />
        )}
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            className="card-styles"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0, transition: { ...springSnappy } }}
            transition={springSoft}
          >
            {family.faces.map((face) => (
              <FacePreview
                key={face.id}
                face={face}
                family={family.google?.family ?? family.name}
                text={text}
                size={size}
                synthesize={family.faces.filter((f) => f.path === face.path).length > 1}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <button
        className={`card-info-strip ${detailsOpen ? "card-info-strip-open" : ""}`}
        aria-label={t("card.openDetails", { name: family.name })}
        title={t("card.openDetails", { name: family.name })}
        onClick={() => {
          const st = useFontStore.getState();
          if (st.comparePicking) {
            st.togglePick(family.name);
            return;
          }
          // The info strip is the ONLY place that opens the detail panel.
          if (detailsOpen) {
            useFontStore.setState({ selectedFamily: null });
          } else {
            select(family.name);
          }
        }}
      >
        <Info size={17} strokeWidth={1.75} />
      </button>
    </article>
  );
});

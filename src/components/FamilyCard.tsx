import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, ChevronRight, Info, Star } from "lucide-react";
import { memo, useEffect, useState } from "react";
import { PillToggle } from "../design/primitives/PillToggle";
import { spring, springSnappy, springSoft } from "../design/springs";
import { useFontCss } from "../lib/fontLoader";
import { buildFamilyMenu, buildTagMenu } from "../lib/menus";
import { openContextMenu, openContextMenuAt } from "../design/primitives/ContextMenu";
import { activeConflictsFor, conflictsFor, SIZES, resolveSampleText, useFontStore, type Family } from "../state/fontStore";
import { playStar } from "../lib/sound";
import type { FontFace } from "../lib/ipc";
import { useT } from "../lib/i18n";

export function FormatBadge({ format, isVariable }: { format: string; isVariable: boolean }) {
  if (isVariable) return <span className="badge badge-variable">VAR</span>;
  return <span className={`badge badge-${format}`}>{format.toUpperCase()}</span>;
}

function FacePreview({
  face,
  text,
  size,
  synthesize,
}: {
  face: FontFace;
  text: string;
  size: number;
  synthesize: boolean;
}) {
  const t = useT();
  const { fontFamily, failed } = useFontCss(face);
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
    </div>
  );
}

export const FamilyCard = memo(function FamilyCard({ family }: { family: Family }) {
  const t = useT();
  const sampleText = useFontStore((s) => s.sampleText);
  const sampleUseFontName = useFontStore((s) => s.sampleUseFontName);
  const sizeIndex = useFontStore((s) => s.sizeIndex);
  const setFamilyActive = useFontStore((s) => s.setFamilyActive);
  const select = useFontStore((s) => s.select);
  const selected = useFontStore((s) => s.selection.includes(family.name));
  const detailsOpen = useFontStore((s) => s.selectedFamily === family.name);
  const favorite = useFontStore((s) => s.favorites.includes(family.name));
  const toggleFavorite = useFontStore((s) => s.toggleFavorite);
  const hasActiveConflict = useFontStore((s) => activeConflictsFor(s.fonts).has(family.name));
  const hasDormantConflict = useFontStore((s) => conflictsFor(s.fonts).has(family.name));
  const [expanded, setExpanded] = useState(false);
  const expandSignal = useFontStore((s) => s.expandSignal);
  const expandOpen = useFontStore((s) => s.expandOpen);
  useEffect(() => {
    setExpanded(expandOpen);
  }, [expandSignal]);

  const size = SIZES[sizeIndex];
  const lead = family.faces.find((f) => f.style === "Regular") ?? family.faces[0];
  const { fontFamily, failed } = useFontCss(lead);
  const text = resolveSampleText(sampleText, sampleUseFontName, family.name);

  return (
    <article
      className={`family-card ${selected ? "card-selected" : ""}`}
      data-family={family.name}
      onClick={(e) => {
        // Only the body toggles the style list — buttons (star, pill,
        // info strip, expander) handle themselves.
        if ((e.target as HTMLElement).closest("button")) return;
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
        setExpanded((v) => !v);
      }}
      onContextMenu={(e) => openContextMenu(e, buildFamilyMenu(family))}
    >
      <header className="card-head">
        {family.tags.map((tag) => (
          <span key={tag} className="tag-label">
            {tag}
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
        <span className="card-name">{family.name}</span>
        {family.faces.length > 1 && (
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
        <motion.button
          className={`star-btn ${favorite ? "star-on" : ""}`}
          aria-label={t(favorite ? "card.unfavorite" : "card.favorite", { name: family.name })}
          aria-pressed={favorite}
          onClick={(e) => {
            e.stopPropagation();
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
          <Star size={14} strokeWidth={1.5} />
        </motion.button>
        <PillToggle
          on={family.active}
          disabled={!family.deactivatable}
          onChange={(on) => void setFamilyActive(family.name, on)}
          label={t(family.active ? "card.deactivate" : "card.activate", { name: family.name })}
        />
      </header>

      <div className="card-preview" style={{ minHeight: size * 1.35 }}>
        <AnimatePresence mode="wait">
          {fontFamily ? (
            <motion.p
              key="real"
              className="preview-text"
              style={{
                fontFamily,
                fontSize: size,
                fontStyle: lead.italic ? "italic" : "normal",
              }}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              transition={spring}
            >
              {text}
            </motion.p>
          ) : failed ? (
            <p key="failed" className="preview-text preview-failed">
              {t("card.noPreview")}
            </p>
          ) : (
            <motion.span
              key="skeleton"
              className="skeleton preview-skeleton"
              style={{ height: size * 1.1 }}
              exit={{ opacity: 0, transition: { duration: 0.1 } }}
            />
          )}
        </AnimatePresence>
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

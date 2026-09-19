import { motion } from "motion/react";
import { Rows3 } from "lucide-react";
import { spring, staggerDelay } from "../design/springs";
import { useFontCss } from "../lib/fontLoader";
import { useGoogleCss } from "../lib/googlePreview";
import {
  googlePreviewKey,
  isGoogleVirtualFace,
  resolveSampleText,
  useFontStore,
  type Family,
} from "../state/fontStore";
import { useT } from "../lib/i18n";
import { PillToggle } from "../design/primitives/PillToggle";

const WATERFALL_SIZES = [8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 56, 64, 80, 96];

export function WaterfallView({ families }: { families: Family[] }) {
  const t = useT();
  const selectedFamily = useFontStore((s) => s.selectedFamily);
  const selection = useFontStore((s) => s.selection);
  const sampleText = useFontStore((s) => s.sampleText);
  const sampleUseFontName = useFontStore((s) => s.sampleUseFontName);
  const setFamilyActive = useFontStore((s) => s.setFamilyActive);
  const installGoogleStyle = useFontStore((s) => s.installGoogleStyle);

  const focus =
    selection.length > 0 ? selection[0] : selectedFamily;
  const family =
    (focus ? families.find((f) => f.name === focus) : null) ?? families[0] ?? null;
  const lead =
    family?.faces.find((f) => f.style === "Regular") ?? family?.faces[0] ?? null;
  const catalogue = family?.google && !family.google.installed ? family.google : null;
  const styleKey =
    lead && isGoogleVirtualFace(lead)
      ? lead.id.split(":").pop() ?? "400"
      : catalogue?.styles[0]?.key ?? "400";
  const google = useGoogleCss(catalogue?.family ?? "", styleKey);
  const local = useFontCss(catalogue ? null : lead);
  const fontFamily = catalogue ? google.fontFamily : local.fontFamily;
  const virtual = lead ? isGoogleVirtualFace(lead) : false;
  const installing = useFontStore((s) =>
    family ? Boolean(s.googleInstalling[googlePreviewKey(family.name, styleKey)]) : false,
  );
  const showToggle = family !== null && (family.deactivatable || virtual || installing);

  if (!family || !lead) {
    return (
      <motion.div
        className="empty-state"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={spring}
      >
        <span className="empty-tile">
          <Rows3 size={26} strokeWidth={1.5} />
        </span>
        <h2>{t("waterfall.emptyTitle")}</h2>
        <p>{t("waterfall.emptyBody")}</p>
      </motion.div>
    );
  }

  const text = resolveSampleText(sampleText, sampleUseFontName, family.name);
  return (
    <div className="waterfall-view">
      <div className="waterfall-head">
        <span className="waterfall-title">{family.name}</span>
        <span className="waterfall-sub">{lead.style}</span>
        {showToggle && (
          <span className="waterfall-toggle">
            <PillToggle
              on={virtual ? installing || family.active : family.active}
              disabled={virtual ? installing : !family.deactivatable}
              onChange={(on) => {
                if (virtual) {
                  if (on) void installGoogleStyle(family.name, styleKey);
                  return;
                }
                void setFamilyActive(family.name, on);
              }}
              label={t(virtual ? "card.googleActivateStyle" : family.active ? "card.deactivate" : "card.activate", {
                name: family.name,
              })}
            />
          </span>
        )}
      </div>
      {WATERFALL_SIZES.map((px, i) => (
        <motion.p
          key={px}
          className="waterfall-full-line"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring, delay: staggerDelay(i) }}
          style={{
            fontFamily: fontFamily ?? undefined,
            fontSize: px,
            fontStyle: lead.italic ? "italic" : "normal",
          }}
        >
          <span className="waterfall-px tabular">{px}</span>
          <span className="waterfall-text">{text}</span>
        </motion.p>
      ))}
    </div>
  );
}

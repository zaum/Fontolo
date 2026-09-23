import { motion } from "motion/react";
import { Rows3 } from "lucide-react";
import { spring, staggerDelay } from "../design/springs";
import { useFontCss } from "../lib/fontLoader";
import { useGoogleCss } from "../lib/googlePreview";
import { ActivationLamp } from "../design/primitives/PillToggle";
import {
  familyPartial,
  familySessionHeld,
  googlePreviewKey,
  isGoogleVirtualFace,
  resolveSampleText,
  useFontStore,
  type Family,
} from "../state/fontStore";
import { useT } from "../lib/i18n";

const WATERFALL_SIZES = [8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 56, 64, 80, 96];

export function WaterfallView({ families }: { families: Family[] }) {
  const t = useT();
  const selectedFamily = useFontStore((s) => s.selectedFamily);
  const selection = useFontStore((s) => s.selection);
  const sampleText = useFontStore((s) => s.sampleText);
  const sampleUseFontName = useFontStore((s) => s.sampleUseFontName);
  const setFamilyActive = useFontStore((s) => s.setFamilyActive);
  const activateFamilySession = useFontStore((s) => s.activateFamilySession);
  const deactivateFamilySession = useFontStore((s) => s.deactivateFamilySession);
  const sessionPaths = useFontStore((s) => s.sessionActivatedPaths);
  const swapLampButtons = useFontStore((s) => s.settings.swapActivationButtons);
  const installGoogleStyle = useFontStore((s) => s.installGoogleStyle);

  const focus =
    selection.length > 0 ? selection[0] : selectedFamily;
  const family =
    (focus ? families.find((f) => f.name === focus) : null) ?? families[0] ?? null;
  const activationPending = useFontStore((s) =>
    family?.faces.some((face) => s.activationPending.includes(face.path)) ?? false,
  );
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
        {showToggle && (
          <span className="waterfall-toggle">
            <ActivationLamp
              fixedOn={virtual ? false : family.active && !familySessionHeld(family.faces, sessionPaths)}
              sessionOn={virtual ? false : family.active && familySessionHeld(family.faces, sessionPaths)}
              dashed={familyPartial(family.faces) && family.active}
              onFixed={() => {
                if (virtual) {
                  void installGoogleStyle(family.name, styleKey);
                  return;
                }
                const sessionHeld = familySessionHeld(family.faces, sessionPaths);
                void setFamilyActive(family.name, !family.active || sessionHeld);
              }}
              onSession={() => {
                if (virtual) return;
                if (familySessionHeld(family.faces, sessionPaths)) {
                  void deactivateFamilySession(family.name);
                } else {
                  void activateFamilySession(family.name);
                }
              }}
              label={t(virtual ? "card.googleActivateStyle" : family.active ? "card.deactivateFixed" : "card.activateFixed", {
                name: family.name,
              })}
              disabled={virtual ? installing : !family.deactivatable || activationPending}
              pending={activationPending}
              swap={swapLampButtons}
            />
          </span>
        )}
        <span className="waterfall-title">{family.name}</span>
        <span className="waterfall-sub">{lead.style}</span>
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

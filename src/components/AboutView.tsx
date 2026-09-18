import { openUrl as openInBrowser } from "@tauri-apps/plugin-opener";
import { motion } from "motion/react";
import { spring } from "../design/springs";
import { toast } from "../design/primitives/Toast";
import { t as translate, useT } from "../lib/i18n";
import { APP_LICENSE, APP_VERSION } from "../lib/version";

function openUrl(url: string) {
  openInBrowser(url).catch((e) => toast.error(translate("toast.couldntOpenLink"), String(e)));
}

const SOURCE_URL = "https://github.com/zaum/fontolo";
const SOURCE_LABEL = "github.com/zaum/fontolo";

const STACK = ["Tauri v2", "Rust", "React 19", "TypeScript", "Vite", "pnpm"];

export function AboutView() {
  const t = useT();
  return (
    <motion.div
      className="about-view"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
    >
      <img className="about-icon" src="/icon-512.png" alt="" draggable={false} />
      <h1 className="about-name">Fontoló</h1>
      <div className="about-version tabular">
        {t("about.version", { version: APP_VERSION, license: APP_LICENSE })}
      </div>
      <p className="about-desc">{t("about.desc")}</p>

      <div className="about-stack" aria-label={t("about.stackAria")}>
        {STACK.map((t) => (
          <span key={t} className="about-chip tabular">
            {t}
          </span>
        ))}
      </div>

      <p className="about-source">
        {t("about.source")}:{" "}
        <button className="about-source-link" onClick={() => openUrl(SOURCE_URL)}>
          {SOURCE_LABEL}
        </button>
      </p>
    </motion.div>
  );
}

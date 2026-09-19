import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";
import { motion } from "motion/react";
import { springSoft } from "../design/springs";
import { useT } from "../lib/i18n";

export function Titlebar() {
  const t = useT();
  const win = getCurrentWindow();
  return (
    <motion.div
      className="titlebar"
      data-tauri-drag-region
      initial={{ y: -28, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={springSoft}
    >
      <div className="titlebar-brand" data-tauri-drag-region>
        <img className="brand-mark" src="/icon.png" alt="" draggable={false} />
        <span className="titlebar-title" data-tauri-drag-region>
          Fontoló
        </span>
      </div>
      <div className="titlebar-controls">
        <button aria-label={t("titlebar.minimize")} onClick={() => void win.minimize()}>
          <Minus size={13} strokeWidth={1.5} />
        </button>
        <button aria-label={t("titlebar.maximize")} onClick={() => void win.toggleMaximize()}>
          <Square size={10} strokeWidth={1.5} />
        </button>
        <button className="tc-close" aria-label={t("titlebar.close")} onClick={() => void win.close()}>
          <X size={13} strokeWidth={1.5} />
        </button>
      </div>
    </motion.div>
  );
}

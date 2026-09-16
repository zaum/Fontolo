import { motion } from "motion/react";
import { useState } from "react";
import { springBouncy } from "../springs";
import { playToggle } from "../../lib/sound";

interface Props {
  on: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
  label: string;
  size?: "sm" | "lg";
}

export function PillToggle({ on, disabled, onChange, label, size = "sm" }: Props) {
  const [pressed, setPressed] = useState(false);

  return (
    <motion.button
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      className={`pill-toggle pill-${size} ${on ? "pill-on" : ""}`}
      // Toggle on pointerdown, not click: `click` is retargeted to the
      // nearest common ancestor when the pressed element moves or is
      // re-rendered mid-press (card whileTap/layout animations), which made
      // the toggle miss and select the card instead. pointerdown always
      // targets the element actually pressed.
      onPointerDown={(e) => {
        e.stopPropagation();
        if (disabled) return;
        setPressed(true);
        playToggle(!on);
        onChange(!on);
      }}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      // Swallow the browser-generated click so a keyboard activation or a
      // retargeted click cannot fire the change a second time.
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        playToggle(!on);
        onChange(!on);
      }}
      whileTap={disabled ? undefined : { scale: 0.94 }}
    >
      <motion.span
        className="pill-thumb"
        layout
        animate={{ scaleX: pressed ? 1.25 : 1 }}
        transition={springBouncy}
        style={{ originX: on ? 1 : 0 }}
      />
    </motion.button>
  );
}

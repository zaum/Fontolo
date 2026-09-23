import { motion } from "motion/react";
import { useState } from "react";
import { playToggle } from "../../lib/sound";

interface LampProps {
  /** Permanently activated (green). */
  fixedOn: boolean;
  /** Activated until quit (yellow). Wins over fixedOn when both hold. */
  sessionOn: boolean;
  /** Extra dashed ring: the family is active but not every font. */
  dashed?: boolean;
  disabled?: boolean;
  pending?: boolean;
  /** Settings toggle: swap the left/right mouse button roles. */
  swap?: boolean;
  onFixed: () => void;
  onSession: () => void;
  label: string;
}

/** One activation lamp with three faces: grey off, green fixed (permanent),
 * yellow session (until quit). Default layout: left click toggles fixed,
 * right click or Shift+left toggles session; Caps Lock forces session. With
 * `swap` the button roles are mirrored (Caps Lock still forces session). */
export function ActivationLamp({
  fixedOn,
  sessionOn,
  dashed,
  disabled,
  pending,
  swap = false,
  onFixed,
  onSession,
  label,
}: LampProps) {
  const [pressed, setPressed] = useState(false);
  const active = fixedOn || sessionOn;

  const run = (session: boolean) => {
    playToggle(!active);
    (session ? onSession : onFixed)();
  };

  return (
    <motion.button
      role="switch"
      aria-checked={active}
      aria-busy={pending || undefined}
      aria-label={label}
      title={label}
      disabled={disabled || pending}
      className={`lamp ${active ? "lamp-on" : ""} ${sessionOn ? "lamp-session" : ""} ${dashed ? "lamp-dashed" : ""} ${pending ? "lamp-pending" : ""}`}
      // Toggle on pointerdown, not click: `click` is retargeted to the
      // nearest common ancestor when the pressed element moves or is
      // re-rendered mid-press (card whileTap/layout animations), which made
      // the toggle miss and select the card instead. pointerdown always
      // targets the element actually pressed.
      onPointerDown={(e) => {
        e.stopPropagation();
        if (disabled || pending) return;
        if (e.button !== 0 && e.button !== 2) return;
        setPressed(true);
        e.preventDefault();
        // Caps Lock held: always the session action, in both layouts.
        if (e.getModifierState("CapsLock")) {
          run(true);
          return;
        }
        const alt = e.button === 2 || (e.button === 0 && e.shiftKey);
        run(swap ? !alt : alt);
      }}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      // Right click is an activation gesture here, not a menu gesture.
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      // Swallow the browser-generated click so a keyboard activation or a
      // retargeted click cannot fire the change a second time.
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onKeyDown={(e) => {
        if (disabled || pending) return;
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        // Keyboard activation follows the primary button (left click).
        run(swap);
      }}
      whileTap={undefined}
    >
      <motion.span
        className="lamp-dot"
        layout
        animate={{ scale: pressed ? 0.72 : 1 }}
        transition={{ duration: 0.1, ease: "easeOut" }}
      />
    </motion.button>
  );
}

interface Props {
  on: boolean;
  disabled?: boolean;
  pending?: boolean;
  onChange: (on: boolean) => void;
  label: string;
  size?: "sm" | "lg";
}

export function PillToggle({ on, disabled, pending = false, onChange, label, size = "sm" }: Props) {
  const [pressed, setPressed] = useState(false);

  return (
    <motion.button
      role="switch"
      aria-checked={on}
      aria-busy={pending || undefined}
      aria-label={label}
      disabled={disabled || pending}
      className={`pill-toggle pill-${size} ${on ? "pill-on" : ""} ${pending ? "pill-pending" : ""}`}
      // Toggle on pointerdown, not click: `click` is retargeted to the
      // nearest common ancestor when the pressed element moves or is
      // re-rendered mid-press (card whileTap/layout animations), which made
      // the toggle miss and select the card instead. pointerdown always
      // targets the element actually pressed.
      onPointerDown={(e) => {
        e.stopPropagation();
        if (disabled || pending) return;
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
        if (disabled || pending) return;
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        playToggle(!on);
        onChange(!on);
      }}
      whileTap={undefined}
    >
      <motion.span
        className="pill-thumb"
        layout
        animate={{ scaleX: pressed ? 1.08 : 1 }}
        transition={{ duration: 0.1, ease: "easeOut" }}
        style={{ originX: on ? 1 : 0 }}
      />
    </motion.button>
  );
}

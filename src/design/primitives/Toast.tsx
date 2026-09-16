import { AnimatePresence, motion } from "motion/react";
import { CheckCircle2, Info, XCircle } from "lucide-react";
import { create } from "zustand";
import { springBouncy } from "../springs";
import { playError, playKind } from "../../lib/sound";

type Kind = "success" | "error" | "info";

interface ToastAction {
  label: string;
  run: () => void;
}

interface ToastItem {
  id: number;
  kind: Kind;
  title: string;
  detail?: string;
  action?: ToastAction;
}

interface ToastStore {
  toasts: ToastItem[];
  push: (kind: Kind, title: string, detail?: string, sound?: string, action?: ToastAction) => void;
  dismiss: (id: number) => void;
  pause: (id: number) => void;
  resume: (id: number) => void;
}

let nextId = 1;
interface TimerEntry {
  handle: ReturnType<typeof setTimeout>;
  endsAt: number;
  remaining: number;
}
const timers = new Map<number, TimerEntry>();

function durationFor(kind: Kind, hasAction: boolean): number {
  if (kind === "error") return 7000;
  if (hasAction) return 6500;
  return 4000;
}

function arm(id: number, remaining: number, dismiss: (id: number) => void) {
  const prev = timers.get(id);
  if (prev) clearTimeout(prev.handle);
  timers.set(
    id,
    {
      handle: setTimeout(() => {
        timers.delete(id);
        dismiss(id);
      }, remaining),
      endsAt: Date.now() + remaining,
      remaining,
    },
  );
}

const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],
  push: (kind, title, detail, sound, action) => {
    if (kind === "success") playKind(sound ?? "success");
    else playError();
    const id = nextId++;
    set({ toasts: [...get().toasts, { id, kind, title, detail, action }] });

    arm(id, durationFor(kind, Boolean(action)), get().dismiss);
  },
  dismiss: (id) => {
    const entry = timers.get(id);
    if (entry) clearTimeout(entry.handle);
    timers.delete(id);
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },

  pause: (id) => {
    const entry = timers.get(id);
    if (!entry) return;
    clearTimeout(entry.handle);
    entry.remaining = Math.max(0, entry.endsAt - Date.now());
  },
  resume: (id) => {
    const entry = timers.get(id);
    if (!entry) return;
    if (!get().toasts.some((t) => t.id === id)) {
      timers.delete(id);
      return;
    }
    arm(id, entry.remaining, get().dismiss);
  },
}));

export const toast = {

  success: (title: string, detail?: string, sound?: string, action?: ToastAction) =>
    useToastStore.getState().push("success", title, detail, sound, action),
  error: (title: string, detail?: string) =>
    useToastStore.getState().push("error", title, detail),
  info: (title: string, detail?: string) =>
    useToastStore.getState().push("info", title, detail),
};

export function Toaster() {
  const { toasts, dismiss, pause, resume } = useToastStore();
  return (
    <div className="toaster">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            className={`toast glass-e3 toast-${t.kind}`}
            role="status"
            initial={{ opacity: 0, x: 40, y: -10, scale: 0.94 }}
            animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
            exit={{
              opacity: 0,
              x: 32,
              scale: 0.96,
              transition: { duration: 0.16, ease: "easeIn" },
            }}
            transition={springBouncy}
            onClick={() => dismiss(t.id)}
            onMouseEnter={() => pause(t.id)}
            onMouseLeave={() => resume(t.id)}
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.97 }}
            layout
          >
            {t.kind === "success" ? (
              <CheckCircle2 size={16} strokeWidth={2} className="toast-icon success" />
            ) : t.kind === "error" ? (
              <XCircle size={16} strokeWidth={2} className="toast-icon error" />
            ) : (
              <Info size={16} strokeWidth={2} className="toast-icon info" />
            )}
            <span>
              <span className="toast-title">{t.title}</span>
              {t.detail && <span className="toast-detail">{t.detail}</span>}
            </span>
            {t.action && (
              <button
                className="toast-action"
                onClick={(e) => {
                  e.stopPropagation();
                  dismiss(t.id);
                  t.action?.run();
                }}
              >
                {t.action.label}
              </button>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

import { useVirtualizer } from "@tanstack/react-virtual";
import { motion } from "motion/react";
import { useEffect, useRef } from "react";
import { spring, staggerDelay } from "../design/springs";
import { FamilyCard } from "./FamilyCard";
import type { Family } from "../state/fontStore";
import { SIZES, useFontStore } from "../state/fontStore";
import { preloadFaces, setVisiblePreviewFaces } from "../lib/fontLoader";

export function FontGrid({ families }: { families: Family[] }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const mountedAt = useRef(Date.now());
  const sizeIndex = useFontStore((s) => s.sizeIndex);
  const estimate = 120 + SIZES[sizeIndex] * 1.5;

  const virtualizer = useVirtualizer({
    count: families.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimate,
    // Two rows keep scrolling smooth without mounting a second screenful of
    // cards and starting preview work the user cannot see yet.
    overscan: 2,
    getItemKey: (i) => families[i].name,
  });

  const selectedFamily = useFontStore((s) => s.selectedFamily);
  const selection = useFontStore((s) => s.selection);
  const virtualItems = virtualizer.getVirtualItems();
  const firstVisible = virtualItems[0]?.index ?? 0;
  const lastVisible = virtualItems[virtualItems.length - 1]?.index ?? -1;

  useEffect(() => {
    if (lastVisible < 0) return;
    setVisiblePreviewFaces(
      families.slice(firstVisible, lastVisible + 1).flatMap((family) => family.faces),
    );
    const from = Math.max(0, firstVisible - 8);
    const to = Math.min(families.length, lastVisible + 9);
    preloadFaces(families.slice(from, to).flatMap((family) => family.faces));
  }, [families, firstVisible, lastVisible]);

  useEffect(() => () => setVisiblePreviewFaces([]), []);

  useEffect(() => {
    const focus =
      selection.length > 0 ? selection[selection.length - 1] : selectedFamily;
    if (!focus) return;
    const idx = families.findIndex((f) => f.name === focus);
    if (idx >= 0) virtualizer.scrollToIndex(idx, { align: "auto" });

  }, [selectedFamily, selection]);

  const arriving = Date.now() - mountedAt.current < 1200;

  return (
    <div ref={parentRef} className="grid-scroll">
      <div
        className="grid-inner"
        style={{ height: virtualizer.getTotalSize(), position: "relative" }}
      >
        {virtualItems.map((item) => (
          <div
            key={item.key}
            data-index={item.index}
            ref={virtualizer.measureElement}
            className="grid-row"
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${item.start}px)`,
            }}
          >
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                ...spring,
                delay: arriving ? staggerDelay(item.index) : 0,
              }}
            >
              <FamilyCard family={families[item.index]} />
            </motion.div>
          </div>
        ))}
      </div>
    </div>
  );
}

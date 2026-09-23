import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useRef } from "react";
import { FamilyCard } from "./FamilyCard";
import type { Family } from "../state/fontStore";
import { SIZES, useFontStore } from "../state/fontStore";
import { preloadFaces, setVisiblePreviewFaces } from "../lib/fontLoader";

const IDLE_PRELOAD_MAX = 40;

function leadPreviewFace(family: Family) {
  return family.faces.find((face) => face.style === "Regular") ?? family.faces[0];
}

function leadPreviewFaces(families: Family[]) {
  return families.flatMap((family) => {
    const lead = leadPreviewFace(family);
    return lead ? [lead] : [];
  });
}

function idlePreviewFaces(families: Family[], first: number, last: number) {
  const visible = families.slice(first, last + 1);
  const faces = leadPreviewFaces(visible);
  const extraStyles = visible.map((family) => {
    const lead = leadPreviewFace(family);
    return family.faces.filter((face) => face.id !== lead?.id);
  });

  // Give each visible family a turn before taking its next style.
  for (let style = 0; faces.length < IDLE_PRELOAD_MAX; style++) {
    let added = false;
    for (const styles of extraStyles) {
      const face = styles[style];
      if (!face) continue;
      faces.push(face);
      added = true;
      if (faces.length === IDLE_PRELOAD_MAX) break;
    }
    if (!added) break;
  }

  // Spend remaining cache slots on nearby families, closest first.
  for (let distance = 1; faces.length < IDLE_PRELOAD_MAX; distance++) {
    const next = families[last + distance];
    const previous = families[first - distance];
    if (!next && !previous) break;
    for (const family of [next, previous]) {
      if (!family) continue;
      const lead = leadPreviewFace(family);
      if (lead) faces.push(lead);
      if (faces.length === IDLE_PRELOAD_MAX) break;
    }
  }
  return faces;
}

export function FontGrid({ families }: { families: Family[] }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const previousRange = useRef<{ first: number; last: number } | null>(null);
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
    setVisiblePreviewFaces(leadPreviewFaces(families.slice(firstVisible, lastVisible + 1)));
    const previous = previousRange.current;
    const scrollingDown = previous === null || lastVisible >= previous.last;
    // Warm the direction the user is travelling in. Preloading only the card's
    // first rendered face avoids queueing every hidden style in nearby families
    // (which made fast scrolling wait behind work that was never displayed).
    const before = scrollingDown ? 4 : 18;
    const after = scrollingDown ? 18 : 4;
    const from = Math.max(0, firstVisible - before);
    const to = Math.min(families.length, lastVisible + after + 1);
    preloadFaces(leadPreviewFaces(families.slice(from, to)));
    previousRange.current = { first: firstVisible, last: lastVisible };
  }, [families, firstVisible, lastVisible]);

  useEffect(() => {
    if (lastVisible < 0) return;
    const scrollElement = parentRef.current;
    let timer: number;
    const scheduleIdlePreload = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        preloadFaces(idlePreviewFaces(families, firstVisible, lastVisible));
      }, 350);
    };
    scrollElement?.addEventListener("scroll", scheduleIdlePreload, { passive: true });
    scheduleIdlePreload();
    return () => {
      window.clearTimeout(timer);
      scrollElement?.removeEventListener("scroll", scheduleIdlePreload);
    };
  }, [families, firstVisible, lastVisible]);

  useEffect(() => () => setVisiblePreviewFaces([]), []);

  useEffect(() => {
    const focus = selection.length > 0 ? selection[selection.length - 1] : selectedFamily;
    // Effect deps are deliberately just this focus value: the library gets
    // re-published whenever a font is activated, a tag is edited or a scan lands,
    // and reacting to the selection array as well scrolled the grid back to
    // the selected family — usually near the top — out from under the user.
    if (!focus) return;
    const idx = families.findIndex((f) => f.name === focus);
    if (idx >= 0) virtualizer.scrollToIndex(idx, { align: "auto" });

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

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
            <FamilyCard family={families[item.index]} />
          </div>
        ))}
      </div>
    </div>
  );
}

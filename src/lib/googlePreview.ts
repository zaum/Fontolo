import { useEffect } from "react";
import { googlePreviewKey, useFontStore } from "../state/fontStore";
import { useGoogleFaceCss } from "./fontLoader";

/**
 * The cached web fonts of one Google style, fetched on demand. Returns null
 * until they arrive; the store keeps them, so a re-render never refetches.
 */
export function useGooglePreviewFiles(family: string, style: string) {
  const entry = useFontStore((s) =>
    family ? s.googlePreviews[googlePreviewKey(family, style)] : undefined,
  );
  const ensure = useFontStore((s) => s.ensureGooglePreview);

  useEffect(() => {
    if (!family) return;
    if (entry === undefined) ensure(family, style);
  }, [entry, family, style, ensure]);

  return entry === undefined || entry === "loading" ? null : entry;
}

/**
 * CSS family name of a Google style. The preview is rendered from the cached
 * web fonts, with the Unicode ranges the provider declares, so a catalogue
 * family can be previewed in any text without ever installing it.
 */
export function useGoogleCss(family: string, style: string) {
  const files = useGooglePreviewFiles(family, style);
  return useGoogleFaceCss(family, style, family ? files : null);
}
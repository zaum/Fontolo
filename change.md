# Fontolo — Changelog

* **Total commits:** 14
* **Date range:** 2026-09-19 – 2026-09-21
* **Environment / Context:** Main branch maintenance, scan performance, and UI refinement

---

### <sup><sub style="font-size: 0.7em;">2026-09-21</sub></sup> · 🐛 Fixes · Faster Font Previews During Scrolling
* Prioritized background preview caching in the active scroll direction so incoming font cards can render from warm browser font entries.
* Restricted neighbour preloading to each card's visible lead style instead of queueing all hidden styles, preventing irrelevant font work from delaying visible previews.
* Removed the card fade-in and skeleton shimmer so font previews appear immediately without a loading transition or moving highlight.
* Restored a short fade for the completed preview text while keeping the loading placeholder static, and made visible previews take priority over background cache work.
* Added an idle-only, two-sided background warm-up window and enlarged the bounded preview cache so more nearby fonts are ready before scrolling resumes.
* Kept the current version inline with the Settings label in the sidebar footer.
* Added a fixed divider beneath Browse so the scrolling Collections section remains visually separated.
* Pinned only each collapsed card's visible lead style, promoted queued previews as soon as they became visible, and sized idle preloading to the renderer cache capacity to reduce wasted decoding.
* Used idle time to cache additional styles of families currently on screen before warming nearby families, within the renderer memory limit.
* Removed the manual refresh control from the toolbar while retaining other refresh paths.

`Direct Commit` · `pending`

---

### <sup><sub style="font-size: 0.7em;">2026-09-20</sub></sup> · 🐛 Fixes · Previews for Font Collections (TTC/OTC)
* Wrote each face of a `.ttc`/`.otc` collection out as a standalone single-face font, so a collection no longer previews the glyphs of its first face for every style it contains.
* Served those faces to the webview through the generated asset instead of the original file, which also removed the "preview unavailable" state that every system CJK collection above the 8 MB automatic decode budget was stuck with.
* Generated assets only for faces that are actually on screen, kept them in a non-scanned cache folder next to the Google preview cache, and trimmed that folder to a byte budget so a large library cannot fill the disk with derived files.
* Bounded the browser font cache by bytes as well as by entry count — the backend reports each generated file's own size, so the budget counts the single face instead of the whole collection — while visible previews stay pinned.
* Verified the extraction against a reference splitter: all 36 Rust tests pass, and every generated face renders pixel-identically to the reference in the browser while different faces of the same collection render differently.

`Direct Commit` · `pending`

---

### <sup><sub style="font-size: 0.7em;">2026-09-20</sub></sup> · 🎨 UI/UX · Refine Style Expansion, Size Slider, and Tag Editing
* Kept single-style font cards collapsed so clicking them only selects the family.
* Limited the accent fill of the preview-size slider to the selected value and left the remaining track neutral.
* Added a visible accent rail to expanded multi-style cards and added a sidebar context-menu action for renaming a tag across every family that uses it.
* Restored the main window natively during Tauri startup so an off-screen or hidden window is centered before the WebView finishes loading.
* Pinned visible font previews in the bounded browser cache so scrolling cannot replace active previews with the browser fallback font.
* Preserved tag name casing during renames, prevented duplicate rename saves, corrected the preview-size thumb alignment, and displayed version 0.3.1 below Settings.
* Standardized tag outlines across card and sidebar filters, aligned the Add tag control, and kept the version alongside the Settings entry as version 0.3.2.
* Corrected context-menu viewport placement and made light-theme Settings blocks lighter while removing borders from solid filled controls.

`Direct Commit` · `pending`

---

### <sup><sub style="font-size: 0.7em;">2026-09-19</sub></sup> · 🐛 Fixes · Prevent Large Library Scan Slowdowns
* Indexed Google Fonts family fallback metadata so scan decoration no longer searches the entire catalogue for every Google font.
* Parallelized bounded font parsing workers while preserving deterministic result ordering, cache reuse, and scan progress reporting.
* Adapted scan concurrency to cache coverage: warm rescans now use a larger I/O pool while cold parsing remains CPU-bounded, and progress events are throttled to protect the WebView.
* Isolated scan counters from the full sidebar and settings trees and coalesced frontend progress updates, preventing high WebView CPU usage during long scans.
* Deferred local and Google preview font loading until the library scan is ready, keeping preview I/O off the scan's critical path.
* Stopped the automatic Google catalogue refresh during startup so metadata/tag updates cannot block the interface; refresh remains available from Settings.
* Aligned a 16-family browser preview cache with reduced grid overscan, loaded up to four safe previews concurrently after the first paint, and prevented evicted in-flight loads from re-registering themselves during fast scrolling.
* Prevented Chromium from automatically decoding full local font files larger than 8 MB unless a dedicated preview asset is available, avoiding multi-hundred-megabyte CJK and variable-font expansions.
* Removed the unused full-library ready event so startup no longer serializes and sends the same large font snapshot to the WebView twice.

`Direct Commit` · `pending`

---

### <sup><sub style="font-size: 0.7em;">2026-09-19</sub></sup> · 🎨 UI/UX · Relocate Keyboard Shortcuts to Settings & Streamline Sidebar Footer
* Moved keyboard shortcuts view into the Settings modal under a dedicated "Keyboard shortcuts" category.
* Removed the separate keyboard shortcuts row from the bottom-left sidebar menu.
* Replaced the sidebar **About** entry with **Settings** in the footer, removing the redundant gear icon from the title bar.
* Configured the `?` hotkey and Command Palette shortcuts action to immediately open Settings focused on the shortcuts panel.
* Removed the deprecated About view and standalone shortcuts overlay while keeping all nine language locales fully synchronized.

`Direct Commit` · `pending`

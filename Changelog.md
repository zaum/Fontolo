# Fontolo — Changelog

* **Total commits:** 85
* **Date range:** 2026-09-14 – 2026-09-24
* **Environment / Context:** Main branch development — compare panel polish, drag-and-drop tagging, sidebar filter fixes, icon refresh and UI token cleanup

---

### <sup><sub style="font-size: 0.7em;">2026-09-24</sub></sup> · 🛠️ Maintenance · Compare, Drag-and-Drop and Sidebar Interaction Polish
* Reworked the Compare overlay into a near-full-screen white panel with adaptive card layouts: two cards stack vertically and larger sets fan into responsive columns while filling the available space.
* Added pointer-based font dragging with a larger cursor preview: up to three fanned icons, the total font count on the leading icon, and targeted drops that apply the chosen tag or collection only to the hovered row.
* Restored the tag chip removal affordance and the sidebar tag clear control, while preserving active filters when returning to Library.
* Refreshed the application icon set from the root SVG source, aligned the accent cleanup and search icon state, and bumped the app version to `0.3.58`.

`Direct Commit` · `pending`

---
### <sup><sub style="font-size: 0.7em;">2026-09-23</sub></sup> · 🚀 Features · Double-Click Opens the Detail Panel
* Double-clicking a font card now opens the detail panel on the right for that family, and a second double-click on the same family closes it again — the gesture is a toggle.
* Plain single clicks keep their select-only behavior, and Ctrl/Shift clicks still extend the multi-selection without opening or closing anything.
* Double-clicking a different family while the panel is open simply switches the panel to that family instead of closing it.
* Compare-picking mode and the card's own buttons (lamp, star, expander, tag chips) are untouched — a double-click on them never toggles the panel.
* The bottom hint strip spells the gesture out next to the lamp legend, in all nine shipped languages.

`Direct Commit` · `7fd2750`

---

### <sup><sub style="font-size: 0.7em;">2026-09-23</sub></sup> · 🐛 Fixes · WebView Autofill Popup Silenced on Text Fields
* Disabled the WebView's built-in form autofill ("Saved info" suggestions) on every free-text input — the global search, the command palette, sample-text fields, the bulk-tag prompt and the collection/tag name editors — so Windows no longer drops a native suggestion popup over the interface while typing.
* The suggestions were never an app feature: they came from the WebView2 control remembering previously typed values; every affected input now explicitly opts out with `autoComplete="off"`.

`Direct Commit` · `52d0ed3`

---

### <sup><sub style="font-size: 0.7em;">2026-09-23</sub></sup> · 🐛 Fixes · Grid No Longer Jumps on Activation
* Activating a font re-publishes the library, which rebuilt the selection array with identical contents and re-fired the grid's scroll-to-selection effect — yanking the middle view back to the selected font while the user was reading a card further down.
* The selection store now keeps the existing array whenever its contents did not actually change, and the grid's scroll effect only reacts when the focused family itself changes, so the scroll position stays put during activation, tag edits and background rescans.

`Direct Commit` · `0f816f1`

---

### <sup><sub style="font-size: 0.7em;">2026-09-23</sub></sup> · 🚀 Features · Filter Sidebar Selection Survives a Restart
* The left filter sidebar now comes back exactly as it was left: the open browse list, the collection, tag and foundry filters, and the trash area are all remembered between runs.
* Restored selections are validated against the fresh library, so a tag, collection or foundry that was deleted or renamed in the meantime is dropped instead of opening the app on a filter that can only ever be empty.
* Whichever way the selection changes — a sidebar click, a Shift/Ctrl multi-select or a command palette jump — it is written together with the other UI preferences, and the sidebar's expanded sections keep their state alongside it.

`Direct Commit` · `6723d74`

---

### <sup><sub style="font-size: 0.7em;">2026-09-23</sub></sup> · 🚀 Features · Single Activation Lamp with Mouse Gestures
* Replaced the two stacked lamps with one larger lamp per family, style row and waterfall header: left click activates permanently, right click or Shift+left click activates until quit, and Caps Lock always activates until quit.
* Added a permanent hint strip at the very bottom of the window, under every panel, that spells out the lamp gestures for the current setting.
* Added an Auto activation setting that mirrors the roles — left click then holds fonts until quit and right click or Shift+left click activates permanently, with Caps Lock still until quit.
* Session activation of a single style row now records its path, so that row's lamp turns yellow instead of green when it is only held until quit.

`Direct Commit` · `c887ed4`

---

### <sup><sub style="font-size: 0.7em;">2026-09-23</sub></sup> · 🎨 UI/UX · Activation Lamp Restyle
* Enlarged the activation lamps and dropped the permanent grey ring, so the circles read as clean dots in both card and waterfall layouts.
* Activation colors no longer follow the theme accent: fixed activation is green, session (until-quit) activation is yellow, and off stays grey.
* The dashed ring now appears only when at least one style is active but not all of them, drawn in the lamp's own color.

`Direct Commit` · `pending`

---

### <sup><sub style="font-size: 0.7em;">2026-09-23</sub></sup> · 🚀 Features · Dual Activation Lamps
* Replaced the single activation pill on family cards and the waterfall view with two stacked circular lamps: the top one toggles permanent activation, the bottom one toggles until-quit (session) activation, both moved to the start of each card head, style row and waterfall header.
* Added per-path session tracking so the session lamp only lights for fonts actually held by this session, and session deactivation routes through the normal deactivate command while clearing the session marks.
* Families that are active but only partially (some styles on, some off) now show a dashed accent ring around the matching lamp instead of a misleading solid state.
* The generic pill toggle remains in place for settings and the detail panel; only font activation controls changed.

`Direct Commit` · `pending`

---

### <sup><sub style="font-size: 0.7em;">2026-09-23</sub></sup> · 🐛 Fixes · Restored Dark Theme Tokens
* Restored the dark palette as the default theme tokens and added an explicit dark override, so switching to dark mode shows light text on the dark canvas again.
* Brought back the dark and light hero and settings glass gradients that had been flattened to solid colors.

`Direct Commit` · `pending`

---

### <sup><sub style="font-size: 0.7em;">2026-09-23</sub></sup> · 🚀 Features · Remembered Filter Sidebar Sections
* The left filter sidebar now remembers which of its sections — Browse, Collections, Tags and Foundry — were collapsed or expanded, so the layout stays as the user left it after a restart.
* Section states are stored with the other application preferences and fall back to expanded when no saved value exists yet.

`Direct Commit` · `pending`

---

### <sup><sub style="font-size: 0.7em;">2026-09-23</sub></sup> · 🎨 UI/UX · OpenType Features Reset Removal
* Removed the Reset button from the OpenType features section of the details panel, so a modified feature chip returns to its default only by clicking it back individually.

`Direct Commit` · `pending`

---

### <sup><sub style="font-size: 0.7em;">2026-09-23</sub></sup> · 🎨 UI/UX · Location Truncation & Button-Only Style Expansion
* Truncated the Location path to a single line with an ellipsis when it does not fit, while the hover tooltip still reveals the full path.
* Restricted style-list expansion to the Styles count button, so a plain click on the card body only selects the family instead of opening the styles.

`Direct Commit` · `pending`

---

### <sup><sub style="font-size: 0.7em;">2026-09-23</sub></sup> · 🚀 Features · Clickable Foundry Web Links
* Turned any web address embedded in the Foundry value into a clickable link that opens in the system default browser, following the licence link's existing opener and error toast.
* Left foundry values without a URL as plain text and stripped trailing punctuation, so a closing period or parenthesis never becomes part of the address.

`Direct Commit` · `pending`

---

### <sup><sub style="font-size: 0.7em;">2026-09-23</sub></sup> · 🎨 UI/UX · App-Wide Count Sizing
* Introduced a global `--fs-count` token and applied it to every item count — sidebar Browse rows, top bar result count, filter chip, install progress, card style-count button, the trash status line, and the panel's Styles/Glyphs counts — set slightly smaller than before.
* Documented the convention in `AGENTS.md` so future changes keep one count size everywhere.

`Direct Commit` · `pending`

---

### <sup><sub style="font-size: 0.7em;">2026-09-23</sub></sup> · 🎨 UI/UX · Information Panel Layout Cleanup
* Moved the waterfall preview block directly under the glyph map (or the Google catalogue preview) instead of the panel bottom, so large-size comparison sits right below the glyph grid.
* Removed the format row and the tags block from the panel, and shrank the metadata labels such as file size and styles.
* Changed the glyph grid so a left click zooms in and a right click copies the character, with the two gestures noted beside the Glyphs heading.
* Made a second left click on the zoomed glyph close the preview, so the enlarged view toggles instead of requiring the pointer to move away.
* Added live item counts after the Styles and Glyphs headings, tightened the style list line spacing for a more compact look, and stopped the glyph grid from flashing while a newly selected style's character set loads.
* Kept the OpenType feature chips mounted while the next style's feature list loads, so the sections below — including the glyph grid — no longer jump on every style click.
* Removed the Styles row from the metadata list, moved file size directly under location, and right-closed the left-click-to-zoom hint against the glyph size controls.

`Direct Commit` · `pending`

---

### <sup><sub style="font-size: 0.7em;">2026-09-23</sub></sup> · 🛠️ Maintenance · Complete Locale Coverage
* Translated every remaining English fallback key across all nine languages — empty states, sidebar sections, command palette destinations, settings, toasts, and Affinity help.
* Added the plural forms each language needs for open-document and duplicate-skip counts.
* Every locale now reports 100% coverage in `pnpm i18n:check`.

`Direct Commit` · `pending`

---

### <sup><sub style="font-size: 0.7em;">2026-09-21</sub></sup> · 🐛 Fixes · Responsive Large-Family Operations
* Prevented an import from immediately scheduling a duplicate full-library rescan when the installer already returns its parsed font faces.
* Suppressed repeated file-watcher events for files written by Fontolo and throttled intermediate import-progress paints to keep the interface responsive.
* Limited automatic activation to imports of at most 12 font files, avoiding expensive bulk registration for large families while keeping every imported file available for manual activation.
* Moved bulk activation and deactivation onto background workers, while showing a pending state on the affected controls until Windows completes its registry and font-resource operations.

`Direct Commit` · `pending`

---

### <sup><sub style="font-size: 0.7em;">2026-09-21</sub></sup> · 🎨 UI/UX · Focused Glyph Inspection
* Removed the information panel's favorite, close, specimen, and family activation controls while retaining the format badge and font name in its first row.
* Added a click-triggered preview that enlarges a glyph fivefold, keeps the existing clipboard copy action, remains visible while the pointer is over it, hides the cursor within the preview, and closes on the next glyph click.

`Direct Commit` · `pending`

---

### <sup><sub style="font-size: 0.7em;">2026-09-21</sub></sup> · 🎨 UI/UX · Wider Resizable Information Panel
* Increased the maximum width of the right-side information panel from 560 px to 800 px while retaining its 300 px minimum and persisted width preference.

`Direct Commit` · `pending`

---

### <sup><sub style="font-size: 0.7em;">2026-09-21</sub></sup> · 🎨 UI/UX · Adjustable Glyph Map Size
* Added compact decrease and zoom-in controls above the glyph map to resize glyphs in clear four-pixel steps.
* Remembered the selected size globally in the application settings, including across restarts, rather than storing it per font.
* Kept the glyph grid responsive at every supported size, added breathing room before the copy hint, and included translated accessible labels for the controls.

`Direct Commit` · `pending`

---

### <sup><sub style="font-size: 0.7em;">2026-09-21</sub></sup> · 🎨 UI/UX · Streamline Font Details and Sidebar Assignment
* Replaced the per-card details strip with a dedicated toolbar control whose highlighted inset panel indicates that font details are visible.
* Kept the details panel beneath the toolbar and refreshed it for the active single font selection without allowing card clicks to open or close it.
* Added drag-and-drop assignment for one or more selected font families onto sidebar tags and collections, including an accent-highlighted drop target.
* Restyled sidebar tags as smaller outlined chips matching font-card tags, added a Browse-level Reset All action, and right-aligned the smaller Settings version label.
* Added the selected-card accent rail and retained the filled yellow conflict indicator.
* Ensured every non-empty font list selects its first available family when navigation or filtering replaces the previous selection, so the details control always has content.
* Made the Add tag control use the same compact filled chip treatment as the assigned font tags.
* Preserved an active font when the current card is clicked again or when a multi-selection changes, keeping the details panel available at all times.
* Changed sidebar tag filters from full-width rows to compact, content-width outlined chips.
* Moved the details panel into the workspace below the toolbar so its width never reduces the top toolbar.
* Kept the details-toggle pane visible while inactive and separated sidebar tag counts from their compact font-card-matching chips.
* Restored an empty default selection, with plain clicks selecting one font and modifier clicks reserved for multi-selection.
* Accepted sidebar tag and collection drop targets during all browser drag phases so Tauri's delayed custom MIME reporting no longer shows a prohibited-drop cursor.
* Restored first-font selection when a non-empty list opens while retaining plain-click single selection and modifier-only multi-selection.
* Made sidebar tags use two columns at narrow sidebar widths, expanding to three only when the sidebar is wide enough.

`Direct Commit` · `pending`

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

---

### <sup><sub style="font-size: 0.7em;">2026-09-19</sub></sup> · 🐛 Fixes · Google Fonts Rebuilt as a Two-Stage Provider
* Diagnosed why the catalogue download always stopped inside the "B" families: Google's gstatic file names reach 238 characters, and the old naming scheme prefixed them with the family name, producing a 316-character path that no Windows path can hold. The first failing family (`Bitcount Grid Double Ink`) aborted the whole sync, and because the manifest was only written at the very end, every retry started from scratch and died at the same place.
* Rebuilt Google Fonts as two stages: browsing is metadata only (the lightweight catalogue JSON), and the styles on screen fetch a few kilobytes of WOFF2 web font on demand into a dedicated preview cache that is never scanned as a library.
* Activation now downloads the full desktop TTF/OTF of a style into the ordinary library folder and registers it with the system, so Photoshop, Figma and Word see it on Linux, Windows and macOS; an installed family keeps its real, toggleable styles.
* Reduced the Settings sync button to a single metadata request that reports how many families are new — it no longer downloads anything.
* Made downloads resilient: per-family progress persistence, isolated errors that no longer abort the sync, and retries with backoff for rate limits and server errors.
* Removed the family-wide toggle on catalogue families and let each style's existing activate button download, install and activate that style in one step.
* Hid glyph map, OpenType features and character set for preview-only families, showing a hint that activation reveals the details.
* Showed the catalogue count in the sidebar and added a preview-cache size with a clear-cache control to Settings; all nine locales were extended and re-verified.
* Added unit tests for the safe file naming (including the 238-character gstatic name that broke the download), CSS block parsing and `METADATA.pb` style parsing. Verified TypeScript, cargo check, all Rust and Node tests, and the locale check on Windows; Linux and macOS runtime checks were not performed.

`Uncommitted` · `working tree`

---

### <sup><sub style="font-size: 0.7em;">2026-09-18</sub></sup> · 🛠️ Maintenance · Affinity probe robustness, settings order, and reqwest TLS backend
* Moved the Affinity enable toggle above the connection row so users can turn the integration on before reading its status.
* Treated a reachable Affinity socket with an unreadable SDK preamble as a documentation problem instead of a lost connection, with a longer preamble read timeout and clearer error text.
* Added a rustls TLS backend with the operating system's trust store so future HTTPS calls work on Linux, Windows, and macOS; the Affinity MCP socket itself stays plain HTTP on loopback.
* Verified the Rust Affinity tests and backend type check on Windows; Linux and macOS runtime checks were not performed.

`Uncommitted` · `working tree`

---

### <sup><sub style="font-size: 0.7em;">2026-09-17</sub></sup> · 🛠️ Maintenance · Remove Obsolete Scan Cache Usage Tracking
* Removed the unused cache usage counter and its atomic updates after cache admission switched to retaining a stable subset of entries.
* Made cache hits read-only and removed the unused mutable lookup helper and obsolete eviction comments.
* Kept temporary-directory identifiers independent in tests, without restoring production usage tracking.
* Verified all 15 Rust tests, all 5 Node tests, and the TypeScript/Vite production build on Windows.
* Built the development executable and restarted it with the development server available; the new process opened a responsive Fontolo window. Linux and macOS runtime checks were not performed.
* Retained the 40,000-entry and estimated 256 MiB cache limits; the byte budget does not cap whole-application memory or transient deserialization allocations.
* Kept single-writer atomic cache replacement. Serialization and file writing still hold the cache lock, so concurrent scans may wait; crash-left temporary files are not automatically deleted without a safe ownership criterion.
* Left frontend bundle splitting and cache-lock redesign for measured follow-up work; no startup or scan timing improvement was claimed.
* Excluded Affinity changes from this cleanup. This entry describes uncommitted work and does not increase the commit total above.

`Uncommitted` · `working tree`

---

### <sup><sub style="font-size: 0.7em;">2026-09-17</sub></sup> · 🎨 UI/UX · Preview Size Slider Polish & Larger Maximum
* Shrunk the preview size slider thumb from 15 px to 12 px for a lighter toolbar feel.
* The thumb now stays hidden until needed and fades in on hover, focus or while dragging.
* Raised the maximum preview size from 96 px to 128 px, with stored size preferences clamped to the valid range.

`Direct Commit` · `ae56778`

---

### <sup><sub style="font-size: 0.7em;">2026-09-17</sub></sup> · 🎨 UI/UX · Sample-Text Toolbar Becomes a T-Button Popup
* Replaced the wide toolbar preview-text field with a single T-icon button that opens a small popup under the icon, with a caret pointing back at the button.
* Added a "Font name as preview" option first in the list (italic label, dashed border, no accent color) that renders each family in its own name across cards, detail panel, waterfall, compare and specimen export.
* Added a presets section with uppercase alphabet, lowercase alphabet, digits and the localized pangram sentence.
* Added a custom section where each saved text is edited inline, deleted with the trailing x button and selected by focusing its row.
* Added an empty add-row with a leading + button that saves the typed text as a new custom sample on click or Enter.
* Added a small footer link to the Wikipedia pangram page for pangrams in many more languages.
* Clicking outside the popup or pressing Escape closes it without changing the preview.
* Persisted the font-name mode and the custom list alongside the existing preview-text preference.

`Direct Commit` · `648bf82`

---

### <sup><sub style="font-size: 0.7em;">2026-09-17</sub></sup> · 🐛 Fixes · Smooth Sidebar Drag-Resize
* Sidebar drag-resize no longer re-renders on every mouse move: the width is applied directly to the DOM node during the drag and committed to the store once on release.
* Inner transitions and keyframe animations are frozen while dragging, so the accent selection pill no longer re-animates mid-drag.
* Resize grip targets its own parent element instead of a forwarded ref, so the drag feedback is always visible.

`Direct Commit` · `e9a981b`

---

### <sup><sub style="font-size: 0.7em;">2026-09-17</sub></sup> · 🚀 Features · Resizable Filter Sidebar
* Left filter sidebar is resizable by dragging its right edge (248 px minimum, 520 px maximum).
* Sidebar width is remembered across restarts via persisted prefs.
* Double-click on the resize edge resets to the default width.
* Resize label translated for all 9 languages.

`Direct Commit` · `eae4b72`

---

### <sup><sub style="font-size: 0.7em;">2026-09-16</sub></sup> · 🚀 Features · Background Font Scanning & Caching
* Font scanning now runs entirely in the background with live UI progress and cached results, preventing UI blocking during initial load or refresh.
* Repeated scan triggers are coalesced and queued automatically.

`Direct Commit` · `f654bef`

---

### <sup><sub style="font-size: 0.7em;">2026-09-16</sub></sup> · 🛠️ Maintenance · Font Cache & Store Performance Optimization
* Implemented faster UI rendering pipelines leveraging cached font metadata.
* Enhanced asynchronous store behavior, error handling, and diagnostic logging.

`Direct Commit` · `c738215`

---

### <sup><sub style="font-size: 0.7em;">2026-09-16</sub></sup> · 🚀 Features · Asynchronous Font Scanner Integration
* Moved file system scanning to background workers to keep the main thread responsive.

`Direct Commit` · `d318b66`

---

### <sup><sub style="font-size: 0.7em;">2026-09-16</sub></sup> · 🚀 Features · Active Filter Reset & Foundry Categorization
* Added a dedicated "Reset filters" control to clear active search and category selections in one click.
* Improved foundry grouping logic and expanded locale strings across 9 languages.

`Direct Commit` · `769a936`

---

### <sup><sub style="font-size: 0.7em;">2026-09-16</sub></sup> · 🚀 Features · Collapsible Sidebar Sections & Foundry Filters
* Made Browse sections in the sidebar collapsible to save vertical screen space.
* Added support for filtering installed and imported fonts by foundry, vendor, or source metadata.

`Direct Commit` · `c6e77e0`

---

### <sup><sub style="font-size: 0.7em;">2026-09-16</sub></sup> · 🚀 Features · Custom Accent Colors & TopBar Actions
* Users can now select predefined or custom accent colors saved to local storage that tint focus states and active controls app-wide.
* Added explicit "Expand All" and "Collapse All" toggle controls to the TopBar.
* Refactored internal navigation handling for enhanced multi-selection and context menu behavior.

`Direct Commit` · `04597fb`

---

### <sup><sub style="font-size: 0.7em;">2026-09-16</sub></sup> · 🛠️ Maintenance · Pull Request Merge: Dense Sidebar Feature Branch
* Integrated feature branch containing refined sidebar density and navigation improvements into main stream.

`PR: zaum/fontolo#1` · `1a5c4f5`

---

### <sup><sub style="font-size: 0.7em;">2026-09-16</sub></sup> · 🛠️ Maintenance · Branch Synchronization
* Merged main upstream updates back into the `feature/all-features-dense-sidebar` development branch.

`Direct Commit` · `cf9a63b`

---

### <sup><sub style="font-size: 0.7em;">2026-09-16</sub></sup> · 🛠️ Maintenance · Routine Fixes & Internal Cleanups
* Minor code adjustments and internal state updates.

`Direct Commit` · `a513719`

---

### <sup><sub style="font-size: 0.7em;">2026-09-16</sub></sup> · 🛠️ Maintenance · Routine Fixes & Internal Cleanups
* Internal maintenance fixes applied to background workers.

`Direct Commit` · `635a679`

---

### <sup><sub style="font-size: 0.7em;">2026-09-16</sub></sup> · 🚀 Features · Single-Pass Bulk Font Activation
* Optimized font activation workflows by syncing bulk path requests in a single IPC pass.

`Direct Commit` · `f26ee46`

---

### <sup><sub style="font-size: 0.7em;">2026-09-15</sub></sup> · 🛠️ Maintenance · Installation Path & Feedback Improvements
* Cleaned up native binary installation pathing and improved reliability of toast error messages upon execution failure.

`Direct Commit` · `dd58e7e`

---

### <sup><sub style="font-size: 0.7em;">2026-09-15</sub></sup> · 🎨 UI/UX · Context Menu & Sidebar Styling Polish
* Refined visual hierarchy, padding, and hover states for context menus and sidebar items.

`Direct Commit` · `404fedc`

---

### <sup><sub style="font-size: 0.7em;">2026-09-15</sub></sup> · 🛠️ Maintenance · Cleanup Temporary Artifacts
* Removed accidentally tracked temporary build files from version control.

`Direct Commit` · `6a28599`

---

### <sup><sub style="font-size: 0.7em;">2026-09-15</sub></sup> · 🛠️ Maintenance · Affinity Auto-Activation Integration
* Merged the `affinity-auto-activation` feature branch into the unified integration pipeline.

`Direct Commit` · `a645604`

---

### <sup><sub style="font-size: 0.7em;">2026-09-15</sub></sup> · 🛠️ Maintenance · Repository & Tooling Maintenance
* Updated `.gitignore` rules to exclude local screenshots and development utility scripts.

`Direct Commit` · `83d7c07`

---

### <sup><sub style="font-size: 0.7em;">2026-09-15</sub></sup> · 🐛 Fixes · Settings Panel Layout Spacing
* Corrected container height constraints and subcategory heading margins inside the Settings modal.

`Direct Commit` · `6179098`

---

### <sup><sub style="font-size: 0.7em;">2026-09-15</sub></sup> · 🚀 Features · Two-Column Settings Layout & Light Theme Refresh
* Redesigned Settings into a responsive two-column layout featuring dedicated sidebar navigation and consolidated preferences.
* Introduced `Ctrl+A` select-all, multi-item favoriting, and the ability to hide active system fonts from the "Activated" view.
* Updated theme palettes with a brighter, cleaner light mode visual profile.

`Direct Commit` · `45301a9`

---

### <sup><sub style="font-size: 0.7em;">2026-09-15</sub></sup> · 🐛 Fixes · Duplicate Toast Notification Guard
* Resolved an issue causing duplicate toast messages during store initialization lifecycle.

`Direct Commit` · `41c03aa`

---

### <sup><sub style="font-size: 0.7em;">2026-09-15</sub></sup> · 🚀 Features · Standard MCP Tool Call Execution
* Migrated Affinity MCP operations to invoke functions via standardized `tools/call` JSON-RPC execution routes.

`Direct Commit` · `ed2ecdf`

---

### <sup><sub style="font-size: 0.7em;">2026-09-15</sub></sup> · 🚀 Features · Safe MCP Script Execution Preamble
* Integrated strict preamble evaluation prior to running execution scripts inside the Affinity MCP runtime.

`Direct Commit` · `9005f05`

---

### <sup><sub style="font-size: 0.7em;">2026-09-15</sub></sup> · 🚀 Features · IPv6 Loopback Prioritization for MCP
* Configured local Affinity MCP connection probes to prefer IPv6 loopback channels for improved network reliability.

`Direct Commit` · `8894710`

---

### <sup><sub style="font-size: 0.7em;">2026-09-15</sub></sup> · 🚀 Features · Standalone Affinity Probe & Connection Status
* Added independent polling for Affinity suite application state with clear connection indicators inside Settings.

`Direct Commit` · `d3f8d36`

---

### <sup><sub style="font-size: 0.7em;">2026-09-15</sub></sup> · 🚀 Features · Affinity Suite Auto-Activation via MCP Server
* Implemented live automatic font activation for Affinity Suite applications (Photo, Designer, Publisher) through an embedded Model Context Protocol (MCP) server.
* Fonts are automatically registered on-demand and safely released when no longer referenced.

`Direct Commit` · `bf77bce`

---

### <sup><sub style="font-size: 0.7em;">2026-09-15</sub></sup> · 🎨 UI/UX · Custom Folder Settings Layout
* Formatted custom folder preferences into a single-line view and adjusted the "Default" tag contrast.

`Direct Commit` · `0e65005`

---

### <sup><sub style="font-size: 0.7em;">2026-09-15</sub></sup> · 🚀 Features · Persistent Custom Library Pathing
* Decoupled custom folder toggle state from its target directory path, preserving the previous path when toggled back on.

`Direct Commit` · `188040e`

---

### <sup><sub style="font-size: 0.7em;">2026-09-15</sub></sup> · 🚀 Features · Custom Target Directory for Import Links
* Added a Settings option enabling custom target directory configuration for link-in-place operations.

`Direct Commit` · `c226fbd`

---

### <sup><sub style="font-size: 0.7em;">2026-09-15</sub></sup> · 🛠️ Maintenance · Lock Dependency Crate
* Fixed native dependency versions for system recycle bin and trash handling libraries.

`Direct Commit` · `76657f4`

---

### <sup><sub style="font-size: 0.7em;">2026-09-15</sub></sup> · 🚀 Features · OS Recycle Bin Deletion Strategy
* Configured font removals to send files to the native OS Recycle Bin or Trash rather than performing permanent deletions where supported.

`Direct Commit` · `c05883b`

---

### <sup><sub style="font-size: 0.7em;">2026-09-15</sub></sup> · 🎨 UI/UX · Drop Overlay Dynamics & Context Text
* Added visual elevation to active drag targets, dimmed background drop areas, and contextualized clipboard title formatting.

`Direct Commit` · `9709925`

---

### <sup><sub style="font-size: 0.7em;">2026-09-15</sub></sup> · 🐛 Fixes · Cursor-Based Drop Overlay Positioning
* Switched drag/drop target placement calculations to use native Tauri cursor coordinates, resolving positioning bugs caused by DOM drag event offsets.

`Direct Commit` · `17c85e8`

---

### <sup><sub style="font-size: 0.7em;">2026-09-15</sub></sup> · 🐛 Fixes · Import Overlay Styling & Destructive Action Warnings
* Corrected hover highlights on drag overlays and added explicit visual warnings for destructive file moves.

`Direct Commit` · `bbbb63e`

---

### <sup><sub style="font-size: 0.7em;">2026-09-15</sub></sup> · 🚀 Features · Drag & Drop Import Strategy Overlay
* Introduced an interactive overlay when dragging fonts into the app, giving users explicit choices to link fonts in place or copy them into the library directory.

`Direct Commit` · `b499091`

---

### <sup><sub style="font-size: 0.7em;">2026-09-15</sub></sup> · 🐛 Fixes · Inactive Font Readability Enhancement
* Removed dimmed visual opacity styling on deactivated font cards to maintain crisp text contrast.

`Direct Commit` · `6d22618`

---

### <sup><sub style="font-size: 0.7em;">2026-09-15</sub></sup> · 🎨 UI/UX · Card Animation Removal
* Removed the hover shine animation effect on family cards for a cleaner desktop feel.

`Direct Commit` · `f52000b`

---

### <sup><sub style="font-size: 0.7em;">2026-09-15</sub></sup> · 🎨 UI/UX · Interactive Folder Links in Detail View
* Made file location paths in the detail panel clickable, opening the target directory directly in the native OS file explorer.

`Direct Commit` · `1f940c7`

---

### <sup><sub style="font-size: 0.7em;">2026-09-15</sub></sup> · 🎨 UI/UX · Compact Conflict Management Bar
* Collapsed conflict actions into a single row layout and updated inactive badges to neutral gray.

`Direct Commit` · `1aa53a0`

---

### <sup><sub style="font-size: 0.7em;">2026-09-15</sub></sup> · 🎨 UI/UX · Streamlined Name Conflict Controls
* Replaced destructive removal buttons in the conflict resolution overlay with unified active state switches.

`Direct Commit` · `a37dec7`

---

### <sup><sub style="font-size: 0.7em;">2026-09-15</sub></sup> · 🚀 Features · Granular File Conflict Management
* Users can now individually resolve, un-link, or send conflicting font files to trash within the conflict resolution panel.

`Direct Commit` · `e21ec16`

---

### <sup><sub style="font-size: 0.7em;">2026-09-15</sub></sup> · 🚀 Features · Import Auto-Activation & Duplicate Dialog
* Added optional auto-activation for batch imports (up to 64 fonts simultaneously, off by default).
* Replaced temporary toast notifications for duplicates with a centered, auto-dismissing modal dialog.

`Direct Commit` · `3e6f76d`

---

### <sup><sub style="font-size: 0.7em;">2026-09-14</sub></sup> · 🎨 UI/UX · Interface Layout & Navigation Polish
* Positioned search control to the primary position in TopBar with a quick clear action.
* Compacted sidebar row heights to 29 px and widened sidebar width to 248 px for label clarity.
* Standardized context menu backgrounds and adjusted preview panel toggles.

`Direct Commit` · `a286c30`

---

### <sup><sub style="font-size: 0.7em;">2026-09-14</sub></sup> · 🚀 Features · Categorized Font Filtering & Store Session Trackers
* Introduced sidebar filters for Activated, Activated until close, Deactivated, and System fonts with dynamic counts and empty states.
* Implemented session-only font activation state tracking in the primary store.

`Direct Commit` · `c05029e`


# ZFontManager — Changelog

* **Total commits:** 45
* **Date range:** 2026-09-14 – 2026-09-17
* **Environment / Context:** Personal fork & feature integration

---

### 2026-09-17 · 🎨 UI/UX · Preview Size Slider Polish & Larger Maximum

* Shrunk the preview size slider thumb from 15 px to 12 px for a lighter toolbar feel.
* The thumb now stays hidden until needed and fades in on hover, focus or while dragging.
* Raised the maximum preview size from 96 px to 128 px, with stored size preferences clamped to the valid range.

`Direct Commit` · `ae56778`

---

### 2026-09-17 · 🎨 UI/UX · Sample-Text Toolbar Becomes a T-Button Popup

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

### 2026-09-17 · 🐛 Fixes · Smooth Sidebar Drag-Resize

* Sidebar drag-resize no longer re-renders on every mouse move: the width is applied directly to the DOM node during the drag and committed to the store once on release.
* Inner transitions and keyframe animations are frozen while dragging, so the accent selection pill no longer re-animates mid-drag.
* Resize grip targets its own parent element instead of a forwarded ref, so the drag feedback is always visible.

`Direct Commit` · `e9a981b`

---

### 2026-09-17 · 🚀 Features · Resizable Filter Sidebar

* Left filter sidebar is resizable by dragging its right edge (248 px minimum, 520 px maximum).
* Sidebar width is remembered across restarts via persisted prefs.
* Double-click on the resize edge resets to the default width.
* Resize label translated for all 9 languages.

`Direct Commit` · `eae4b72`

---

### 2026-09-16 · 🚀 Features · Background Font Scanning & Caching

* Font scanning now runs entirely in the background with live UI progress and cached results, preventing UI blocking during initial load or refresh.
* Repeated scan triggers are coalesced and queued automatically.

`Direct Commit` · `f654bef`

---

### 2026-09-16 · 🛠️ Maintenance · Font Cache & Store Performance Optimization

* Implemented faster UI rendering pipelines leveraging cached font metadata.
* Enhanced asynchronous store behavior, error handling, and diagnostic logging.

`Direct Commit` · `c738215`

---

### 2026-09-16 · 🚀 Features · Asynchronous Font Scanner Integration

* Moved file system scanning to background workers to keep the main thread responsive.

`Direct Commit` · `d318b66`

---

### 2026-09-16 · 🚀 Features · Active Filter Reset & Foundry Categorization

* Added a dedicated "Reset filters" control to clear active search and category selections in one click.
* Improved foundry grouping logic and expanded locale strings across 9 languages.

`Direct Commit` · `769a936`

---

### 2026-09-16 · 🚀 Features · Collapsible Sidebar Sections & Foundry Filters

* Made Browse sections in the sidebar collapsible to save vertical screen space.
* Added support for filtering installed and imported fonts by foundry, vendor, or source metadata.

`Direct Commit` · `c6e77e0`

---

### 2026-09-16 · 🚀 Features · Custom Accent Colors & TopBar Actions

* Users can now select predefined or custom accent colors saved to local storage that tint focus states and active controls app-wide.
* Added explicit "Expand All" and "Collapse All" toggle controls to the TopBar.
* Refactored internal navigation handling for enhanced multi-selection and context menu behavior.

`Direct Commit` · `04597fb`

---

### 2026-09-16 · 🛠️ Maintenance · Pull Request Merge: Dense Sidebar Feature Branch

* Integrated feature branch containing refined sidebar density and navigation improvements into main stream.

`PR: zaum/ZFontManager#1` · `1a5c4f5`

---

### 2026-09-16 · 🛠️ Maintenance · Branch Synchronization

* Merged main upstream updates back into the `feature/all-features-dense-sidebar` development branch.

`Direct Commit` · `cf9a63b`

---

### 2026-09-16 · 🛠️ Maintenance · Routine Fixes & Internal Cleanups

* Minor code adjustments and internal state updates.

`Direct Commit` · `a513719`

---

### 2026-09-16 · 🛠️ Maintenance · Routine Fixes & Internal Cleanups

* Internal maintenance fixes applied to background workers.

`Direct Commit` · `635a679`

---

### 2026-09-16 · 🚀 Features · Single-Pass Bulk Font Activation

* Optimized font activation workflows by syncing bulk path requests in a single IPC pass.

`Direct Commit` · `f26ee46`

---

### 2026-09-15 · 🛠️ Maintenance · Installation Path & Feedback Improvements

* Cleaned up native binary installation pathing and improved reliability of toast error messages upon execution failure.

`Direct Commit` · `dd58e7e`

---

### 2026-09-15 · 🎨 UI/UX · Context Menu & Sidebar Styling Polish

* Refined visual hierarchy, padding, and hover states for context menus and sidebar items.

`Direct Commit` · `404fedc`

---

### 2026-09-15 · 🛠️ Maintenance · Cleanup Temporary Artifacts

* Removed accidentally tracked temporary build files from version control.

`Direct Commit` · `6a28599`

---

### 2026-09-15 · 🛠️ Maintenance · Affinity Auto-Activation Integration

* Merged the `affinity-auto-activation` feature branch into the unified integration pipeline.

`Direct Commit` · `a645604`

---

### 2026-09-15 · 🛠️ Maintenance · Repository & Tooling Maintenance

* Updated `.gitignore` rules to exclude local screenshots and development utility scripts.

`Direct Commit` · `83d7c07`

---

### 2026-09-15 · 🐛 Fixes · Settings Panel Layout Spacing

* Corrected container height constraints and subcategory heading margins inside the Settings modal.

`Direct Commit` · `6179098`

---

### 2026-09-15 · 🚀 Features · Two-Column Settings Layout & Light Theme Refresh

* Redesigned Settings into a responsive two-column layout featuring dedicated sidebar navigation and consolidated preferences.
* Introduced `Ctrl+A` select-all, multi-item favoriting, and the ability to hide active system fonts from the "Activated" view.
* Updated theme palettes with a brighter, cleaner light mode visual profile.

`Direct Commit` · `45301a9`

---

### 2026-09-15 · 🐛 Fixes · Duplicate Toast Notification Guard

* Resolved an issue causing duplicate toast messages during store initialization lifecycle.

`Direct Commit` · `41c03aa`

---

### 2026-09-15 · 🚀 Features · Standard MCP Tool Call Execution

* Migrated Affinity MCP operations to invoke functions via standardized `tools/call` JSON-RPC execution routes.

`Direct Commit` · `ed2ecdf`

---

### 2026-09-15 · 🚀 Features · Safe MCP Script Execution Preamble

* Integrated strict preamble evaluation prior to running execution scripts inside the Affinity MCP runtime.

`Direct Commit` · `9005f05`

---

### 2026-09-15 · 🚀 Features · IPv6 Loopback Prioritization for MCP

* Configured local Affinity MCP connection probes to prefer IPv6 loopback channels for improved network reliability.

`Direct Commit` · `8894710`

---

### 2026-09-15 · 🚀 Features · Standalone Affinity Probe & Connection Status

* Added independent polling for Affinity suite application state with clear connection indicators inside Settings.

`Direct Commit` · `d3f8d36`

---

### 2026-09-15 · 🚀 Features · Affinity Suite Auto-Activation via MCP Server

* Implemented live automatic font activation for Affinity Suite applications (Photo, Designer, Publisher) through an embedded Model Context Protocol (MCP) server.
* Fonts are automatically registered on-demand and safely released when no longer referenced.

`Direct Commit` · `bf77bce`

---

### 2026-09-15 · 🎨 UI/UX · Custom Folder Settings Layout

* Formatted custom folder preferences into a single-line view and adjusted the "Default" tag contrast.

`Direct Commit` · `0e65005`

---

### 2026-09-15 · 🚀 Features · Persistent Custom Library Pathing

* Decoupled custom folder toggle state from its target directory path, preserving the previous path when toggled back on.

`Direct Commit` · `188040e`

---

### 2026-09-15 · 🚀 Features · Custom Target Directory for Import Links

* Added a Settings option enabling custom target directory configuration for link-in-place operations.

`Direct Commit` · `c226fbd`

---

### 2026-09-15 · 🛠️ Maintenance · Lock Dependency Crate

* Fixed native dependency versions for system recycle bin and trash handling libraries.

`Direct Commit` · `76657f4`

---

### 2026-09-15 · 🚀 Features · OS Recycle Bin Deletion Strategy

* Configured font removals to send files to the native OS Recycle Bin or Trash rather than performing permanent deletions where supported.

`Direct Commit` · `c05883b`

---

### 2026-09-15 · 🎨 UI/UX · Drop Overlay Dynamics & Context Text

* Added visual elevation to active drag targets, dimmed background drop areas, and contextualized clipboard title formatting.

`Direct Commit` · `9709925`

---

### 2026-09-15 · 🐛 Fixes · Cursor-Based Drop Overlay Positioning

* Switched drag/drop target placement calculations to use native Tauri cursor coordinates, resolving positioning bugs caused by DOM drag event offsets.

`Direct Commit` · `17c85e8`

---

### 2026-09-15 · 🐛 Fixes · Import Overlay Styling & Destructive Action Warnings

* Corrected hover highlights on drag overlays and added explicit visual warnings for destructive file moves.

`Direct Commit` · `bbbb63e`

---

### 2026-09-15 · 🚀 Features · Drag & Drop Import Strategy Overlay

* Introduced an interactive overlay when dragging fonts into the app, giving users explicit choices to link fonts in place or copy them into the library directory.

`Direct Commit` · `b499091`

---

### 2026-09-15 · 🐛 Fixes · Inactive Font Readability Enhancement

* Removed dimmed visual opacity styling on deactivated font cards to maintain crisp text contrast.

`Direct Commit` · `6d22618`

---

### 2026-09-15 · 🎨 UI/UX · Card Animation Removal

* Removed the hover shine animation effect on family cards for a cleaner desktop feel.

`Direct Commit` · `f52000b`

---

### 2026-09-15 · 🎨 UI/UX · Interactive Folder Links in Detail View

* Made file location paths in the detail panel clickable, opening the target directory directly in the native OS file explorer.

`Direct Commit` · `1f940c7`

---

### 2026-09-15 · 🎨 UI/UX · Compact Conflict Management Bar

* Collapsed conflict actions into a single row layout and updated inactive badges to neutral gray.

`Direct Commit` · `1aa53a0`

---

### 2026-09-15 · 🎨 UI/UX · Streamlined Name Conflict Controls

* Replaced destructive removal buttons in the conflict resolution overlay with unified active state switches.

`Direct Commit` · `a37dec7`

---

### 2026-09-15 · 🚀 Features · Granular File Conflict Management

* Users can now individually resolve, un-link, or send conflicting font files to trash within the conflict resolution panel.

`Direct Commit` · `e21ec16`

---

### 2026-09-15 · 🚀 Features · Import Auto-Activation & Duplicate Dialog

* Added optional auto-activation for batch imports (up to 64 fonts simultaneously, off by default).
* Replaced temporary toast notifications for duplicates with a centered, auto-dismissing modal dialog.

`Direct Commit` · `3e6f76d`

---

### 2026-09-14 · 🎨 UI/UX · Interface Layout & Navigation Polish

* Positioned search control to the primary position in TopBar with a quick clear action.
* Compacted sidebar row heights to 29 px and widened sidebar width to 248 px for label clarity.
* Standardized context menu backgrounds and adjusted preview panel toggles.

`Direct Commit` · `a286c30`

---

### 2026-09-14 · 🚀 Features · Categorized Font Filtering & Store Session Trackers

* Introduced sidebar filters for Activated, Activated until close, Deactivated, and System fonts with dynamic counts and empty states.
* Implemented session-only font activation state tracking in the primary store.

`Direct Commit` · `c05029e`
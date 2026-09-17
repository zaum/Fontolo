# ZFontManager — Changelog

* **Total commits:** 1 (uncommitted working-tree change)
* **Date range:** 2026-09-17 – 2026-09-17
* **Environment / Context:** Local dev Session

---

### <sup><sub style="font-size: 0.7em;">2026-09-17</sub></sup> · 🎨 UI/UX · Sample-Text Toolbar Becomes a T-Button Popup
* Replaced the wide toolbar preview-text field with a single T-icon button that opens a small popup under the icon.
* Added a caret (small triangle) on the popup pointing back at the T button, matching the existing menu motion and glass style.
* Added a Presets section with uppercase alphabet, lowercase alphabet, digits, and the localized pangram sentence.
* Added a visually distinct "Font name as preview" option (italic label, dashed border, no accent color) that renders each family in its own name everywhere. It stands first in the popup, above the presets.
* Added a small footer link to the Wikipedia pangram page for pangrams in many more languages.
* Added a Custom section where each saved text is edited inline, deleted with the trailing x button, and selected by focusing its row.
* Added an empty add-row with a leading + button that saves the typed text as a new custom sample on click or Enter.
* Clicking outside the popup or pressing Escape closes it without changing the preview.
* Persisted the font-name mode and the custom list alongside the existing preview-text preference.
* Applied the font-name mode to grid cards, detail panel, waterfall view, compare overlay, and specimen export.

`Direct Commit` · `uncommitted`

---

# Changelog (temp) — Activated by Affinity browse section

Status: uncommitted working-tree change (no commit yet).

## 🚀 Features
- New "Activated by Affinity" section in the Browse sidebar, with a live count badge.
  - Collects every font the Affinity auto-activation turns on, so you can see exactly what Affinity pulled in.
  - Clears itself automatically when Affinity closes (or when "Deactivate on quit" runs).
- New command-palette entry: "Go to Activated by Affinity".
- Friendly empty state ("No Affinity fonts") when the list is empty.

## 🎨 UI/UX Changes
- The "Activated" section keeps showing Affinity fonts too — they appear in both places (no double-list confusion: the Affinity section is just a filtered view of the same active fonts).
- Manually deactivating a font removes it from the Affinity section immediately.

## 🛠️ Chore / Refactoring (technical)
- `src/state/fontStore.ts`: new `affinityActivated: string[]` state, new `"affinity"` `BrowseKind`/`Nav` kind, `selectVisibleFamilies` filter, affinity-event wiring (`needs` adds families, `deactivated` clears).
- `src/components/Sidebar.tsx`, `src/App.tsx`, `src/components/CommandPalette.tsx`: new nav row (Sparkles icon), empty state, palette command.
- `src/locales/en.json`: new keys `side.affinityActivated`, `empty.affinity.title`, `empty.affinity.body`, `palette.goAffinity` (other locales fall back to English, same as previous sidebar keys).
- Checks: `node check-locales.mjs` OK, `npx tsc --noEmit` clean.

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

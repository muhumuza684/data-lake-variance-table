# Data Lake Tables — three-way merge notes (tier1 + tier2 + tier3)

Merged against your real baseline (`skiba-baseline.zip`), via git branches so every
conflict surfaced precisely instead of being guessed. Order: tier1 → tier2 → tier3.

## tier2 (applied first, via its own `CHANGES.diff`)
Applied cleanly against baseline with zero conflicts — the diff was generated against
your actual repo, so it's trustworthy as-is. Item 7 (saved default view), item 9
(conditional URL actions / link icons), item 18 (multi-visual selection sync).

## tier1 → tier2 conflicts
- **capabilities.json**: tier1's `userConfig` object (calc/combine column persistence)
  and tier2's `savedView` + `linkActions` objects store unrelated data — kept both.
- **tableRenderer.ts**: field declarations only (calc/combined/sparkline/drag-pivot
  state vs. `_persistedViewState`) — kept both.
- **tableRenderer.ts**: `renderCell()` sparkline block (tier1, item 3) and the
  conditional-URL-action helpers (tier2, item 9) are independent features that both
  extend the same cell-rendering area — kept both, in original order.
- **visual.ts**: `update()` — tier1's persisted `userConfig` state read had to be
  combined with tier2's permission/saved-view/link-action resolution and the extra
  `setData()` args (`persistedStateJson`, `reportTitle`) plus the one-time
  `applyPersistedSavedViewIfPresent()` call.

## tier1+tier2 → tier3 conflicts
- **tableRenderer.ts**: `calcEngine` import + column-doc comment — kept tier1's import,
  merged the comment to mention calculated/combined *and* tooltip-only columns.
- **ITableRendererSettings**: tier1/tier2's permission/link-action/saved-view fields
  and tier3's `allowInteractions` (item 10) are independent — kept both.
- **`setData()`**: kept the `tooltipColumns` param/assignment from tier3; dropped a
  redundant `this.columns = [...]` line since `recomputeVirtualColumns()` (tier1)
  already rebuilds `this.columns` correctly right after.
- **Toolbar menu**: combined tier1's Calculations/Combine-columns sections and
  `effectiveGroupColumns()` (drag-pivot aware) with tier3's `loc()`-localized labels,
  and kept tier1's permission-gated export buttons (item 8) with tier3's localized
  button text.
- **Group row rendering**: merged tier1's ARIA-label (item 5) with tier3's
  `role="button"` keyboard toggling (item 14) — both are accessibility additions to
  the same element, not competing.
- **visual.ts**: two separately-evolved `parseColumns()` / `buildRendererSettings()`
  pairs had to become one each:
  - `parseColumns()` now tracks both `permissionsColumnIndex` (tier1/tier2, item 8)
    and `tooltipColumns` (tier3, item 19).
  - `buildRendererSettings()` now takes `(dataView, permission, savedViewState,
    linkActionRules)` — tier3's theme-color resolution (`themeOrUserColor`, item 11)
    runs first, then the result object includes both tiers' fields plus
    `allowInteractions` (item 10).
  - Two duplicate `buildRendererSettings` declarations that had auto-merged side by
    side (which would not have compiled) were consolidated into one.

## Post-merge fix
The very first `cp -r baseline/* .` step silently dropped dotfiles/dirs
(`.github/workflows/build.yml`, `.gitignore`) since shell globs don't match
leading-dot entries. Caught by a full file-list diff against baseline and restored.

## Verification
- All conflict markers confirmed removed (`grep` for `<<<<<<<`/`=======`/`>>>>>>>`
  across `src/`, `capabilities.json`, `style/`).
- `capabilities.json` validated as parseable JSON.
- Full file inventory diffed against baseline — only the expected additions
  (`src/calcEngine.ts` from tier1, `stringResources/en-US/resources.resjson` from
  tier3) are new; nothing else missing or duplicated.
- Ran TypeScript's compiler in isolation (no `node_modules` available in this
  environment, so full `tsc --noEmit` per `tsconfig.json` couldn't run against real
  `powerbi-visuals-api`/`d3`/`jspdf` type packages). With module-resolution errors
  filtered out, no structural/syntax errors surfaced in the merged files. The only
  real findings were pre-existing, not introduced by the merge:
  - `tableRenderer.ts` uses `String.prototype.matchAll` (from tier1's combine-columns
    parser), which needs `"lib": ["es2020", ...]` or later — `tsconfig.json` currently
    specifies `es2017`. Bump the lib target, or you'll want to confirm this compiles
    in your real environment.
  - A handful of `noImplicitAny` warnings on `d3.sum(...)`/`autoTable(...)` callback
    parameters — these come from missing `@types/d3` / `jspdf-autotable` types in this
    sandbox and should resolve once you run `npm install` for real.

**Recommended next step on your machine:** `npm install`, then `npx tsc --noEmit` and
`npx pbiviz package` to get a real, authoritative compile/package check — this
sandbox has no network access to fetch your dependencies.

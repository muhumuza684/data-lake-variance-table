# E1 — Mobile Layout Manual Test Plan (Skiba Tables)

**How to run this:** Power BI Desktop → View ribbon → "Mobile layout" (this opens the phone-canvas
editor, distinct from the normal report canvas). Build/select the mobile layout for the page
containing Skiba Tables. For app-level checks (row 6 below, and anything the desktop mobile-layout
editor can't simulate), also open the same report in the actual Power BI mobile app (iOS or
Android) against a published/shared copy.

Environment note before you start: none of the six areas below are automatable — Power BI's mobile
layout renderer and the actual mobile app are not scriptable from CI, so this is a checklist for a
human tester, not a test suite. Pair it with the automated suite in `tests/` (E2), which covers the
logic; this covers the rendering surface that logic runs on.

Grid legend: **What to test** → concrete steps. **Pass** → the bar for "this area is fine, ship it."
**Likely failure mode** → what you'll actually see if it's broken, so you don't have to guess
whether something odd on screen is *the* bug or a red herring.

---

## 1. Base rendering

| | |
|---|---|
| **What to test** | Open a report page with Skiba Tables (grouped/hierarchical, a few group levels deep, at least one measure column) in the mobile layout editor. Resize the mobile canvas to the default phone-portrait dimensions Power BI mobile layout provides (don't manually stretch it — test the size Power BI actually gives a phone tile). |
| **Pass** | The table renders at all (not a blank/error tile). Group rows, leaf rows, and at least the first 2–3 columns are legible without zooming — text isn't clipped mid-character, row height isn't so compressed that text overlaps between rows. |
| **Likely failure mode** | Nothing renders (blank white/gray tile) — check the browser/webview console for a thrown error during `update()`, since a layout this narrow may hit a divide-by-zero or negative-width code path that never gets exercised on desktop. Alternatively: it renders but every column is squeezed to unreadable width because the visual doesn't detect mobile canvas size and pick a reduced/priority column set. |

## 2. Toolbar

| | |
|---|---|
| **What to test** | With the toolbar enabled (`showToolbar` on) and at least one export permission NOT set to `no-export`/`read-only`, locate and tap the toolbar's menu/export button and any color-preset or formatting controls in mobile layout. |
| **Pass** | The toolbar button is visible (not pushed off-canvas or hidden behind the table), has a large enough tap target to hit reliably with a finger (not just a mouse-precision hover target), and opens its menu without the menu itself overflowing the canvas. |
| **Likely failure mode** | The toolbar is present but sized for desktop (small icon-only button) and either gets clipped by the narrow canvas width, or opens a dropdown menu that renders wider than the phone screen and gets cut off / requires horizontal scroll to read. |

## 3. Color popover (conditional-format min/max color pickers, if exposed as an in-visual popover rather than only the Format pane)

| | |
|---|---|
| **What to test** | If there's an in-visual color-picker popover (as opposed to only the Power BI Format pane, which is a separate host-level UI outside this visual's control), open it in mobile layout and confirm it stays fully on-screen. |
| **Pass** | The popover renders entirely within the mobile canvas bounds — no part of the swatch grid, hex input, or "apply" button is clipped or pushed off the visible edge. |
| **Likely failure mode** | The popover is positioned relative to the trigger element using desktop-canvas-width assumptions (e.g. "open 200px to the right"), so on a ~340px-wide mobile canvas it renders mostly or entirely off-screen, making it impossible to actually pick a color on mobile. If there's no in-visual popover at all (color config only lives in the Format pane), mark this row N/A and note that in the results — nothing to verify here. |

## 4. Virtual scroll / Fetch More Data on touch

| | |
|---|---|
| **What to test** | With `virtualScrollEnabled` on and a dataset large enough to trigger `fetchMoreData` (once T1 lands), touch-scroll (swipe) through the table on an actual mobile device or mobile-app preview, not just the desktop mobile-layout editor's mouse-drag simulation. Watch whether reaching the bottom triggers a new segment fetch the same way a desktop mouse-wheel scroll does, and whether the row-count indicator ("N of M+ loaded") stays visible and legible at mobile width throughout. |
| **Pass** | Swipe-scrolling smoothly loads further rows exactly as mouse-scroll does on desktop — no dead zone where touch-scroll stops working, no duplicate/skipped rows during a fetch. The row-count indicator stays on-screen and readable (not truncated to illegibility by narrow width) through the whole scroll range. |
| **Likely failure mode** | The scroll listener is bound to a `scroll` event on an element that touch gestures don't fire the same way (e.g. requires `touchmove`/momentum-scroll handling not present for a `wheel`-only implementation) — scrolling either doesn't move the table at all, or moves it but never crosses the threshold that triggers `fetchMoreData`, so the user gets stuck after the first segment. Separately: the row-count indicator, if styled as a fixed-width corner badge, may get squeezed off-canvas at mobile widths even if scrolling itself works fine. **This row is currently blocked pending T1** — until `fetchMoreData`/segments land, "does touch-scroll trigger the same behavior as desktop" has no real behavior to test yet; for now, only the *visible-and-legible-at-mobile-width* half of this check (for the existing virtual-scroll/row-count UI, if any exists pre-T1) is actionable. |

## 5. Keyboard-equivalent controls on touch

| | |
|---|---|
| **What to test** | The codebase currently drives group-row expand/collapse, sortable header clicks, group-by chips, and other interactive elements through a combined `tabIndex` + click + `keydown` pattern (confirmed in `tableRenderer.ts`: `chip.tabIndex`, `th.tabIndex`, `rowEl.tabIndex` on group rows, and the expand/collapse `toggle.tabIndex`). On a touch device with no physical/on-screen keyboard focus concept, tap every one of these: group-row chevron (expand/collapse), sortable column headers, the group-by drag chip, any detail-row expand toggle (item 5). |
| **Pass** | Every one of those controls responds to a plain tap exactly as it would to a desktop click (not exclusively to `keydown` after tab-focusing it, which is meaningless on a phone with no hardware keyboard). |
| **Likely failure mode** | Because the existing pattern is `tabIndex` + keyboard-navigation-friendly click handlers, a plain `click` listener on the same element should still fire on tap in practice (touch dispatches a synthetic click) — so this area is *more likely* to already work than areas 2–4 above. The real risk is any control that was implemented as `keydown`-only (Enter/Space) without a parallel `click` handler, which would work for keyboard users but be completely dead on touch. Grep the codebase for `keydown` listeners that don't have a sibling `click`/`pointerdown` listener on the same element as a starting point if this fails. |

## 6. Export on mobile

| | |
|---|---|
| **What to test** | With export permission NOT set to `no-export`/`read-only`, trigger CSV, Excel, and PDF export from inside the actual Power BI mobile app (not just the desktop mobile-layout editor — this specifically needs the real mobile app/webview, since the failure mode is host-environment-specific, not layout-specific). |
| **Pass** | Either the export genuinely produces a downloadable/shareable file through whatever mechanism the mobile OS offers (e.g. a share sheet), or — if that's not supported — the export controls are conditionally hidden/disabled in the mobile host so the user never sees a broken "Export" button that silently does nothing. |
| **Likely failure mode** | **This is very likely broken today**, and worth flagging up front rather than treating as an even-odds coin flip: `downloadBlob()` in `tableRenderer.ts` is a hard-coded `URL.createObjectURL` + synthetic `<a download>` click — the standard desktop-browser download trick. Mobile app webviews commonly don't support triggering an arbitrary file save this way (no filesystem the webview can write to, no OS-level download manager hook), so the most likely observed failure is: the export button is tappable, nothing visibly happens, no error, no file appears anywhere — a silent no-op, which is worse than an explicit error because the user has no idea whether it worked. There is currently **no `hostCapabilities` check gating this at all** (`allowInteractions` is checked elsewhere in the code, but nothing inspects mobile/webview capability specifically before wiring up the export buttons) — confirm during this test whether Power BI's `IVisualHost.hostCapabilities` actually exposes something usable to detect "can't do arbitrary file downloads here" (this needs checking against the current `powerbi-visuals-api` version's typings, not assumed), and if so, that's the fix: conditionally hide the three export menu items in `renderToolbar()` when that capability is false. |

---

## Summary table (fill in while testing)

| # | Area | Result | Notes |
|---|------|--------|-------|
| 1 | Base rendering | ☐ Pass ☐ Fail | |
| 2 | Toolbar | ☐ Pass ☐ Fail | |
| 3 | Color popover | ☐ Pass ☐ Fail ☐ N/A | |
| 4 | Virtual scroll / Fetch More Data | ☐ Pass ☐ Fail ☐ Blocked on T1 | |
| 5 | Keyboard-equivalent controls on touch | ☐ Pass ☐ Fail | |
| 6 | Export on mobile | ☐ Pass ☐ Fail | |

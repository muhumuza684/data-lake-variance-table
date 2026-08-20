"use strict";

/**
 * Item 26 — Tier/license gating.
 *
 * ASSUMED — confirm with product owner before shipping. Flagged here, in
 * capabilities.json's "Permissions" role description, and in
 * docs/LICENSING_NOTES.md so a human reviewer only has to check one place.
 *
 * Verified before writing this (re-verify against your live repo before
 * merging, per the module instructions):
 *   - `Select-String -Path ".\src\*.ts" -Pattern "license|entitlement|tier"`
 *     returns zero hits for a real tiering concept -- the only "tier1/2/3"
 *     text in the repo is unrelated: merge-batch labels in code comments and
 *     MERGE_NOTES.md, not a product licensing tier. Tier/license gating is
 *     genuinely unbuilt.
 *   - D1/D2 (already shipped, not touched by this file): the "Permissions"
 *     data role is a single optional DAX measure returning a text value
 *     ("no-export" | "read-only" today), resolved once per viewer by
 *     resolvePermission() in visual.ts, and enforced by
 *     isExportRestricted() in tableRenderer.ts. It is documented as
 *     client-trust, not DRM.
 *
 * DECISION THIS ITEM HAD TO MAKE, WITHOUT A PRODUCT OWNER AVAILABLE
 * SYNCHRONOUSLY: is the existing `permission` field the intended mechanism
 * for tier/licensing too, or does the product want something separate?
 *
 * ASSUMED ANSWER: reuse the SAME mechanism. Inventing a second one (a
 * license-key check, an external validation call, a new settings object)
 * would contradict D2's deliberate "client-trust, not DRM" decision, and the
 * task instructions explicitly forbid it. So this adds exactly ONE new
 * recognized string value to the existing vocabulary -- "no-premium" -- and
 * gates two EXISTING, already-shipped, ungated features the same way
 * "no-export"/"read-only" already gate export and Fetch More Data:
 *
 *   - Link Actions (the "linkActions" object -- clickable URL rules)
 *   - Conditional Formatting (the "conditionalFormatting" object -- the
 *     two-color data scale)
 *
 * THIS IS A GUESS about which two features a product owner would actually
 * want behind a paid tier. Both were picked because they are the two
 * existing, already-built features that (a) are not already gated by
 * anything and (b) plausibly read as "premium" formatting/interactivity
 * add-ons rather than core table functionality. If the real answer is a
 * different feature set, a different tier model (numeric tiers, multiple
 * gated groups, a value per feature), or a different name than
 * "no-premium", ONLY this file and its two call sites in visual.ts need to
 * change -- D1/D2's export/fetch gating is completely untouched.
 *
 * Recognized permission values after this change:
 *   - null          -> full functionality (Permissions role left unbound)
 *   - "no-export"   -> export + Fetch More Data disabled (existing, D1)
 *   - "read-only"   -> export + Fetch More Data disabled, resize disabled
 *                      (existing)
 *   - "no-premium"  -> ASSUMED, this item: Link Actions + Conditional
 *                      Formatting disabled regardless of the formatting
 *                      pane's own toggles for those features
 *
 * Any other/unrecognized string, including an empty string, fails OPEN
 * (no restriction) -- consistent with resolvePermission()'s existing
 * "null = full functionality" contract, and with D2's client-trust posture:
 * this is a workflow convenience, not a security control, so an
 * unrecognized value should not silently lock a legitimate viewer out.
 */

export interface ITierRestrictions {
    /**
     * True when link-action URL rules must be suppressed regardless of the
     * "Link actions" pane's own "rules" setting.
     */
    linkActionsRestricted: boolean;
    /**
     * True when the conditional-formatting color scale must be suppressed
     * regardless of the "Conditional formatting" pane's own "enabled"
     * toggle.
     */
    conditionalFormattingRestricted: boolean;
}

const NO_RESTRICTIONS: ITierRestrictions = {
    linkActionsRestricted: false,
    conditionalFormattingRestricted: false
};

/**
 * Item 26 (ASSUMED) — derives tier restrictions from the same resolved
 * "permission" string that already drives isExportRestricted() /
 * isAwaitingMoreData() gating in tableRenderer.ts (see resolvePermission()
 * in visual.ts, D1/D2). Pure function: no new data binding, no new settings
 * object, no I/O -- consistent with D2 (client-trust, not DRM) and with the
 * "do not invent new licensing infrastructure" instruction for this item.
 *
 * Call this once per update, right next to where `permission` is already
 * resolved in visual.ts (confirmed at visual.ts:221), and thread the two
 * booleans into buildRendererSettings() so `conditionalFormatEnabled` and
 * `linkActionRules` on the returned ITableRendererSettings are overridden
 * before tableRenderer.ts ever reads them (confirmed read sites:
 * tableRenderer.ts:2469-2473 and :2601-2609). See INTEGRATION_PATCH.md for
 * the exact, verified edits.
 */
export function resolveTierRestrictions(permission: string | null): ITierRestrictions {
    if (permission === "no-premium") {
        return {
            linkActionsRestricted: true,
            conditionalFormattingRestricted: true
        };
    }
    return NO_RESTRICTIONS;
}

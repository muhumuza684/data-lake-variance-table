import { resolveTierRestrictions } from "../src/tierGating";

// NOTE: `Select-String isExportRestricted` against tests/ returned zero
// matches in the verified repo state, so there is no existing
// isExportRestricted() test to mirror here. These tests instead follow the
// same shape you'd expect from that pattern: one case per recognized
// permission value, plus the unbound (null) and unrecognized-value edges.

describe("resolveTierRestrictions (Item 26, ASSUMED tier model)", () => {
    it("returns no restrictions when the Permissions role is unbound (null)", () => {
        const result = resolveTierRestrictions(null);
        expect(result.linkActionsRestricted).toBe(false);
        expect(result.conditionalFormattingRestricted).toBe(false);
    });

    it("returns no restrictions for the existing 'no-export' value (D1, untouched by this item)", () => {
        const result = resolveTierRestrictions("no-export");
        expect(result.linkActionsRestricted).toBe(false);
        expect(result.conditionalFormattingRestricted).toBe(false);
    });

    it("returns no restrictions for the existing 'read-only' value (D1, untouched by this item)", () => {
        const result = resolveTierRestrictions("read-only");
        expect(result.linkActionsRestricted).toBe(false);
        expect(result.conditionalFormattingRestricted).toBe(false);
    });

    it("restricts Link Actions and Conditional Formatting for the new 'no-premium' value", () => {
        const result = resolveTierRestrictions("no-premium");
        expect(result.linkActionsRestricted).toBe(true);
        expect(result.conditionalFormattingRestricted).toBe(true);
    });

    it("fails open (no restriction) for any unrecognized string, matching D2's client-trust posture", () => {
        const result = resolveTierRestrictions("some-future-value");
        expect(result.linkActionsRestricted).toBe(false);
        expect(result.conditionalFormattingRestricted).toBe(false);
    });

    it("fails open for an empty string", () => {
        const result = resolveTierRestrictions("");
        expect(result.linkActionsRestricted).toBe(false);
        expect(result.conditionalFormattingRestricted).toBe(false);
    });
});

import { colorForTier4Value, matchesTier4Rule, paletteColors, safeTier4Theme } from "../src/tier4Formatting";

describe("Tier 4 formatting primitives", () => {
    it("supports numeric and text rule operators", () => {
        expect(matchesTier4Rule(10, { column: "Revenue", operator: "gt", value: "9", color: "#f00" })).toBe(true);
        expect(matchesTier4Rule("Overdue", { column: "Status", operator: "contains", value: "due", color: "#f00" })).toBe(true);
        expect(colorForTier4Value(10, [{ column: "Revenue", operator: "gte", value: "10", color: "#f00" }])).toBe("#f00");
    });

    it("exposes color-blind-safe presets", () => {
        expect(paletteColors("deuteranopia")).toEqual(["#F4A582", "#0571B0"]);
        expect(paletteColors("protanopia")).toEqual(["#FEE0B6", "#2166AC"]);
    });

    it("bounds and validates saved theme state", () => {
        expect(safeTier4Theme({ name: "Operations", palette: "protanopia" })?.palette).toBe("protanopia");
        expect(safeTier4Theme({ name: "" })).toBeNull();
    });
});

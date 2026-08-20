import { isNarrowViewport, selectColumnsForWidth, MOBILE_BREAKPOINT_PX } from "../src/mobileLayout";

describe("isNarrowViewport", () => {
    it("is false for a typical desktop tile width", () => {
        expect(isNarrowViewport(800)).toBe(false);
    });

    it("is true at Power BI's documented mobile-layout max width (323px)", () => {
        expect(isNarrowViewport(323)).toBe(true);
    });

    it("is true exactly at the breakpoint", () => {
        expect(isNarrowViewport(MOBILE_BREAKPOINT_PX)).toBe(true);
    });

    it("is false just above the breakpoint", () => {
        expect(isNarrowViewport(MOBILE_BREAKPOINT_PX + 1)).toBe(false);
    });

    it("is false for zero or negative width (not yet laid out)", () => {
        expect(isNarrowViewport(0)).toBe(false);
        expect(isNarrowViewport(-10)).toBe(false);
    });

    it("respects a custom breakpoint override", () => {
        expect(isNarrowViewport(400, 500)).toBe(true);
        expect(isNarrowViewport(600, 500)).toBe(false);
    });
});

describe("selectColumnsForWidth", () => {
    type Col = { name: string; w: number };
    const widthOf = (c: Col) => c.w;

    it("returns an empty array for an empty column list", () => {
        expect(selectColumnsForWidth<Col>([], widthOf, 300)).toEqual([]);
    });

    it("always keeps at least the first column, even if it alone overflows", () => {
        const cols: Col[] = [{ name: "A", w: 500 }, { name: "B", w: 100 }];
        expect(selectColumnsForWidth(cols, widthOf, 300)).toEqual([cols[0]]);
    });

    it("includes columns while the running total still fits", () => {
        const cols: Col[] = [
            { name: "A", w: 100 },
            { name: "B", w: 100 },
            { name: "C", w: 100 },
            { name: "D", w: 100 }
        ];
        expect(selectColumnsForWidth(cols, widthOf, 250).map((c) => c.name)).toEqual(["A", "B"]);
    });

    it("stops at the first column that would overflow, not just the smallest total", () => {
        const cols: Col[] = [
            { name: "A", w: 100 },
            { name: "B", w: 200 }, // would overflow at 250
            { name: "C", w: 50 }   // would fit alone, but never reached
        ];
        expect(selectColumnsForWidth(cols, widthOf, 250).map((c) => c.name)).toEqual(["A"]);
    });

    it("returns every column when they all fit comfortably", () => {
        const cols: Col[] = [{ name: "A", w: 50 }, { name: "B", w: 50 }];
        expect(selectColumnsForWidth(cols, widthOf, 1000).map((c) => c.name)).toEqual(["A", "B"]);
    });
});
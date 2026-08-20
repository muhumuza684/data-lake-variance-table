/**
 * E2 target #1 from T3: "color precedence resolution".
 *
 * *** FLAG (see README.md "Findings" section for the full writeup) ***
 * The T3 prompt describes item 9 as "a color-scale/conditional-formatting system
 * [that] resolves color from multiple possible rule sources in a defined
 * precedence order". That system does not exist in the codebase as of this
 * commit. What actually exists under `conditionalFormatEnabled` is a single
 * two-color linear gradient (min color -> max color) driven by each measure
 * column's live min/max, computed in `computeColumnStats()` and applied in
 * `renderCell()`. There is exactly one rule source (the column's own range),
 * so there is no precedence to test.
 *
 * "Item 9" in the actual code comments refers to something else entirely: the
 * conditional URL-action link rules (see linkActionPrecedence.test.ts), which
 * DO have a real multi-rule precedence order (first match wins, array order).
 * That is the closest real analog to what T3 asked for, and is covered there.
 *
 * This file instead covers the real min/max gradient, because it's what
 * T1's "rescale across segments" behavior (T3 task 1, third bullet) will
 * actually exercise once fetchMoreData lands -- computeColumnStats() re-derives
 * min/max from `this._data` on every setData() call, so a second segment that
 * introduces a new extreme should shift already-rendered rows' colors. That
 * part IS provisional (setData() doesn't accumulate yet -- see
 * setDataSegments.test.ts) and is marked as such below.
 */
import * as d3 from "d3";
import { TableRenderer } from "../src/tableRenderer";
import {
    makeFakeHost,
    makeFakeSelectionManager,
    makeFakeTooltipService,
    makeFakeLocalizationManager,
    makeFakeColorPalette
} from "./mocks/powerbiMocks";
import { col, row, makeSettings } from "./mocks/fixtures";

function buildRenderer() {
    const container = document.createElement("div");
    const renderer = new TableRenderer(
        container,
        makeFakeHost(),
        makeFakeSelectionManager(),
        makeFakeTooltipService(),
        makeFakeLocalizationManager(),
        makeFakeColorPalette()
    );
    return { renderer, container };
}

describe("conditional-format color gradient (renderCell / computeColumnStats)", () => {
    const columns = [col("name", { isMeasure: false, isGroupBy: true }), col("score", { isMeasure: true })];

    it("applies no background color when conditionalFormatEnabled is false", () => {
        const { renderer, container } = buildRenderer();
        renderer.setData(
            [columns[0]],
            [],
            [columns[1]],
            [],
            [row({ name: "A", score: 10 }), row({ name: "B", score: 90 })],
            makeSettings({ conditionalFormatEnabled: false })
        );
        const cells = Array.from(container.querySelectorAll(".skiba-table__cell")) as HTMLElement[];
        const scoreCells = cells.filter((c) => c.textContent === "10" || c.textContent === "90");
        expect(scoreCells.length).toBeGreaterThan(0);
        scoreCells.forEach((c) => expect(c.style.backgroundColor).toBe(""));
    });

    it("colors the minimum value exactly minColor and the maximum value exactly maxColor", () => {
        const { renderer, container } = buildRenderer();
        const minColor = "rgb(255, 0, 0)"; // conditionalFormatMinColor "#ff0000" normalized by getComputedStyle/d3
        const maxColor = "rgb(0, 255, 0)"; // conditionalFormatMaxColor "#00ff00"
        renderer.setData(
            [columns[0]],
            [],
            [columns[1]],
            [],
            [row({ name: "A", score: 0 }), row({ name: "B", score: 50 }), row({ name: "C", score: 100 })],
            makeSettings({ conditionalFormatEnabled: true, conditionalFormatMinColor: "#ff0000", conditionalFormatMaxColor: "#00ff00" })
        );
        const cells = Array.from(container.querySelectorAll(".skiba-table__cell")) as HTMLElement[];
        const cellFor = (text: string) => cells.find((c) => c.querySelector(".skiba-table__cell-text")?.textContent === text)!;

        expect(cellFor("0").style.backgroundColor).toBe(minColor);
        expect(cellFor("100").style.backgroundColor).toBe(maxColor);
        // The midpoint should be a genuine interpolation, not equal to either endpoint.
        const midBg = cellFor("50").style.backgroundColor;
        expect(midBg).not.toBe(minColor);
        expect(midBg).not.toBe(maxColor);
        expect(midBg).toBe(d3.interpolateRgb("#ff0000", "#00ff00")(0.5));
    });

    it("does not color a column where every value is identical (range.max === range.min guard)", () => {
        const { renderer, container } = buildRenderer();
        renderer.setData(
            [columns[0]],
            [],
            [columns[1]],
            [],
            [row({ name: "A", score: 42 }), row({ name: "B", score: 42 })],
            makeSettings({ conditionalFormatEnabled: true })
        );
        const cells = Array.from(container.querySelectorAll(".skiba-table__cell")) as HTMLElement[];
        const scoreCells = cells.filter((c) => c.querySelector(".skiba-table__cell-text")?.textContent === "42");
        scoreCells.forEach((c) => expect(c.style.backgroundColor).toBe(""));
    });

    it(
        "PROVISIONAL (pending T1 fetchMoreData): a new segment introducing a new extreme " +
            "should recompute min/max and shift an already-rendered row's color -- " +
            "currently setData() replaces rather than accumulates data, so this test exercises " +
            "the recompute behavior via two independent setData() calls, which is the closest " +
            "real proxy available today. Re-verify against real segment accumulation once T1 lands.",
        () => {
            const { renderer, container } = buildRenderer();
            const settings = makeSettings({ conditionalFormatEnabled: true, conditionalFormatMinColor: "#ff0000", conditionalFormatMaxColor: "#00ff00" });

            // "Segment 1": range is 0-50, so row A (0) is min-colored.
            renderer.setData([columns[0]], [], [columns[1]], [], [row({ name: "A", score: 0 }), row({ name: "B", score: 50 })], settings);
            let cells = Array.from(container.querySelectorAll(".skiba-table__cell")) as HTMLElement[];
            const cellForA = () => cells.find((c) => c.querySelector(".skiba-table__cell-text")?.textContent === "0")!;
            expect(cellForA().style.backgroundColor).toBe("rgb(255, 0, 0)"); // A is the min -> pure minColor

            // "Segment 2" widens the range to 0-100 (a new extreme arrives). Once T1's
            // accumulation lands, this should be `data = [...previousRows, ...newRows]`
            // passed through the same setData() call rather than a second independent call.
            renderer.setData(
                [columns[0]],
                [],
                [columns[1]],
                [],
                [row({ name: "A", score: 0 }), row({ name: "B", score: 50 }), row({ name: "C", score: 100 })],
                settings
            );
            cells = Array.from(container.querySelectorAll(".skiba-table__cell")) as HTMLElement[];
            // A is still the min of the new range, so it should still render as pure minColor --
            // this assertion holds regardless of accumulation semantics.
            expect(cellForA().style.backgroundColor).toBe("rgb(255, 0, 0)");
            // But B, which used to be the max (t=1.0), should now sit at the midpoint (t=0.5)
            // now that C has extended the range -- this is the actual "rescale" behavior.
            const cellForB = cells.find((c) => c.querySelector(".skiba-table__cell-text")?.textContent === "50")!;
            expect(cellForB.style.backgroundColor).toBe(d3.interpolateRgb("#ff0000", "#00ff00")(0.5));
        }
    );
});

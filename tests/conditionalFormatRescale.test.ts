/**
 * Item 18 — "conditional-formatting rescale across segments".
 *
 * *** FINDING (this session) ***
 * This is a REGRESSION test, not a bug fix. Verified against the real
 * tableRenderer.ts source:
 *
 *   - setData() (line ~380) always does a full replace of `this._data`
 *     EXCEPT when `isSegmentContinuation && data.length === 0` (an empty/
 *     failed continuation), which preserves existing rows instead of
 *     wiping them. Any real continuation with rows always replaces.
 *   - setData() calls computeColumnStats() unconditionally (recomputes
 *     `_columnMinMax` from scratch off whatever `this._data` now holds),
 *     then on a segment continuation calls renderVisibleRows() (not a
 *     full render()).
 *   - renderVisibleRows() does clearElement(this.bodyRoot) and fully
 *     rebuilds every currently-visible row via renderRow() -> renderCell()
 *     -- it does not patch/append, it wipes and redraws the visible range
 *     on every call.
 *   - renderCell() reads `this._columnMinMax.get(col.name)` LIVE at
 *     render time to compute the gradient color.
 *
 * Net effect: every segment continuation recolors every currently-visible
 * cell against the freshly recomputed min/max, with no persistent
 * staleness. This test proves that end-to-end through the real
 * `isSegmentContinuation: true` code path.
 *
 * NOTE: colorGradient.test.ts already contains a "PROVISIONAL (pending T1
 * fetchMoreData)" version of this scenario using two independent setData()
 * calls without `isSegmentContinuation: true`. T1 (Fetch More Data core
 * plumbing) is now committed, so that provisional test is superseded by
 * this one, which exercises the real isSegmentContinuation path
 * (renderVisibleRows()-only, not the full render() branch). Consider
 * removing the "PROVISIONAL" framing from that test once this one is
 * merged, since the real behavior it was waiting on now exists.
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

describe("item 18 — conditional-format rescale across a real segment continuation", () => {
    const nameCol = col("name", { isMeasure: false, isGroupBy: true });
    const scoreCol = col("score", { isMeasure: true });

    const settings = makeSettings({
        conditionalFormatEnabled: true,
        conditionalFormatMinColor: "#ff0000",
        conditionalFormatMaxColor: "#00ff00"
    });

    const cellFor = (container: HTMLElement, text: string) =>
        (Array.from(container.querySelectorAll(".skiba-table__cell")) as HTMLElement[]).find(
            (c) => c.querySelector(".skiba-table__cell-text")?.textContent === text
        )!;

    it("recolors an already-rendered row when a later segment introduces a new extreme", () => {
        const { renderer, container } = buildRenderer();

        // First segment: A=0 (min), B=50 (max). A should render as pure minColor.
        renderer.setData(
            [nameCol],
            [],
            [scoreCol],
            [],
            [row({ name: "A", score: 0 }), row({ name: "B", score: 50 })],
            settings,
            undefined,
            undefined,
            false // isSegmentContinuation: false -- first load
        );

        expect(cellFor(container, "0").style.backgroundColor).toBe("rgb(255, 0, 0)");
        expect(cellFor(container, "50").style.backgroundColor).toBe("rgb(0, 255, 0)");

        // Second segment: a real continuation. Per the verified fetchMoreData
        // contract, Power BI delivers the cumulative merged row set, so this
        // is what setData() actually receives on a continuation -- not a delta.
        renderer.setData(
            [nameCol],
            [],
            [scoreCol],
            [],
            [row({ name: "A", score: 0 }), row({ name: "B", score: 50 }), row({ name: "C", score: 100 })],
            settings,
            undefined,
            undefined,
            true // isSegmentContinuation: true -- this exercises the renderVisibleRows()-only path
        );

        // A is still the min of the new range -> still pure minColor.
        expect(cellFor(container, "0").style.backgroundColor).toBe("rgb(255, 0, 0)");
        // C is the new max -> pure maxColor.
        expect(cellFor(container, "100").style.backgroundColor).toBe("rgb(0, 255, 0)");
        // B was the max in segment 1 (t=1.0, pure maxColor). After the rescale
        // it should now sit at the midpoint (t=0.5) -- this is the actual
        // "already-rendered row gets restyled" behavior item 18 asked about.
        expect(cellFor(container, "50").style.backgroundColor).toBe(d3.interpolateRgb("#ff0000", "#00ff00")(0.5));
    });

    it("does not wipe existing rows on an empty/failed continuation (the one real gap setData() guards against)", () => {
        const { renderer, container } = buildRenderer();

        renderer.setData(
            [nameCol],
            [],
            [scoreCol],
            [],
            [row({ name: "A", score: 0 }), row({ name: "B", score: 100 })],
            settings,
            undefined,
            undefined,
            false
        );
        expect(cellFor(container, "0")).toBeTruthy();
        expect(cellFor(container, "100")).toBeTruthy();

        // Empty continuation (e.g. a failed/empty fetchMoreData response) --
        // per the verified guard `!(isSegmentContinuation && data.length === 0)`,
        // this must NOT clear this._data or the already-rendered table.
        renderer.setData([nameCol], [], [scoreCol], [], [], settings, undefined, undefined, true);

        expect(cellFor(container, "0")).toBeTruthy();
        expect(cellFor(container, "100")).toBeTruthy();
        expect(cellFor(container, "0").style.backgroundColor).toBe("rgb(255, 0, 0)");
        expect(cellFor(container, "100").style.backgroundColor).toBe("rgb(0, 255, 0)");
    });
});

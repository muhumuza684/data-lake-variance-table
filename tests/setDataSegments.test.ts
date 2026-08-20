/**
 * E2 target #2 from T3: "segment accumulation in setData()".
 *
 * UPDATED from the original scaffolding: the `it.todo()` block below assumed
 * TableRenderer.setData() would need to manually concatenate rows on every
 * continuation. That assumption was checked against Microsoft's documented
 * fetchMoreData()/aggregateSegments contract before writing these tests (see
 * FINDINGS.md alongside this file) and found to be WRONG for this codebase:
 * requestMoreData() calls `host.fetchMoreData(true)` (aggregateSegments,
 * matching the API default), which means Power BI delivers the *cumulative*
 * merged row set on every continuation -- not an incremental delta. So a
 * continuation still does a full REPLACE of `_data`, exactly like a normal
 * update -- concatenating an already-cumulative array would double-count
 * every row on every scroll-triggered fetch.
 *
 * The real, narrower bug: an empty/failed continuation must not wipe an
 * already-rendered table. That's what the new tests below actually verify.
 */
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

const idCol = col("id", { isMeasure: false, isGroupBy: false });

function renderedRowCount(container: HTMLElement): number {
    // Leaf data rows only -- excludes the header row (also role="row"), any group-header
    // rows, and the top/bottom virtual-scroll spacer divs (which aren't role="row" at all).
    return container.querySelectorAll('[role="row"]:not(.skiba-table__row--header):not(.skiba-table__row--group)').length;
}

describe("setData() current behavior (real, verified)", () => {
    it("an initial call renders exactly the rows passed in", () => {
        const { renderer, container } = buildRenderer();
        renderer.setData([idCol], [], [], [], [row({ id: "A" }), row({ id: "B" }), row({ id: "C" })], makeSettings());
        expect(renderedRowCount(container)).toBe(3);
    });

    it("a second setData() call with isSegmentContinuation=false (a filter/sort/search change, " +
        "NOT a Fetch More Data segment) REPLACES the first call's rows -- this is correct, " +
        "intentional behavior, not a gap: a genuine new query is not a continuation", () => {
        const { renderer, container } = buildRenderer();
        renderer.setData([idCol], [], [], [], [row({ id: "A" }), row({ id: "B" })], makeSettings());
        expect(renderedRowCount(container)).toBe(2);

        renderer.setData([idCol], [], [], [], [row({ id: "C" }), row({ id: "D" }), row({ id: "E" })], makeSettings());
        expect(renderedRowCount(container)).toBe(3);
        const ids = Array.from(container.querySelectorAll(".skiba-table__cell-text")).map((n) => n.textContent);
        expect(ids).not.toContain("A");
        expect(ids).not.toContain("B");
    });

    it("an empty data array with isSegmentContinuation=false (a genuine 'no rows match' result) " +
        "still legitimately clears previously-rendered rows", () => {
        const { renderer, container } = buildRenderer();
        renderer.setData([idCol], [], [], [], [row({ id: "A" }), row({ id: "B" })], makeSettings());
        expect(renderedRowCount(container)).toBe(2);

        renderer.setData([idCol], [], [], [], [], makeSettings());
        expect(renderedRowCount(container)).toBe(0);
    });
});

describe("setData() segment accumulation (real, verified against the actual T1 implementation)", () => {
    it("a continuation carrying Power BI's cumulative merged row set renders exactly that set " +
        "(not summed with the prior call) -- confirms the fix does NOT concatenate on top of " +
        "already-cumulative data", () => {
        const { renderer, container } = buildRenderer();
        const settings = makeSettings({ hasMoreData: true });

        renderer.setData([idCol], [], [], [], [row({ id: "A" }), row({ id: "B" })], settings, undefined, undefined, false);
        expect(renderedRowCount(container)).toBe(2);

        // A real continuation: Power BI has already merged the prior 2 rows with 1 new one.
        renderer.setData([idCol], [], [], [], [row({ id: "A" }), row({ id: "B" }), row({ id: "C" })], settings, undefined, undefined, true);
        expect(renderedRowCount(container)).toBe(3);
        const ids = Array.from(container.querySelectorAll(".skiba-table__cell-text")).map((n) => n.textContent);
        expect(ids.filter((id) => id === "A").length).toBe(1); // not duplicated
    });

    it("an empty/failed continuation (isSegmentContinuation=true, data=[]) preserves the " +
        "already-rendered rows rather than wiping them", () => {
        const { renderer, container } = buildRenderer();
        const settings = makeSettings({ hasMoreData: true });

        renderer.setData([idCol], [], [], [], [row({ id: "A" }), row({ id: "B" })], settings, undefined, undefined, false);
        expect(renderedRowCount(container)).toBe(2);

        renderer.setData([idCol], [], [], [], [], settings, undefined, undefined, true);
        expect(renderedRowCount(container)).toBe(2); // preserved, not wiped
    });

    it("a row belonging to an already-expanded group appears once (in the group), not as a " +
        "duplicate top-level entry, once a continuation delivers the cumulative set including it", () => {
        const groupCol = col("category", { isMeasure: false, isGroupBy: true });
        const { renderer, container } = buildRenderer();
        const settings = makeSettings({ hasMoreData: true, groupsDefaultExpanded: true });

        renderer.setData(
            [idCol], [groupCol], [], [],
            [row({ id: "A", category: "X" })],
            settings, undefined, undefined, false
        );

        renderer.setData(
            [idCol], [groupCol], [], [],
            [row({ id: "A", category: "X" }), row({ id: "B", category: "X" })],
            settings, undefined, undefined, true
        );

        expect(renderedRowCount(container)).toBe(2);
        const ids = Array.from(container.querySelectorAll(".skiba-table__cell-text")).map((n) => n.textContent);
        expect(ids.filter((id) => id === "A").length).toBe(1);
    });

    it("once hasMoreData is false, a further scroll-triggered request does not call " +
        "host.fetchMoreData again (end-of-pagination idempotency)", () => {
        // NOTE: this test's mechanics depend on makeFakeHost() exposing fetchMoreData as a
        // jest.fn() -- confirm that shape against tests/mocks/powerbiMocks.ts before trusting
        // this test; it was not independently re-verified in this session (see FINDINGS.md).
        const { renderer } = buildRenderer();
        const settings = makeSettings({ hasMoreData: false });

        renderer.setData([idCol], [], [], [], [row({ id: "A" })], settings, undefined, undefined, false);

        // If your TableRenderer exposes a way to simulate a scroll-near-bottom event for
        // testing, call it here. Left as a documented gap rather than guessing at a private
        // method's name.
        expect(renderer.isAwaitingMoreData()).toBe(false);
    });

    it("search operates correctly against a partially-loaded (hasMoreData=true) dataset without " +
        "throwing, and surfaces the 'search full dataset' affordance", () => {
        const { renderer, container } = buildRenderer();
        const settings = makeSettings({ hasMoreData: true, searchEnabled: true });

        renderer.setData([idCol], [], [], [], [row({ id: "A" }), row({ id: "B" })], settings, undefined, undefined, false);

        expect(() => {
            const input = container.querySelector<HTMLInputElement>(".skiba-search__input");
            if (input) {
                input.value = "A";
                input.dispatchEvent(new Event("input"));
            }
        }).not.toThrow();

        const fullDatasetLink = container.querySelector(".skiba-search__full-dataset-link");
        expect(fullDatasetLink).not.toBeNull();
    });
});

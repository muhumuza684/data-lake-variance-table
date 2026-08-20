/**
 * Tests for Module B (Items 23 + 24): honest row-count display and the
 * Fetch More Data retry-on-failure flow.
 *
 * IMPORTANT: I don't have visibility into this repo's existing test mock
 * factory (no __tests__ folder / existing spec file was in the gathered
 * context), so the mocks below are hand-rolled to satisfy the constructor
 * signature and ITableRendererSettings shape as verified from the real
 * tableRenderer.ts. If the project already has shared mock helpers for
 * IVisualHost / ISelectionManager / etc. (e.g. in a test-utils file),
 * swap these out for those instead of maintaining two parallel mock sets.
 *
 * Adjust the import path below to match this file's actual location
 * relative to src/tableRenderer.ts.
 */

import {
    TableRenderer,
    ITableColumn,
    ITableRow,
    ITableRendererSettings
} from "../src/tableRenderer";

function makeSelectionId(id: string): any {
    return {
        __id: id,
        equals: (other: any) => !!other && other.__id === id
    };
}

function makeSettings(overrides: Partial<ITableRendererSettings> = {}): ITableRendererSettings {
    return {
        fontFamily: "Segoe UI",
        fontSize: 12,
        rowHeight: 32,
        headerBg: "#ffffff",
        headerFont: "#000000",
        headerBold: false,
        cellBg: "#ffffff",
        cellFont: "#000000",
        altRow: "#f5f5f5",
        enableDataBars: false,
        barColor: "#000000",
        showTotals: false,
        totalsLabel: "Total",
        totalsBg: "#eeeeee",
        virtualScrollEnabled: false,
        virtualScrollRowHeight: 32,
        showToolbar: true,
        searchEnabled: true,
        enableColumnFilters: false,
        conditionalFormatEnabled: false,
        conditionalFormatMinColor: "#ffffff",
        conditionalFormatMaxColor: "#000000",
        groupsDefaultExpanded: true,
        permission: null,
        linkActionRules: [],
        linkActionIconColumn: "",
        savedViewState: null,
        allowInteractions: true,
        hasMoreData: false,
        ...overrides
    };
}

function makeRow(key: string, amount: number): ITableRow {
    return { key, values: { Amount: amount }, selectionId: makeSelectionId(key) };
}

const AMOUNT_COLUMN: ITableColumn[] = [
    { name: "Amount", displayName: "Amount", isMeasure: true, isGroupBy: false }
];

function makeHost(fetchMoreDataImpl: (aggregateSegments?: boolean) => boolean) {
    return {
        fetchMoreData: jest.fn(fetchMoreDataImpl),
        persistProperties: jest.fn(),
        launchUrl: jest.fn(),
        createSelectionIdBuilder: jest.fn()
    } as any;
}

function makeRenderer(host: any) {
    const container = document.createElement("div");
    const selectionManager = {
        select: jest.fn().mockResolvedValue(undefined),
        getSelectionIds: jest.fn().mockReturnValue([]),
        showContextMenu: jest.fn()
    } as any;
    const tooltipService = {
        enabled: jest.fn().mockReturnValue(false),
        show: jest.fn(),
        move: jest.fn(),
        hide: jest.fn()
    } as any;
    // Passes every key straight through so this.loc(key, fallback, ...args) resolves to the
    // fallback text (getDisplayName returning the same key === "not found", per loc()'s logic).
    const localizationManager = {
        getDisplayName: (key: string) => key
    } as any;
    const colorPalette = { isHighContrast: false } as any;

    const renderer = new TableRenderer(container, host, selectionManager, tooltipService, localizationManager, colorPalette);
    return { renderer, container, host, selectionManager };
}

describe("Item 23 -- honest row-count display", () => {
    test("shows the complete count once hasMoreData is false", () => {
        const host = makeHost(() => true);
        const { renderer, container } = makeRenderer(host);

        renderer.setData([], [], AMOUNT_COLUMN, [], [makeRow("r1", 10), makeRow("r2", 20)], makeSettings({ hasMoreData: false }));

        const rowCountText = container.querySelector(".skiba-row-count__text");
        expect(rowCountText).not.toBeNull();
        expect(rowCountText!.textContent).toBe("2 rows");
    });

    test("shows an honest partial count (no fabricated total) while hasMoreData is true", () => {
        const host = makeHost(() => true);
        const { renderer, container } = makeRenderer(host);

        renderer.setData([], [], AMOUNT_COLUMN, [], [makeRow("r1", 10), makeRow("r2", 20), makeRow("r3", 30)], makeSettings({ hasMoreData: true }));

        const rowCountText = container.querySelector(".skiba-row-count__text");
        expect(rowCountText).not.toBeNull();
        expect(rowCountText!.textContent).toBe("3+ rows loaded, more available");
    });

    test("row count updates on a segment-continuation setData call", () => {
        const host = makeHost(() => true);
        const { renderer, container } = makeRenderer(host);

        renderer.setData([], [], AMOUNT_COLUMN, [], [makeRow("r1", 10)], makeSettings({ hasMoreData: true }));
        expect(container.querySelector(".skiba-row-count__text")!.textContent).toBe("1+ rows loaded, more available");

        // Simulates the cumulative row set Power BI delivers on a continuation (see setData's
        // own comments on aggregateSegments) -- isSegmentContinuation = true.
        renderer.setData(
            [], [], AMOUNT_COLUMN, [],
            [makeRow("r1", 10), makeRow("r2", 20)],
            makeSettings({ hasMoreData: false }),
            undefined,
            undefined,
            true
        );
        expect(container.querySelector(".skiba-row-count__text")!.textContent).toBe("2 rows");
    });
});

describe("Item 24 -- retry control for a failed Fetch More Data request", () => {
    test("a rejected (false) fetchMoreData() call shows the failed message and a retry control", () => {
        const fetchMoreData = jest.fn().mockReturnValue(false);
        const host = makeHost(fetchMoreData);
        const { renderer, container } = makeRenderer(host);

        renderer.setData([], [], AMOUNT_COLUMN, [], [makeRow("r1", 10)], makeSettings({ hasMoreData: true }));

        // Private method -- exercised directly since it's what maybeRequestMoreDataFromScroll()
        // (triggered by a real scroll event) ultimately calls.
        (renderer as any).requestMoreData();

        expect(fetchMoreData).toHaveBeenCalledTimes(1);
        expect(fetchMoreData).toHaveBeenCalledWith(true);

        const failedEl = container.querySelector(".skiba-fetch-more-failed");
        expect(failedEl).not.toBeNull();
        expect(failedEl!.textContent).toContain("Couldn't load more rows");

        const retryBtn = container.querySelector(".skiba-fetch-more-failed__retry");
        expect(retryBtn).not.toBeNull();
        expect(retryBtn!.getAttribute("role")).toBe("button");
        expect((retryBtn as HTMLElement).tabIndex).toBe(0);
    });

    test("clicking the retry control calls fetchMoreData() again", () => {
        const fetchMoreData = jest.fn().mockReturnValue(false);
        const host = makeHost(fetchMoreData);
        const { renderer, container } = makeRenderer(host);

        renderer.setData([], [], AMOUNT_COLUMN, [], [makeRow("r1", 10)], makeSettings({ hasMoreData: true }));
        (renderer as any).requestMoreData();
        expect(fetchMoreData).toHaveBeenCalledTimes(1);

        const retryBtn = container.querySelector(".skiba-fetch-more-failed__retry") as HTMLElement;
        retryBtn.click();

        expect(fetchMoreData).toHaveBeenCalledTimes(2);
    });

    test("activating the retry control via Enter also calls fetchMoreData() again", () => {
        const fetchMoreData = jest.fn().mockReturnValue(false);
        const host = makeHost(fetchMoreData);
        const { renderer, container } = makeRenderer(host);

        renderer.setData([], [], AMOUNT_COLUMN, [], [makeRow("r1", 10)], makeSettings({ hasMoreData: true }));
        (renderer as any).requestMoreData();

        const retryBtn = container.querySelector(".skiba-fetch-more-failed__retry") as HTMLElement;
        const enterEvent = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
        retryBtn.dispatchEvent(enterEvent);

        expect(fetchMoreData).toHaveBeenCalledTimes(2);
    });

    test("activating the retry control via Space also calls fetchMoreData() again", () => {
        const fetchMoreData = jest.fn().mockReturnValue(false);
        const host = makeHost(fetchMoreData);
        const { renderer, container } = makeRenderer(host);

        renderer.setData([], [], AMOUNT_COLUMN, [], [makeRow("r1", 10)], makeSettings({ hasMoreData: true }));
        (renderer as any).requestMoreData();

        const retryBtn = container.querySelector(".skiba-fetch-more-failed__retry") as HTMLElement;
        const spaceEvent = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
        retryBtn.dispatchEvent(spaceEvent);

        expect(fetchMoreData).toHaveBeenCalledTimes(2);
    });

    test("a subsequent successful request clears the failed indicator", () => {
        const fetchMoreData = jest.fn()
            .mockReturnValueOnce(false)
            .mockReturnValueOnce(true);
        const host = makeHost(fetchMoreData);
        const { renderer, container } = makeRenderer(host);

        renderer.setData([], [], AMOUNT_COLUMN, [], [makeRow("r1", 10)], makeSettings({ hasMoreData: true }));

        (renderer as any).requestMoreData(); // fails
        expect(container.querySelector(".skiba-fetch-more-failed")).not.toBeNull();

        (renderer as any)._isFetchingMore = false; // requestMoreData() bails early while a fetch is "in flight"
        (renderer as any).requestMoreData(); // succeeds
        expect(container.querySelector(".skiba-fetch-more-failed")).toBeNull();
        expect(container.querySelector(".skiba-fetch-more-indicator")).not.toBeNull();
    });

    test("no-export still allows Fetch More Data under D1", () => {
        const fetchMoreData = jest.fn().mockReturnValue(true);
        const host = makeHost(fetchMoreData);
        const { renderer, container } = makeRenderer(host);

        renderer.setData([], [], AMOUNT_COLUMN, [], [makeRow("r1", 10)], makeSettings({ hasMoreData: true, permission: "no-export" }));
        (renderer as any).requestMoreData();

        expect(fetchMoreData).toHaveBeenCalledWith(true);
        expect(container.querySelector(".skiba-fetch-more-indicator")).not.toBeNull();
    });
});

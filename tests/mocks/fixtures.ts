import { ITableColumn, ITableRow, ITableRendererSettings, ILinkActionRule } from "../../src/tableRenderer";
import { makeFakeSelectionId } from "./powerbiMocks";

let rowKeyCounter = 0;

export function col(name: string, opts: Partial<ITableColumn> = {}): ITableColumn {
    return {
        name,
        displayName: name,
        isMeasure: opts.isMeasure ?? false,
        isGroupBy: opts.isGroupBy ?? false,
        ...opts
    };
}

export function row(values: { [k: string]: any }): ITableRow {
    rowKeyCounter += 1;
    return {
        key: values.__key ?? `row-${rowKeyCounter}`,
        values,
        selectionId: makeFakeSelectionId(`sel-${rowKeyCounter}`) as any
    };
}

/** Full ITableRendererSettings with sane defaults; override only what a given test cares about. */
export function makeSettings(overrides: Partial<ITableRendererSettings> = {}): ITableRendererSettings {
    return {
        fontFamily: "Segoe UI",
        fontSize: 12,
        rowHeight: 28,
        headerBg: "#f3f3f3",
        headerFont: "#000000",
        headerBold: true,
        cellBg: "#ffffff",
        cellFont: "#000000",
        altRow: "#fafafa",
        enableDataBars: false,
        barColor: "#0078d4",
        showTotals: false,
        totalsLabel: "Total",
        totalsBg: "#eeeeee",
        virtualScrollEnabled: false,
        virtualScrollRowHeight: 28,
        showToolbar: true,
        searchEnabled: true,
        enableColumnFilters: false,
        conditionalFormatEnabled: false,
        conditionalFormatMinColor: "#ff0000",
        conditionalFormatMaxColor: "#00ff00",
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

/** Single ILinkActionRule with sane defaults (a matching "flagged" rule); override only what a given test cares about. */
export function linkRule(overrides: Partial<ILinkActionRule> = {}): ILinkActionRule {
    return {
        column: "status",
        operator: "equals",
        value: "flagged",
        urlTemplate: "https://example.test/{id}",
        ...overrides
    };
}

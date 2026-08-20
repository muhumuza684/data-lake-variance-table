"use strict";

import * as d3 from "d3";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import powerbi from "powerbi-visuals-api";
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import ISelectionId = powerbi.visuals.ISelectionId;
import ISelectionManager = powerbi.extensibility.ISelectionManager;
import ITooltipService = powerbi.extensibility.ITooltipService;
import VisualTooltipDataItem = powerbi.extensibility.VisualTooltipDataItem;
import ILocalizationManager = powerbi.extensibility.ILocalizationManager;
import ISandboxExtendedColorPalette = powerbi.extensibility.ISandboxExtendedColorPalette;

import {
    parseCalcFormula,
    evaluateCalc,
    ICalcParseResult,
    ICalcRowContext,
    ICalcAggregates,
    CalcValue
} from "./calcEngine";
import { selectColumnsForWidth } from "./mobileLayout";
import { colorForTier4Value, ITier4ConditionalRule, ITier4SavedTheme, paletteColors, Tier4PaletteName, safeTier4Theme } from "./tier4Formatting";
import { buildWatermarkText, createExportAuditEvent, formatLocaleNumber, recordExportAudit } from "./tier4Governance";

/** A single logical column: a plain row dimension, a value measure, a tooltip-only field, or a user-defined virtual column. */
export interface ITableColumn {
    name: string;
    displayName: string;
    isMeasure: boolean;
    isGroupBy: boolean;
    /** True for a user-defined "Calculations" column (Item 1) — behaves like any other measure column. */
    isCalculated?: boolean;
    /** True for a user-defined "Combine columns" column (Item 4) — behaves like a text row column. */
    isCombined?: boolean;
}

interface ICalcColumnDef {
    formula: string;
    parsed: ICalcParseResult;
}

interface ICombinedColumnDef {
    template: string;
}

/** A single flattened data row, keyed by column name. */
export interface ITableRow {
    key: string;
    values: { [columnName: string]: powerbi.PrimitiveValue };
    selectionId: ISelectionId;
}

export interface ITableRendererSettings {
    fontFamily: string;
    fontSize: number;
    rowHeight: number;
    headerBg: string;
    headerFont: string;
    headerBold: boolean;
    cellBg: string;
    cellFont: string;
    altRow: string;
    enableDataBars: boolean;
    barColor: string;
    showTotals: boolean;
    totalsLabel: string;
    totalsBg: string;
    virtualScrollEnabled: boolean;
    virtualScrollRowHeight: number;
    showToolbar: boolean;
    searchEnabled: boolean;
    enableColumnFilters: boolean;
    conditionalFormatEnabled: boolean;
    conditionalFormatMinColor: string;
    conditionalFormatMaxColor: string;
    groupsDefaultExpanded: boolean;
    /**
     * Resolved value of the optional "Permissions" data role for the current viewer
     * (e.g. "no-export", "read-only"), or null when the role is left unbound. This is
     * a UI/workflow control enforced client-side in the visual -- it only removes
     * controls from this visual's own toolbar/header. It is a complement to, not a
     * replacement for, the report's actual Row-Level Security (RLS) configuration at
     * the dataset level, which governs the underlying data access itself.
     */
    permission: string | null;
    /** Parsed, validated conditional URL-action rules (Item 9). Empty when unset or malformed. */
    linkActionRules: ILinkActionRule[];
    /** Exact display name of the column that should show the link-action icon. */
    linkActionIconColumn: string;
    /** The report's persisted default view (Item 7), read back from `savedView` object properties, or null if none has been saved yet. */
    savedViewState: ISavedViewState | null;
    /** Allow Interactions compliance (item 10): false in read-only/embedded host contexts. */
    allowInteractions: boolean;
    /** Fetch More Data (A1-A4): true while Power BI still has more row segments beyond what's
     *  currently loaded. Read from dataView.metadata.segment by visual.ts. */
    hasMoreData: boolean;
    exportGovernance?: { enabled: boolean; watermarkText: string; locale: string; currency: string; username: string };
}

type SortDirection = "asc" | "desc" | "none";

interface ISortState {
    column: string | null;
    direction: SortDirection;
}

/**
 * Serializable shape of "the report's default view" (Item 7). Written to the
 * report's own object model via `host.persistProperties` under the `savedView`
 * object -- no external backend, no browser storage -- and read back on the next
 * `update()` so every viewer who opens the report sees the same standard view.
 */
export interface ISavedViewState {
    sortColumn: string | null;
    sortDirection: SortDirection;
    columnOrder: string[];
    columnWidths: { [columnName: string]: number };
    hiddenColumns: string[];
    searchTerm: string;
    groupExpansion: { [groupPath: string]: boolean };
}

/** One conditional URL-action rule (Item 9), as authored in the `linkActions.rules` JSON array. */
export type LinkActionOperator = "equals" | "notEquals" | "gt" | "gte" | "lt" | "lte" | "contains";

export interface ILinkActionRule {
    column: string;
    operator: LinkActionOperator;
    value: string;
    urlTemplate: string;
}

type FilterType = "text" | "number" | "date";
type FilterOperator = "contains" | "equals" | "gt" | "gte" | "lt" | "lte" | "between";

interface IColumnFilter {
    type: FilterType;
    operator: FilterOperator;
    value: string;
    value2?: string;
}

/** One row of the (post-filter, post-sort) flattened render list: a group header, a leaf data row, or an expanded record-detail sub-grid. */
type RenderNode =
    | { kind: "group"; depth: number; path: string; column: ITableColumn; value: powerbi.PrimitiveValue; count: number; sums: Map<string, number> }
    | { kind: "row"; depth: number; row: ITableRow }
    | { kind: "detail"; depth: number; row: ITableRow };

const ROW_BUFFER = 6; // extra rows rendered above/below viewport to avoid flicker while scrolling

/** Data Lake Tables palettes. Every preset is wired to live conditional-format colors. */
const DLT_PALETTE_PRESETS: Array<{ name: string; label: string; min: string; max: string }> = [
    { name: "default", label: "Standard", min: "#DFFF91", max: "#0B3A70" },
    { name: "deuteranopia", label: "Deuteranopia safe", min: "#FDE725", max: "#440154" },
    { name: "protanopia", label: "Protanopia safe", min: "#FDE725", max: "#31688E" },
    { name: "brand", label: "Brand navy and yellow", min: "#FAF623", max: "#124E9B" },
    { name: "ura", label: "URA navy and yellow", min: "#FFF4A3", max: "#0B3A70" },
    { name: "ocean", label: "Ocean blue", min: "#D9F3FF", max: "#075985" },
    { name: "teal", label: "Teal operations", min: "#CCFBF1", max: "#115E59" },
    { name: "highContrast", label: "High contrast", min: "#FFFFFF", max: "#000000" }
];
const DLT_PALETTE_NAMES = DLT_PALETTE_PRESETS.map((preset) => preset.name);
const GROUP_SEP = "\u241F"; // unit separator — safe delimiter for building unique group path keys

/**
 * TableRenderer owns everything that happens inside the scrollable table
 * surface: virtualization, multi-level grouping/drill-down, sorting,
 * per-column + global search filtering, column resize/reorder, cross-filter
 * selection, data bars, conditional (value-based) formatting, smart
 * tooltips, CSV/Excel/PDF export, and the accessibility/certification surface
 * (allow-interactions, theme colors, context menu, high contrast, keyboard
 * navigation, landing page, localization, rendering events hook-in, and
 * multi-visual selection sync).
 */
export class TableRenderer {
    private container: HTMLDivElement;
    private host: IVisualHost;
    private selectionManager: ISelectionManager;
    private tooltipService: ITooltipService;
    private localizationManager: ILocalizationManager;
    private colorPalette: ISandboxExtendedColorPalette;

    private settings!: ITableRendererSettings;
    private columns: ITableColumn[] = [];
    private rowColumns: ITableColumn[] = [];
    private groupColumns: ITableColumn[] = [];
    private valueColumns: ITableColumn[] = [];
    private tooltipColumns: ITableColumn[] = [];

    private _data: ITableRow[] = [];
    private _filteredData: ITableRow[] = [];
    private _renderNodes: RenderNode[] = [];
    private _groupExpansion: Map<string, boolean> = new Map();
    private _sortState: ISortState = { column: null, direction: "none" };
    private _searchTerm: string = "";
    private _columnWidths: Map<string, number> = new Map();
    private _hiddenColumns: Set<string> = new Set();
    private _columnOrder: string[] = [];
    private _columnFilters: Map<string, IColumnFilter> = new Map();
    private _columnStats: Map<string, { mean: number; deviation: number }> = new Map();
    private _columnMinMax: Map<string, { min: number; max: number }> = new Map();
    private columnMaxCache: Map<string, number> = new Map();

    // Fetch More Data (D1/D2/A1-A4) -----------------------------------------------------
    private _isFetchingMore = false;
    private _hasMoreData = false;
    private _fetchMoreFailed = false;
    private _forceFetchAllReason: "search" | "export-csv" | "export-excel" | "export-pdf" | null = null;
    private _scrollListenerAttached = false;

    // Module D / Item 34: mobile support -------------------------------------------------
    private _isNarrow = false;
    private _narrowAvailableWidth = 0;

    // Item 1: calculated columns (name -> formula/parsed AST)
    private _calcColumns: Map<string, ICalcColumnDef> = new Map();
    // Item 4: combined columns (name -> template string)
    private _combinedColumns: Map<string, ICombinedColumnDef> = new Map();
    // Tracks which virtual (calculated/combined) column names are currently materialized into row.values,
    // so they can be cleanly removed/recomputed without leaking stale keys.
    private _virtualColumnNames: Set<string> = new Set();
    // Item 3: sparklines — set of measure column names with the trend indicator turned on
    private _sparklineColumns: Set<string> = new Set();
    private _tier4Rules: ITier4ConditionalRule[] = [];
    private _tier4ColumnColors: Map<string, string> = new Map();
    private _tier4Palette: Tier4PaletteName = "default";
    private _tier4CustomPalette: string[] | null = null;
    private _tier4SavedTheme: ITier4SavedTheme | null = null;
    // Item 2: drag-to-pivot — the single row column currently promoted to a group-by, if any
    private _dragGroupColumn: ITableColumn | null = null;
    // Item 5: true drill-down — leaf rows whose full-record detail sub-grid is expanded (keyed by ITableRow.key).
    private _expandedDetailRows: Set<string> = new Set();
    // Per-node pixel offsets into the virtualized body, aligned with _renderNodes; recomputed whenever
    // the node list changes, since detail nodes have a variable height unlike the uniform-height rows/groups.
    private _nodeOffsets: number[] = [];
    private _totalContentHeight = 0;
    private readonly detailFieldRowHeight = 22;

    private _pendingDragGroupName?: string;
    private _hydratedFromPersist = false;
    private _persistDebounce: number | undefined;
    /** One document-level dismissal handler, replaced rather than accumulated on every toolbar rerender. */
    private _toolbarDocumentClickHandler: ((event: MouseEvent) => void) | undefined;

    /** Latest known "report's default view" read back from the report's object model (Item 7). Kept fresh on every setData(); only *applied* to live state once, by the caller. */
    private _persistedViewState: ISavedViewState | null = null;

    private scrollRoot!: HTMLDivElement;
    private headerRoot!: HTMLDivElement;
    private bodyRoot!: HTMLDivElement;
    private toolbarRoot!: HTMLDivElement;
    private searchRoot!: HTMLDivElement;
    private rowCountRoot!: HTMLDivElement;
    private pivotChipRoot!: HTMLDivElement;
    private pivotDropRoot!: HTMLDivElement;
    private filterChipsRoot!: HTMLDivElement;

    private defaultRowHeight = 32;
    private reportTitle = "Data Lake Tables";

    constructor(
        container: HTMLDivElement,
        host: IVisualHost,
        selectionManager: ISelectionManager,
        tooltipService: ITooltipService,
        localizationManager: ILocalizationManager,
        colorPalette: ISandboxExtendedColorPalette
    ) {
        this.container = container;
        this.host = host;
        this.selectionManager = selectionManager;
        this.tooltipService = tooltipService;
        this.localizationManager = localizationManager;
        this.colorPalette = colorPalette;

        this.container.classList.add("skiba-table-root");
        this.buildSkeleton();
    }

    /**
     * Multi-language support (item 16): looks up `key` in the current locale's
     * stringResources; falls back to `fallback` if the key is missing (e.g. a locale that
     * hasn't been translated yet, or `en-US` before the resource file loads in the dev
     * server, which doesn't support localization). `args` are substituted for `{0}`, `{1}`,
     * ... placeholders -- ILocalizationManager.getDisplayName has no built-in templating.
     */
    private loc(key: string, fallback: string, ...args: string[]): string {
        let text = fallback;
        try {
            const resolved = this.localizationManager && this.localizationManager.getDisplayName(key);
            if (resolved && resolved !== key) {
                text = resolved;
            }
        } catch {
            // A missing/broken localization manager should never break rendering.
        }
        args.forEach((arg, i) => {
            text = text.replace(`{${i}}`, arg);
        });
        return text;
    }

    /** Allow Interactions compliance (item 10): guards every selection/context-menu call site. */
    private interactionsAllowed(): boolean {
        return !this.settings || this.settings.allowInteractions !== false;
    }

    /**
     * Multi-visual selection sync (item 18): re-renders the visible rows so this visual's
     * highlighted rows reflect the current selection state, without a full setData() cycle.
     * Called from visual.ts whenever Power BI reports a selection change originating outside
     * this visual (another visual's cross-filter, a bookmark, the filter pane), and also after
     * this visual's own selectionManager.select()/clear() calls resolve.
     */
    public syncExternalSelection(): void {
        if (this.settings) {
            this.renderVisibleRows();
        }
    }

    /**
     * Removes all children of an element without using innerHTML (certification
     * requirement -- assigning to innerHTML is flagged as a potential XSS vector
     * by Power BI's own linter, powerbi-visuals/no-inner-outer-html, even when
     * the value being assigned is always the empty string).
     */
    private clearElement(el: HTMLElement): void {
        while (el.firstChild) {
            el.removeChild(el.firstChild);
        }
    }

    /** Builds the static DOM skeleton once: toolbar, search bar, filter chip strip, header, scroll body. */
    private buildSkeleton(): void {
        this.clearElement(this.container);

        this.toolbarRoot = document.createElement("div");
        this.toolbarRoot.className = "skiba-toolbar";
        this.container.appendChild(this.toolbarRoot);

        this.searchRoot = document.createElement("div");
        this.searchRoot.className = "skiba-search";
        this.container.appendChild(this.searchRoot);

        // Item 23: honest row-count display. Deliberately separate from the search/filter
        // match line inside searchRoot (renderStatusLine()), since this must stay visible
        // even when no search term or column filter is active.
        this.rowCountRoot = document.createElement("div");
        this.rowCountRoot.className = "skiba-row-count";
        this.rowCountRoot.setAttribute("role", "status");
        this.rowCountRoot.setAttribute("aria-live", "polite");
        this.container.appendChild(this.rowCountRoot);

        // Item 2: drag-to-pivot drop target. Invisible until a column header drag starts
        // (progressive disclosure) — see renderHeader()'s dragstart/dragend handlers.
        this.pivotDropRoot = document.createElement("div");
        this.pivotDropRoot.className = "skiba-pivot-drop";
        this.pivotDropRoot.textContent = "Drop here to group by this column";
        this.pivotDropRoot.style.display = "none";
        this.pivotDropRoot.setAttribute("aria-hidden", "true");
        this.pivotDropRoot.addEventListener("dragover", (evt: DragEvent) => evt.preventDefault());
        this.pivotDropRoot.addEventListener("drop", (evt: DragEvent) => {
            evt.preventDefault();
            const draggedName = evt.dataTransfer?.getData("text/skiba-column");
            if (draggedName) {
                this.applyDragPivot(draggedName);
            }
            this.pivotDropRoot.style.display = "none";
        });
        this.container.appendChild(this.pivotDropRoot);

        this.pivotChipRoot = document.createElement("div");
        this.pivotChipRoot.className = "skiba-pivot-chip-root";
        this.container.appendChild(this.pivotChipRoot);

        this.filterChipsRoot = document.createElement("div");
        this.filterChipsRoot.className = "skiba-filter-chips";
        this.container.appendChild(this.filterChipsRoot);

        const tableWrap = document.createElement("div");
        tableWrap.className = "skiba-table";
        this.container.appendChild(tableWrap);

        this.headerRoot = document.createElement("div");
        this.headerRoot.className = "skiba-table__header";
        tableWrap.appendChild(this.headerRoot);

        this.scrollRoot = document.createElement("div");
        this.scrollRoot.className = "skiba-table__scroll";
        tableWrap.appendChild(this.scrollRoot);

        this.bodyRoot = document.createElement("div");
        this.bodyRoot.className = "skiba-table__body";
        this.scrollRoot.appendChild(this.bodyRoot);

        this.scrollRoot.addEventListener("scroll", () => this.renderVisibleRows());

        // Right-Click Context Menu (item 12): empty-space mode. AppSource certification
        // requires both the empty-space and data-point context menu modes; the data-point
        // mode is wired per-row in renderRow(). Guarded by allowInteractions like every
        // other selection-adjacent interaction.
        this.container.addEventListener("contextmenu", (evt: MouseEvent) => {
            if (!this.interactionsAllowed()) {
                return;
            }
            const target = evt.target as HTMLElement;
            if (target.closest(".skiba-table__row")) {
                return; // handled by the row's own contextmenu listener
            }
            evt.preventDefault();
            this.selectionManager.showContextMenu({}, { x: evt.clientX, y: evt.clientY });
        });
    }

    /** Replaces the dataset and columns, resets derived (filtered/sorted/grouped) state, and renders. */
    public setData(
        rowColumns: ITableColumn[],
        groupColumns: ITableColumn[],
        valueColumns: ITableColumn[],
        tooltipColumns: ITableColumn[],
        data: ITableRow[],
        settings: ITableRendererSettings,
        persistedStateJson?: string,
        reportTitle?: string,
        isSegmentContinuation: boolean = false
    ): void {
        // Landing/empty states clear the container and detach the renderer skeleton.
        // Rebuild it before rendering real data so Report view never renders into
        // detached header/body roots after fields are assigned.
        if (!this.container.contains(this.headerRoot)) {
            this.buildSkeleton();
        }

        this.rowColumns = rowColumns;
        this.groupColumns = groupColumns;
        this.valueColumns = valueColumns;
        this.tooltipColumns = tooltipColumns;
        // Verified against Microsoft's documented fetchMoreData contract (see FINDINGS.md):
        // with aggregateSegments left at its default (true) -- see requestMoreData() below --
        // each continuation's data already contains the full cumulative row set (prior
        // segments + the new one), merged by Power BI itself. So a continuation still does a
        // full REPLACE, not a concat -- concatenating an already-cumulative array here would
        // double-count every row on every scroll-triggered fetch. The one real gap: an empty/
        // failed continuation (isSegmentContinuation true, data empty) must not wipe an
        // already-rendered table -- a genuine empty result from a real filter/search/sort
        // change (isSegmentContinuation false) still legitimately clears.
        if (!(isSegmentContinuation && data.length === 0)) {
            this._data = data;
        }
        this.settings = settings;

        this._isFetchingMore = false;
        this._hasMoreData = settings.hasMoreData;
        this._fetchMoreFailed = false;
        this.renderRowCountStatus();
        this.renderLoadingMoreIndicator();

        if (this._forceFetchAllReason) {
            if (this._hasMoreData) {
                this.requestMoreData();
                this.renderForceFetchProgress();
            } else {
                this.completeForceFetchAll();
            }
        }

        if (!this._scrollListenerAttached) {
            this._scrollListenerAttached = true;
            this.scrollRoot.addEventListener("scroll", () => this.maybeRequestMoreDataFromScroll());
        }
        this._persistedViewState = settings.savedViewState;
        this.defaultRowHeight = settings.virtualScrollEnabled ? settings.virtualScrollRowHeight : settings.rowHeight;
        if (reportTitle) {
            this.reportTitle = reportTitle;
        }

        // Calculations/combined columns/sparklines/drag-pivot are saved onto the report so a
        // page refresh or reload never silently discards a user's calculated columns (Items 1 & 4
        // explicitly must not be lost). Hydrate exactly once — subsequent updates keep the live,
        // in-memory state so an in-flight persistProperties() write can't be raced by a redraw.
        if (!this._hydratedFromPersist) {
            if (persistedStateJson) {
                this.hydrateUserConfig(persistedStateJson);
            }
            this._hydratedFromPersist = true;
        }

        // Rebuilds this.columns (rows + values + calculated + combined) and materializes
        // calculated/combined values into each row before anything downstream reads them.
        this.recomputeVirtualColumns();

        if (this._pendingDragGroupName) {
            const restored = this.rowColumns.find((c) => c.name === this._pendingDragGroupName);
            if (restored) {
                this._dragGroupColumn = restored;
            }
            this._pendingDragGroupName = undefined;
        }

        this.computeColumnStats();
        this.applyPipeline();

        if (isSegmentContinuation) {
            this.renderVisibleRows();
            this.renderStatusLine();
        } else {
            this.render();
        }
    }

    /** Full re-render: toolbar, search bar, pivot chip, filter chips, header row, and the virtualized body. */
    private render(): void {
        this.applyThemeVars();
        this.renderToolbar();
        this.renderSearchBar();
        this.renderGroupByChip();
        this.renderFilterChips();
        this.renderHeader();
        this.renderVisibleRows();
    }

    // -----------------------------------------------------------------
    // Fetch More Data (D1, D2, A1-A4)
    // -----------------------------------------------------------------

    /**
     * D1: export restriction is intentionally separate from Fetch More Data.
     * See docs/DECISIONS.md: no-export blocks export but not data loading.
     */
    private isExportRestricted(): boolean {
        return this.settings.permission === "no-export" || this.settings.permission === "read-only";
    }

    /** D1: read-only blocks Fetch More Data; no-export does not. */
    private isFetchMoreDataRestricted(): boolean {
        return this.settings.permission === "read-only";
    }

    public isAwaitingMoreData(): boolean {
        return this._isFetchingMore;
    }

    private maybeRequestMoreDataFromScroll(): void {
        const threshold = this.scrollRoot.clientHeight || 400;
        const distanceFromBottom = this._totalContentHeight - (this.scrollRoot.scrollTop + this.scrollRoot.clientHeight);
        if (distanceFromBottom <= threshold) {
            this.requestMoreData();
        }
    }

    private requestMoreData(): void {
        if (!this._hasMoreData || this._isFetchingMore || this.isFetchMoreDataRestricted()) {
            return;
        }
        if (typeof this.host.fetchMoreData !== "function") {
            return;
        }
        this._fetchMoreFailed = false;
        this.renderFetchMoreFailedIndicator();
        // Explicit `true` (matches the API default) rather than relying on the implicit
        // default, since the whole segment-accumulation design in setData() above depends on
        // Power BI delivering the cumulative merged row set on each continuation, not a raw
        // incremental delta. See FINDINGS.md for the verified source of this contract.
        const accepted = this.host.fetchMoreData(true);
        if (accepted) {
            this._isFetchingMore = true;
            this.renderLoadingMoreIndicator();
        } else {
            // host.fetchMoreData() is synchronous and returns a boolean (verified against the
            // real powerbi-visuals-api .d.ts) -- there is no Promise/rejection path. `false` IS
            // the failure signal (e.g. the host rejected the request), so it's handled inline.
            this._fetchMoreFailed = true;
            this.renderFetchMoreFailedIndicator();
        }
    }

    private renderLoadingMoreIndicator(): void {
        this.container.querySelectorAll(".skiba-fetch-more-indicator").forEach((el) => el.remove());
        // A fresh loading attempt (including a retry) supersedes any previously shown failure.
        this.container.querySelectorAll(".skiba-fetch-more-failed").forEach((el) => el.remove());
        if (!this._isFetchingMore || this._forceFetchAllReason) {
            return;
        }
        const indicator = document.createElement("div");
        indicator.className = "skiba-fetch-more-indicator";
        indicator.setAttribute("role", "status");
        indicator.setAttribute("aria-live", "polite");
        indicator.textContent = this.loc("FetchMore_Loading", "Loading more rows\u2026");
        this.container.appendChild(indicator);
    }

    /**
     * Item 24: explicit retry control for a failed Fetch More Data request. Uses the exact
     * same DOM-creation pattern as renderLoadingMoreIndicator() above -- elements built via
     * document.createElement only, never innerHTML (flagged by the Power BI linter
     * no-inner-outer-html even for an empty-string assignment; see clearElement()) -- and the
     * same keyboard-accessibility pattern used elsewhere in this file (tabIndex + role="button"
     * + Enter/Space activation alongside the native click handler, matching the pivot chip in
     * renderGroupByChip() and the group-row disclosure control in renderGroupRow()).
     */
    private renderFetchMoreFailedIndicator(): void {
        this.container.querySelectorAll(".skiba-fetch-more-failed").forEach((el) => el.remove());
        if (!this._fetchMoreFailed || this._forceFetchAllReason) {
            return;
        }

        const wrap = document.createElement("div");
        wrap.className = "skiba-fetch-more-failed";
        wrap.setAttribute("role", "status");
        wrap.setAttribute("aria-live", "assertive");

        const message = document.createElement("span");
        message.textContent = this.loc("Skiba_Visual_FetchMore_Failed", "Couldn't load more rows \u2014");
        wrap.appendChild(message);

        const retryBtn = document.createElement("span");
        retryBtn.className = "skiba-fetch-more-failed__retry";
        const retryLabel = this.loc("Skiba_Visual_FetchMore_Retry", "Retry");
        retryBtn.textContent = retryLabel;
        retryBtn.setAttribute("role", "button");
        retryBtn.tabIndex = 0;
        retryBtn.setAttribute("aria-label", retryLabel);

        const retry = (): void => {
            this.requestMoreData();
        };
        retryBtn.addEventListener("click", retry);
        retryBtn.addEventListener("keydown", (evt: KeyboardEvent) => {
            if (evt.key === "Enter" || evt.key === " ") {
                evt.preventDefault();
                retry();
            }
        });

        wrap.appendChild(document.createTextNode(" "));
        wrap.appendChild(retryBtn);
        this.container.appendChild(wrap);
    }

    /**
     * Item 23: honest row-count display, independent of the search/filter match line in
     * renderStatusLine(). Power BI's Fetch More Data segmentation only ever tells this visual
     * "at least one more segment exists" -- it never provides a true total row count -- so a
     * partial state can only honestly say "{0}+ rows loaded, more available"
     * (Skiba_Visual_RowCount_PartialUnknownTotal), not "{0} of {1}+ loaded"
     * (Skiba_Visual_RowCount_Partial), which would require a second, genuinely-known total this
     * visual does not have. Skiba_Visual_RowCount_Partial is deliberately left unused rather
     * than fed a fabricated second number -- flag this for review if a real total becomes
     * available from elsewhere (e.g. a DAX total-rows measure bound to a new data role).
     */
    private renderRowCountStatus(): void {
        this.clearElement(this.rowCountRoot);
        if (!this.settings) {
            return;
        }
        const count = this._data.length;
        const text = document.createElement("span");
        text.className = "skiba-row-count__text";
        text.textContent = this._hasMoreData
            ? this.loc("Skiba_Visual_RowCount_PartialUnknownTotal", "{0}+ rows loaded, more available", String(count))
            : this.loc("Skiba_Visual_RowCount_Complete", "{0} rows", String(count));
        this.rowCountRoot.appendChild(text);
    }

    private beginForceFetchAll(reason: "search" | "export-csv" | "export-excel" | "export-pdf"): void {
        if (!this._hasMoreData) {
            this.runForceFetchAction(reason);
            return;
        }
        this._forceFetchAllReason = reason;
        this.renderForceFetchProgress();
        this.requestMoreData();
    }

    private completeForceFetchAll(): void {
        const reason = this._forceFetchAllReason;
        this._forceFetchAllReason = null;
        this.renderForceFetchProgress();
        if (reason) {
            this.runForceFetchAction(reason);
        }
    }

    private runForceFetchAction(reason: "search" | "export-csv" | "export-excel" | "export-pdf"): void {
        switch (reason) {
            case "search": this.renderStatusLine(); break;
            case "export-csv": this.exportCSV(); break;
            case "export-excel": this.exportExcel(); break;
            case "export-pdf": this.exportPDF(); break;
        }
    }

    private renderForceFetchProgress(): void {
        this.container.querySelectorAll(".skiba-force-fetch-progress").forEach((el) => el.remove());
        if (!this._forceFetchAllReason) {
            return;
        }
        const progress = document.createElement("div");
        progress.className = "skiba-force-fetch-progress";
        progress.setAttribute("role", "status");
        progress.setAttribute("aria-live", "polite");

        const labelKey = this._forceFetchAllReason === "search" ? "FetchMore_LoadingForSearch" : "FetchMore_LoadingForExport";
        const labelFallback = this._forceFetchAllReason === "search"
            ? "Loading the rest of the dataset to search\u2026 ({0} rows loaded so far)"
            : "Loading the rest of the dataset before exporting\u2026 ({0} rows loaded so far)";

        const spinner = document.createElement("span");
        spinner.className = "skiba-spinner";
        spinner.setAttribute("aria-hidden", "true");
        progress.appendChild(spinner);

        const text = document.createElement("span");
        text.textContent = this.loc(labelKey, labelFallback, String(this._data.length));
        progress.appendChild(text);

        this.container.insertBefore(progress, this.container.firstChild);
    }

    // -----------------------------------------------------------------
    // Item 1 + Item 4: calculated & combined (virtual) columns
    // -----------------------------------------------------------------

    /** Rebuilds this.columns from rows + values + calculated + combined, preserving user column order. */
    private rebuildColumnsList(): void {
        const calcCols: ITableColumn[] = Array.from(this._calcColumns.keys()).map((name) => ({
            name,
            displayName: name,
            isMeasure: true,
            isGroupBy: false,
            isCalculated: true
        }));
        const combinedCols: ITableColumn[] = Array.from(this._combinedColumns.keys()).map((name) => ({
            name,
            displayName: name,
            isMeasure: false,
            isGroupBy: false,
            isCombined: true
        }));

        this.columns = [...this.rowColumns, ...this.valueColumns, ...calcCols, ...combinedCols];

        const knownNames = new Set(this._columnOrder);
        this.columns.forEach((c) => {
            if (!knownNames.has(c.name)) {
                this._columnOrder.push(c.name);
            }
        });
        this._columnOrder = this._columnOrder.filter((name) => this.columns.some((c) => c.name === name));
    }

    private buildAggregateContext(): ICalcAggregates {
        const cache = new Map<string, number>();
        const data = this._data;
        return {
            getAggregate: (fn, columnName) => {
                const key = `${fn}::${columnName}`;
                if (cache.has(key)) {
                    return cache.get(key)!;
                }
                const values = data
                    .map((r) => r.values[columnName])
                    .filter((v): v is number => typeof v === "number");
                if (values.length === 0) {
                    return null;
                }
                let result: number | undefined;
                switch (fn) {
                    case "AVG": result = d3.mean(values); break;
                    case "SUM": result = d3.sum(values); break;
                    case "MIN": result = d3.min(values); break;
                    case "MAX": result = d3.max(values); break;
                }
                if (result !== undefined) {
                    cache.set(key, result);
                    return result;
                }
                return null;
            }
        };
    }

    private rowContext(row: ITableRow): ICalcRowContext {
        return { getColumnValue: (name: string) => row.values[name] };
    }

    /** Clears previously materialized virtual values, then recomputes calculated + combined columns for every row. */
    private recomputeVirtualColumns(): void {
        this._virtualColumnNames.forEach((name) => {
            this._data.forEach((r) => {
                delete r.values[name];
            });
        });
        this._virtualColumnNames.clear();

        const agg = this.buildAggregateContext();

        this._calcColumns.forEach((def, name) => {
            this._virtualColumnNames.add(name);
            if (!def.parsed.ok || !def.parsed.ast) {
                return;
            }
            this._data.forEach((row) => {
                const value: CalcValue = evaluateCalc(def.parsed.ast!, this.rowContext(row), agg);
                if (typeof value === "boolean") {
                    row.values[name] = value ? 1 : 0;
                } else {
                    row.values[name] = value;
                }
            });
        });

        this._combinedColumns.forEach((def, name) => {
            this._virtualColumnNames.add(name);
            this._data.forEach((row) => {
                row.values[name] = def.template.replace(/\{([^}]+)\}/g, (_match, ref: string) => {
                    const colName = ref.trim();
                    const v = row.values[colName];
                    return v === null || v === undefined ? "" : String(v);
                });
            });
        });

        this.rebuildColumnsList();
    }

    // -----------------------------------------------------------------
    // Persistence — saves calc/combined columns, sparkline toggles, and the
    // drag-to-pivot column onto the report so user work is never silently lost.
    // -----------------------------------------------------------------

    private persistUserConfig(): void {
        const state = {
            calc: Array.from(this._calcColumns.entries()).map(([name, def]) => ({ name, formula: def.formula })),
            combined: Array.from(this._combinedColumns.entries()).map(([name, def]) => ({ name, template: def.template })),
            sparklines: Array.from(this._sparklineColumns),
            dragGroup: this._dragGroupColumn ? this._dragGroupColumn.name : null,
            tier4Rules: this._tier4Rules,
            tier4ColumnColors: Object.fromEntries(this._tier4ColumnColors.entries()),
            tier4Palette: this._tier4Palette,
            tier4CustomPalette: this._tier4CustomPalette,
            tier4SavedTheme: this._tier4SavedTheme,
            layout: { fontSize: this.settings.fontSize, rowHeight: this.settings.rowHeight, headerBold: this.settings.headerBold },
        };

        // Debounced by a tick so rapid successive edits (e.g. toggling several sparkline
        // checkboxes) collapse into a single write instead of flooding persistProperties.
        if (this._persistDebounce !== undefined) {
            window.clearTimeout(this._persistDebounce);
        }
        this._persistDebounce = window.setTimeout(() => {
            this.host.persistProperties({
                merge: [
                    {
                        objectName: "userConfig",
                        selector: null,
                        properties: { state: JSON.stringify(state) }
                    }
                ]
            });
        }, 0);
    }

    private hydrateUserConfig(json: string): void {
        try {
            const state = JSON.parse(json);
            if (Array.isArray(state.calc)) {
                state.calc.forEach((c: { name?: unknown; formula?: unknown }) => {
                    if (typeof c.name === "string" && typeof c.formula === "string") {
                        this._calcColumns.set(c.name, { formula: c.formula, parsed: parseCalcFormula(c.formula) });
                    }
                });
            }
            if (Array.isArray(state.combined)) {
                state.combined.forEach((c: { name?: unknown; template?: unknown }) => {
                    if (typeof c.name === "string" && typeof c.template === "string") {
                        this._combinedColumns.set(c.name, { template: c.template });
                    }
                });
            }
            if (Array.isArray(state.sparklines)) {
                state.sparklines.forEach((n: unknown) => {
                    if (typeof n === "string") {
                        this._sparklineColumns.add(n);
                    }
                });
            }
            if (Array.isArray(state.tier4Rules)) {
                this._tier4Rules = state.tier4Rules.filter((r: ITier4ConditionalRule) => r && typeof r.column === "string" && typeof r.value === "string" && typeof r.color === "string");
            }
            if (state.tier4ColumnColors && typeof state.tier4ColumnColors === "object") {
                Object.entries(state.tier4ColumnColors).forEach(([k, v]) => { if (typeof v === "string") this._tier4ColumnColors.set(k, v); });
            }
            if (typeof state.tier4Palette === "string" && DLT_PALETTE_NAMES.includes(state.tier4Palette)) this._tier4Palette = state.tier4Palette as Tier4PaletteName;
            if (Array.isArray(state.tier4CustomPalette)) this._tier4CustomPalette = state.tier4CustomPalette.filter((v: unknown) => typeof v === "string").slice(0, 12);
            this._tier4SavedTheme = safeTier4Theme(state.tier4SavedTheme);
            if (state.layout && typeof state.layout === "object") {
                if (typeof state.layout.fontSize === "number") this.settings.fontSize = Math.max(9, Math.min(24, state.layout.fontSize));
                if (typeof state.layout.rowHeight === "number") { this.settings.rowHeight = Math.max(22, Math.min(64, state.layout.rowHeight)); this.defaultRowHeight = this.settings.rowHeight; }
                if (typeof state.layout.headerBold === "boolean") this.settings.headerBold = state.layout.headerBold;
            }
            if (state.layout && typeof state.layout === "object") {
                if (typeof state.layout.fontSize === "number") this.settings.fontSize = Math.max(9, Math.min(24, state.layout.fontSize));
                if (typeof state.layout.rowHeight === "number") { this.settings.rowHeight = Math.max(22, Math.min(64, state.layout.rowHeight)); this.defaultRowHeight = this.settings.rowHeight; }
                if (typeof state.layout.headerBold === "boolean") this.settings.headerBold = state.layout.headerBold;
            }
            if (typeof state.dragGroup === "string") {
                this._pendingDragGroupName = state.dragGroup;
            }
        } catch {
            // Corrupt or pre-upgrade persisted state — start clean rather than crashing the visual.
        }
    }

    // -----------------------------------------------------------------
    // Item 2: drag-to-pivot
    // -----------------------------------------------------------------

    private renderDataLakeLayoutSection(menu: HTMLDivElement): void {
        const section = document.createElement("section");
        section.className = "skiba-toolbar__section datalake-layout-section";
        const title = document.createElement("div");
        title.className = "skiba-toolbar__section-title";
        title.textContent = "Data Lake Tables layout";
        section.appendChild(title);
        const help = document.createElement("div");
        help.className = "datalake-settings-help";
        help.textContent = "Adjust the table density and hierarchy without reopening the formatting pane.";
        section.appendChild(help);

        const addRange = (labelText: string, min: number, max: number, step: number, current: number, apply: (value: number) => void): void => {
            const row = document.createElement("label");
            row.className = "datalake-layout-control";
            const label = document.createElement("span");
            label.textContent = labelText;
            const value = document.createElement("output");
            value.textContent = String(current);
            const input = document.createElement("input");
            input.type = "range";
            input.min = String(min);
            input.max = String(max);
            input.step = String(step);
            input.value = String(current);
            const commit = (): void => {
                const n = Number(input.value);
                if (!Number.isFinite(n)) return;
                value.textContent = String(n);
                apply(n);
                this.persistUserConfig();
            };
            input.addEventListener("input", commit);
            input.addEventListener("change", commit);
            input.addEventListener("pointerup", commit);
            row.append(label, input, value);
            section.appendChild(row);
        };
        addRange("Font size", 9, 24, 1, Number(this.settings.fontSize) || 12, (n) => {
            this.settings.fontSize = n;
            this.applyThemeVars();
            this.renderHeader();
            this.renderVisibleRows();
            this.persistUserConfig();
        });
        addRange("Row height", 22, 64, 1, Number(this.settings.rowHeight) || 32, (n) => {
            this.settings.rowHeight = n;
            this.defaultRowHeight = n;
            this.applyThemeVars();
            this.renderHeader();
            this.renderVisibleRows();
            this.persistUserConfig();
        });

        const boldLabel = document.createElement("label");
        boldLabel.className = "datalake-layout-check";
        const bold = document.createElement("input");
        bold.type = "checkbox";
        bold.checked = !!this.settings.headerBold;
        bold.addEventListener("change", () => { this.settings.headerBold = bold.checked; this.applyThemeVars(); this.renderHeader(); this.persistUserConfig(); });
        boldLabel.append(bold, document.createTextNode("Emphasize headers"));
        section.appendChild(boldLabel);

        const reset = document.createElement("button");
        reset.type = "button";
        reset.className = "datalake-settings-secondary";
        reset.textContent = "Reset layout";
        reset.addEventListener("click", () => {
            this.settings.fontSize = 12;
            this.settings.rowHeight = 32;
            this.settings.headerBold = true;
            this.defaultRowHeight = 32;
            this.applyThemeVars();
            this.renderHeader();
            this.renderVisibleRows();
            this.persistUserConfig();
            this.renderToolbar();
        });
        section.appendChild(reset);
        menu.appendChild(section);
    }
    private renderTier4FormattingSection(menu: HTMLDivElement, closeMenu: () => void): void {
        const section = document.createElement("section");
        section.className = "skiba-toolbar__section skiba-toolbar__section--tier4 skiba-format-editor";
        section.setAttribute("aria-label", this.loc("Toolbar_FormattingRules", "In-visual formatting"));

        const heading = document.createElement("div");
        heading.className = "skiba-format-editor__heading";
        const title = document.createElement("strong");
        title.textContent = this.loc("Toolbar_FormattingRules", "In-visual formatting");
        heading.appendChild(title);
        const subtitle = document.createElement("span");
        subtitle.textContent = this.loc("Toolbar_FormattingHelp", "Create rules that apply immediately to table cells.");
        heading.appendChild(subtitle);
        section.appendChild(heading);

        const paletteRow = document.createElement("div");
        paletteRow.className = "skiba-format-editor__palette-row";
        const paletteLabel = document.createElement("span");
        paletteLabel.textContent = this.loc("Toolbar_ColorPalette", "Palette");
        paletteRow.appendChild(paletteLabel);
        DLT_PALETTE_PRESETS.forEach((preset) => {
            const name = preset.name;
            const button = document.createElement("button");
            button.type = "button";
            button.className = "skiba-format-editor__palette-button";
            button.dataset.palette = name;
            button.textContent = preset.label;
            button.setAttribute("aria-pressed", String(this._tier4Palette === name));
            button.addEventListener("click", () => {
                this._tier4Palette = name as Tier4PaletteName;
                const colors = (this._tier4CustomPalette && this._tier4CustomPalette.length >= 2 ? [this._tier4CustomPalette[0], this._tier4CustomPalette[this._tier4CustomPalette.length - 1]] : [preset.min, preset.max]) as [string, string];
                this.settings.conditionalFormatMinColor = colors[0];
                this.settings.conditionalFormatMaxColor = colors[1];
                this.persistUserConfig();
                this.renderVisibleRows();
                this.renderToolbar();
            });
            paletteRow.appendChild(button);
        });
        section.appendChild(paletteRow);

        const ruleBuilder = document.createElement("div");
        ruleBuilder.className = "skiba-format-editor__builder";
        const builderTitle = document.createElement("div");
        builderTitle.className = "skiba-format-editor__label";
        builderTitle.textContent = this.loc("Toolbar_NewRule", "New rule");
        ruleBuilder.appendChild(builderTitle);

        const column = document.createElement("select");
        column.className = "skiba-format-editor__select";
        column.setAttribute("aria-label", this.loc("Toolbar_RuleColumn", "Column"));
        this.columns.forEach((c) => {
            const option = document.createElement("option");
            option.value = c.name;
            option.textContent = c.displayName;
            column.appendChild(option);
        });
        ruleBuilder.appendChild(column);

        const operator = document.createElement("select");
        operator.className = "skiba-format-editor__select";
        operator.setAttribute("aria-label", this.loc("Toolbar_RuleOperator", "Operator"));
        (["equals", "contains", "gt", "gte", "lt", "lte"] as ITier4ConditionalRule["operator"][]).forEach((name) => {
            const option = document.createElement("option");
            option.value = name;
            option.textContent = name === "gte" ? "At least" : name === "lte" ? "At most" : name;
            operator.appendChild(option);
        });
        ruleBuilder.appendChild(operator);

        const value = document.createElement("input");
        value.className = "skiba-format-editor__input";
        value.type = "text";
        value.placeholder = this.loc("Toolbar_RuleValue", "Value or threshold");
        value.setAttribute("aria-label", this.loc("Toolbar_RuleValue", "Value or threshold"));
        ruleBuilder.appendChild(value);

        const color = document.createElement("input");
        color.className = "skiba-format-editor__color";
        color.type = "color";
        color.value = "#DFFF91";
        color.setAttribute("aria-label", this.loc("Toolbar_RuleColor", "Rule color"));
        ruleBuilder.appendChild(color);

        const add = document.createElement("button");
        add.className = "skiba-format-editor__primary";
        add.type = "button";
        add.textContent = this.loc("Toolbar_AddRule", "Add rule");
        add.addEventListener("click", () => {
            if (!column.value || !value.value.trim()) return;
            this._tier4Rules.push({ column: column.value, operator: operator.value as ITier4ConditionalRule["operator"], value: value.value.trim(), color: color.value });
            value.value = "";
            this.persistUserConfig();
            this.renderVisibleRows();
            this.renderToolbar();
        });
        ruleBuilder.appendChild(add);
        section.appendChild(ruleBuilder);

        const rulesTitle = document.createElement("div");
        rulesTitle.className = "skiba-format-editor__label";
        rulesTitle.textContent = `${this.loc("Toolbar_ActiveRules", "Active rules")} (${this._tier4Rules.length})`;
        section.appendChild(rulesTitle);
        const rules = document.createElement("div");
        rules.className = "skiba-format-editor__rules";
        this._tier4Rules.forEach((rule, index) => {
            const card = document.createElement("div");
            card.className = "skiba-format-editor__rule-card";
            const swatch = document.createElement("span");
            swatch.className = "skiba-format-editor__swatch";
            swatch.style.backgroundColor = rule.color;
            card.appendChild(swatch);
            const text = document.createElement("span");
            text.textContent = `${rule.column} ${rule.operator} ${rule.value}`;
            card.appendChild(text);
            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "skiba-format-editor__icon-button";
            remove.textContent = "×";
            remove.title = this.loc("Toolbar_RemoveRule", "Remove rule");
            remove.setAttribute("aria-label", `${this.loc("Toolbar_RemoveRule", "Remove rule")} ${index + 1}`);
            remove.addEventListener("click", () => {
                this._tier4Rules.splice(index, 1);
                this.persistUserConfig();
                this.renderVisibleRows();
                this.renderToolbar();
            });
            card.appendChild(remove);
            rules.appendChild(card);
        });
        if (this._tier4Rules.length === 0) {
            const empty = document.createElement("span");
            empty.className = "skiba-format-editor__empty";
            empty.textContent = this.loc("Toolbar_NoRules", "No active rules yet.");
            rules.appendChild(empty);
        }
        section.appendChild(rules);

        const columnsTitle = document.createElement("div");
        columnsTitle.className = "skiba-format-editor__label";
        columnsTitle.textContent = this.loc("Toolbar_ColumnOverrides", "Column colors");
        section.appendChild(columnsTitle);
        const overrides = document.createElement("div");
        overrides.className = "skiba-format-editor__overrides";
        this.columns.forEach((c) => {
            const row = document.createElement("label");
            row.className = "skiba-format-editor__override";
            const name = document.createElement("span");
            name.textContent = c.displayName;
            row.appendChild(name);
            const input = document.createElement("input");
            input.type = "color";
            input.value = this._tier4ColumnColors.get(c.name) ?? "#FFFFFF";
            input.setAttribute("aria-label", `Color override for ${c.displayName}`);
            input.addEventListener("change", () => {
                if (input.value.toUpperCase() === "#FFFFFF") this._tier4ColumnColors.delete(c.name);
                else this._tier4ColumnColors.set(c.name, input.value);
                this.persistUserConfig();
                this.renderVisibleRows();
            });
            row.appendChild(input);
            overrides.appendChild(row);
        });
        section.appendChild(overrides);

        const actions = document.createElement("div");
        actions.className = "skiba-format-editor__actions";
        const reset = document.createElement("button");
        reset.type = "button";
        reset.textContent = this.loc("Toolbar_ResetRules", "Reset");
        reset.addEventListener("click", () => {
            this._tier4Rules = [];
            this._tier4ColumnColors.clear();
            this._tier4CustomPalette = null;
            this._tier4Palette = "default";
            this.persistUserConfig();
            this.renderVisibleRows();
            this.renderToolbar();
        });
        actions.appendChild(reset);
        const saveTheme = document.createElement("button");
        saveTheme.type = "button";
        saveTheme.textContent = this.loc("Toolbar_SaveTheme", "Save theme");
        saveTheme.addEventListener("click", () => {
            const name = window.prompt(this.loc("Toolbar_ThemeName", "Theme name"), this._tier4SavedTheme?.name ?? "Operations");
            if (name && name.trim()) {
                this._tier4SavedTheme = { name: name.trim(), palette: this._tier4Palette };
                this.persistUserConfig();
                this.renderToolbar();
            }
        });
        actions.appendChild(saveTheme);
        const close = document.createElement("button");
        close.type = "button";
        close.textContent = this.loc("Toolbar_Done", "Done");
        close.addEventListener("click", closeMenu);
        actions.appendChild(close);
        section.appendChild(actions);
        menu.appendChild(section);
    }
    /** The group-by columns actually used for grouping: the real "Group by" role, plus any drag-pivoted column first. */
    private effectiveGroupColumns(): ITableColumn[] {
        return this._dragGroupColumn ? [this._dragGroupColumn, ...this.groupColumns] : this.groupColumns;
    }

    private applyDragPivot(columnName: string): void {
        const col = this.rowColumns.find((c) => c.name === columnName);
        if (!col || col.isMeasure) {
            // Only plain dimension columns make sense to group by; silently ignore a measure drop
            // rather than surfacing an error for something that was never going to work.
            return;
        }
        this._dragGroupColumn = col;
        this._groupExpansion.clear();
        this.applyPipeline();
        this.render();
        this.persistUserConfig();
    }

    /** One click, no confirmation: grouping is non-destructive and instantly reversible. */
    private removeDragPivot(): void {
        this._dragGroupColumn = null;
        this._groupExpansion.clear();
        this.applyPipeline();
        this.render();
        this.persistUserConfig();
    }

    private renderGroupByChip(): void {
        this.clearElement(this.pivotChipRoot);
        if (!this._dragGroupColumn) {
            this.pivotChipRoot.style.display = "none";
            return;
        }
        this.pivotChipRoot.style.display = "";

        const chip = document.createElement("span");
        chip.className = "skiba-pivot-chip";
        chip.textContent = `Grouped by ${this._dragGroupColumn.displayName} \u2014 click to remove`;
        chip.setAttribute("role", "button");
        chip.tabIndex = 0;
        chip.addEventListener("click", () => this.removeDragPivot());
        chip.addEventListener("keydown", (evt: KeyboardEvent) => {
            if (evt.key === "Enter" || evt.key === " ") {
                evt.preventDefault();
                this.removeDragPivot();
            }
        });
        this.pivotChipRoot.appendChild(chip);
    }

    private applyThemeVars(): void {
        const root = this.container;

        // High-Contrast Accessibility Mode (item 13): when Power BI's host reports high
        // contrast is active, override every rendered color with the host-provided
        // foreground/background/foregroundSelected/hyperlink set instead of the normal
        // theme/user-configured colors, per Microsoft's high-contrast guidance. The
        // `skiba-high-contrast` class also switches the stylesheet to solid borders/outlines
        // since the default subtle rgba borders aren't reliably visible in high contrast.
        const isHighContrast = !!this.colorPalette && this.colorPalette.isHighContrast;
        root.classList.toggle("skiba-high-contrast", isHighContrast);

        if (isHighContrast) {
            const palette = this.colorPalette;
            const foreground = palette.foreground ? palette.foreground.value : "#FFFFFF";
            const background = palette.background ? palette.background.value : "#000000";
            const foregroundSelected = palette.foregroundSelected ? palette.foregroundSelected.value : foreground;
            const hyperlink = palette.hyperlink ? palette.hyperlink.value : foreground;

            root.style.setProperty("--skiba-font-family", this.settings.fontFamily);
            root.style.setProperty("--skiba-font-size", `${this.settings.fontSize}px`);
            root.style.setProperty("--skiba-row-height", `${this.defaultRowHeight}px`);
            root.style.setProperty("--skiba-header-bg", background);
            root.style.setProperty("--skiba-header-font", foreground);
            root.style.setProperty("--skiba-header-weight", this.settings.headerBold ? "600" : "400");
            root.style.setProperty("--skiba-cell-bg", background);
            root.style.setProperty("--skiba-cell-font", foreground);
            root.style.setProperty("--skiba-alt-row", background);
            root.style.setProperty("--skiba-bar-color", foreground);
            root.style.setProperty("--skiba-totals-bg", background);
            root.style.setProperty("--skiba-hc-border", foreground);
            root.style.setProperty("--skiba-hc-selected", foregroundSelected);
            root.style.setProperty("--skiba-hc-hyperlink", hyperlink);
            return;
        }

        root.style.setProperty("--skiba-font-family", this.settings.fontFamily);
        root.style.setProperty("--skiba-font-size", `${this.settings.fontSize}px`);
        root.style.setProperty("--skiba-row-height", `${this.defaultRowHeight}px`);
        root.style.setProperty("--skiba-header-bg", this.settings.headerBg);
        root.style.setProperty("--skiba-header-font", this.settings.headerFont);
        root.style.setProperty("--skiba-header-weight", this.settings.headerBold ? "600" : "400");
        root.style.setProperty("--skiba-cell-bg", this.settings.cellBg);
        root.style.setProperty("--skiba-cell-font", this.settings.cellFont);
        root.style.setProperty("--skiba-alt-row", this.settings.altRow);
        root.style.setProperty("--skiba-bar-color", this.settings.barColor);
        root.style.setProperty("--skiba-totals-bg", this.settings.totalsBg);
    }

    // -----------------------------------------------------------------
    // Toolbar (minimal floating menu — progressive disclosure)
    // -----------------------------------------------------------------

    private renderToolbar(): void {
        const previousMenu = this.toolbarRoot.querySelector(".skiba-toolbar__menu") as HTMLDivElement | null;
        const shouldRestoreMenuOpen = previousMenu !== null && previousMenu.style.display !== "none";
        if (this._toolbarDocumentClickHandler) {
            document.removeEventListener("click", this._toolbarDocumentClickHandler);
            this._toolbarDocumentClickHandler = undefined;
        }
        this.clearElement(this.toolbarRoot);
        this.toolbarRoot.style.display = this.settings.showToolbar ? "" : "none";
        if (!this.settings.showToolbar) {
            return;
        }

        const hamburger = document.createElement("button");
        hamburger.className = "skiba-hamburger datalake-tables-settings-button";
        const optionsLabel = this.loc("Toolbar_TableOptions", "Data Lake Tables settings");
        hamburger.setAttribute("aria-label", optionsLabel);
        hamburger.setAttribute("aria-haspopup", "true");
        hamburger.setAttribute("aria-expanded", "false");
        hamburger.title = optionsLabel;
        hamburger.textContent = "⚙";
        hamburger.setAttribute("aria-label", "Data Lake Tables settings");
        hamburger.title = "Data Lake Tables settings";
        this.toolbarRoot.appendChild(hamburger);

        const menu = document.createElement("div");
        menu.className = "skiba-toolbar__menu datalake-tables-settings-menu";
        menu.setAttribute("role", "menu");
        menu.style.display = "none";
        this.toolbarRoot.appendChild(menu);

        // Full Keyboard Navigation (item 14): Escape closes the menu and returns focus to
        // the hamburger button, matching the toolbar's mouse behavior and the platform's
        // documented Escape convention for dismissing custom-visual popups.
        const closeMenu = (): void => {
            menu.style.display = "none";
            hamburger.setAttribute("aria-expanded", "false");
        };
        const openMenu = (): void => {
            menu.style.display = "block";
            hamburger.setAttribute("aria-expanded", "true");
        };

        hamburger.addEventListener("click", (evt) => {
            evt.stopPropagation();
            if (menu.style.display === "none") {
                openMenu();
            } else {
                closeMenu();
            }
        });
        hamburger.addEventListener("keydown", (evt: KeyboardEvent) => {
            if (evt.key === "Escape" && menu.style.display !== "none") {
                closeMenu();
            }
        });
        menu.addEventListener("keydown", (evt: KeyboardEvent) => {
            if (evt.key === "Escape") {
                evt.stopPropagation();
                closeMenu();
                hamburger.focus();
            }
        });
        // Internal interaction never dismisses the panel. This is important for select,
        // checkbox, range, color, and text controls whose change/input events can cause
        // renderToolbar() to rebuild the menu.
        menu.addEventListener("click", (event: MouseEvent) => event.stopPropagation());
        menu.addEventListener("input", (event: Event) => event.stopPropagation());
        menu.addEventListener("change", (event: Event) => event.stopPropagation());

        this._toolbarDocumentClickHandler = (event: MouseEvent): void => {
            const target = event.target as Node | null;
            if (!target || !this.toolbarRoot.contains(target)) {
                closeMenu();
            }
        };
        document.addEventListener("click", this._toolbarDocumentClickHandler);

        // Restore the open panel after an internal choice triggers a toolbar rerender.
        if (shouldRestoreMenuOpen) {
            openMenu();
        }

        // Column visibility toggles
        const columnsSection = document.createElement("div");
        columnsSection.className = "skiba-toolbar__section";
        const columnsTitle = document.createElement("div");
        columnsTitle.className = "skiba-toolbar__section-title";
        columnsTitle.textContent = this.loc("Toolbar_ShowColumns", "Show columns");
        columnsSection.appendChild(columnsTitle);

        this.columns.forEach((col) => {
            const rowWrap = document.createElement("div");
            rowWrap.className = "skiba-toolbar__column-row";

            const label = document.createElement("label");
            label.className = "skiba-toolbar__checkbox";
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.checked = !this._hiddenColumns.has(col.name);
            checkbox.setAttribute("aria-label", `Show ${col.displayName} column`);
            checkbox.addEventListener("change", () => {
                if (checkbox.checked) {
                    this._hiddenColumns.delete(col.name);
                } else {
                    this._hiddenColumns.add(col.name);
                }
                this.renderHeader();
                this.renderVisibleRows();
            });
            label.appendChild(checkbox);
            label.appendChild(document.createTextNode(col.displayName));
            rowWrap.appendChild(label);

            // Item 3: sparklines — genuinely optional per numeric column, never forced on.
            if (col.isMeasure) {
                const sparkLabel = document.createElement("label");
                sparkLabel.className = "skiba-toolbar__checkbox skiba-toolbar__checkbox--sparkline";
                const sparkCheckbox = document.createElement("input");
                sparkCheckbox.type = "checkbox";
                sparkCheckbox.checked = this._sparklineColumns.has(col.name);
                sparkCheckbox.setAttribute("aria-label", `Show sparkline trend for ${col.displayName}`);
                sparkCheckbox.addEventListener("change", () => {
                    if (sparkCheckbox.checked) {
                        this._sparklineColumns.add(col.name);
                    } else {
                        this._sparklineColumns.delete(col.name);
                    }
                    this.renderVisibleRows();
                    this.persistUserConfig();
                });
                sparkLabel.appendChild(sparkCheckbox);
                sparkLabel.appendChild(document.createTextNode("Sparkline"));
                rowWrap.appendChild(sparkLabel);
            }

            columnsSection.appendChild(rowWrap);
        });
        menu.appendChild(columnsSection);
        menu.appendChild(this.makeDivider());

        this.renderCalculationsSection(menu, closeMenu);
        this.renderCombineColumnsSection(menu, closeMenu);
        this.renderDataLakeLayoutSection(menu);
        this.renderTier4FormattingSection(menu, closeMenu);

        if (this.effectiveGroupColumns().length > 0) {
            menu.appendChild(this.makeMenuButton(this.loc("Toolbar_ExpandAllGroups", "Expand all groups"), () => {
                this.expandAllGroups();
                closeMenu();
            }));
            menu.appendChild(this.makeMenuButton(this.loc("Toolbar_CollapseAllGroups", "Collapse all groups"), () => {
                this.collapseAllGroups();
                closeMenu();
            }));
            menu.appendChild(this.makeDivider());
        }

        // Item 8: admin-configurable access restrictions. This is a UX/workflow
        // control enforced client-side in the visual, consistent with how Power BI
        // visuals generally work -- the underlying data access itself is governed
        // by the report's actual Row-Level Security (RLS) at the dataset level, if
        // the organization has that configured. This feature complements RLS by
        // hiding controls in this visual's own interface; it does not itself secure
        // the underlying data. When the "permissions" data role is left unbound,
        // `this.settings.permission` is null and every control below renders as
        // it always has.
        const isNoExport = this.isExportRestricted();
        const isReadOnly = this.settings.permission === "read-only";

        if (!isNoExport) {
            menu.appendChild(this.makeMenuButton(this.loc("Toolbar_ExportCSV", "Export CSV"), () => this.beginForceFetchAll("export-csv")));
            menu.appendChild(this.makeMenuButton(this.loc("Toolbar_ExportExcel", "Export Excel"), () => this.beginForceFetchAll("export-excel")));
            menu.appendChild(this.makeMenuButton(this.loc("Toolbar_ExportPDF", "Export PDF"), () => this.beginForceFetchAll("export-pdf")));
            menu.appendChild(this.makeDivider());
        }

        // Reset sorts / filters — harmless, no confirmation needed
        menu.appendChild(this.makeMenuButton(this.loc("Toolbar_ResetSorts", "Reset sorts"), () => {
            this.resetSorts();
            this.persistUserConfig();
        }));
        menu.appendChild(this.makeMenuButton(this.loc("Toolbar_ResetFilters", "Reset filters"), () => {
            this._columnFilters.clear();
            this.commitFilterChange();
            this.persistUserConfig();
        }));

        // Reset column widths / order — discards user customization, so confirm first
        menu.appendChild(this.makeMenuButton(this.loc("Toolbar_ResetColumnWidths", "Reset column widths"), () => {
            if (this._columnWidths.size === 0) {
                this.resetColumnWidths();
                closeMenu();
                return;
            }
            if (window.confirm(this.loc("Confirm_ResetColumnWidths", "This will discard your custom column widths. Continue?"))) {
                this.resetColumnWidths();
            }
            this.persistUserConfig();
        }));
        menu.appendChild(this.makeMenuButton(this.loc("Toolbar_ResetColumnOrder", "Reset column order"), () => {
            const doReset = () => {
                this._columnOrder = this.columns.map((c) => c.name);
                this.renderHeader();
                this.renderVisibleRows();
            };
            if (window.confirm(this.loc("Confirm_ResetColumnOrder", "This will restore the original column order. Continue?"))) {
                doReset();
            }
            this.persistUserConfig();
        }));
        menu.appendChild(this.makeDivider());

        // Item 7: saved views, framed as "the report's default view" rather than a
        // personal view -- an analyst configures grouping/filters once, saves it,
        // and every auditor or official who opens this report sees the same
        // standard view. "read-only" viewers can't set that default for everyone.
        if (!isReadOnly) {
            menu.appendChild(this.makeSaveDefaultViewButton(closeMenu));
        }
        menu.appendChild(this.makeMenuButton("Reset to default view", () => {
            this.resetToDefaultView();
            closeMenu();
        }));
    }

    /**
     * "Save current view as default" — a normal button unless a default view
     * already exists, in which case a click swaps the button for a brief inline
     * confirmation (not a browser confirm() dialog) before overwriting it, since
     * doing so affects every other viewer of this shared report.
     */
    private makeSaveDefaultViewButton(closeMenu: () => void): HTMLDivElement {
        const wrapper = document.createElement("div");

        const btn = this.makeMenuButton("Save current view as default", () => {
            if (!this._persistedViewState) {
                this.saveCurrentViewAsDefault();
                closeMenu();
                return;
            }

            wrapper.replaceChildren();
            const confirmBox = document.createElement("div");
            confirmBox.className = "skiba-toolbar__confirm";

            const msg = document.createElement("div");
            msg.className = "skiba-toolbar__confirm-msg";
            msg.textContent = "This replaces the current default view for everyone who opens this report — save?";
            confirmBox.appendChild(msg);

            const actions = document.createElement("div");
            actions.className = "skiba-toolbar__confirm-actions";

            const cancelBtn = document.createElement("button");
            cancelBtn.textContent = "Cancel";
            cancelBtn.addEventListener("click", (evt) => {
                evt.stopPropagation();
                closeMenu();
            });

            const confirmBtn = document.createElement("button");
            confirmBtn.textContent = "Save";
            confirmBtn.addEventListener("click", (evt) => {
                evt.stopPropagation();
                this.saveCurrentViewAsDefault();
                closeMenu();
            });

            actions.appendChild(cancelBtn);
            actions.appendChild(confirmBtn);
            confirmBox.appendChild(actions);
            wrapper.appendChild(confirmBox);
        });

        wrapper.appendChild(btn);
        return wrapper;
    }

    // -----------------------------------------------------------------
    // Item 1: "Calculations" toolbar section — add a calculated column
    // -----------------------------------------------------------------

    private renderCalculationsSection(menu: HTMLDivElement, closeMenu: () => void): void {
        const section = document.createElement("div");
        section.className = "skiba-toolbar__section";

        const title = document.createElement("div");
        title.className = "skiba-toolbar__section-title";
        title.textContent = "Calculations";
        section.appendChild(title);

        this._calcColumns.forEach((_def, name) => {
            section.appendChild(this.makeVirtualColumnListItem(name, `Remove the calculated column "${name}"? This can't be undone.`, () => {
                this._calcColumns.delete(name);
                this.recomputeVirtualColumns();
                this.computeColumnStats();
                this.applyPipeline();
                this.render();
                this.persistUserConfig();
            }));
        });

        const addBtn = document.createElement("button");
        addBtn.className = "skiba-toolbar__button";
        addBtn.textContent = "+ Add a calculated column";
        section.appendChild(addBtn);

        const form = document.createElement("div");
        form.className = "skiba-calc-form";
        form.style.display = "none";

        const nameInput = document.createElement("input");
        nameInput.type = "text";
        nameInput.placeholder = "Column name, e.g. Margin";
        nameInput.className = "skiba-calc-form__input";
        nameInput.setAttribute("aria-label", "Calculated column name");
        form.appendChild(nameInput);

        const formulaInput = document.createElement("textarea");
        formulaInput.placeholder = "e.g. Revenue - Cost";
        formulaInput.className = "skiba-calc-form__formula";
        formulaInput.rows = 2;
        formulaInput.setAttribute("aria-label", "Calculation formula");
        form.appendChild(formulaInput);

        const errorMsg = document.createElement("div");
        errorMsg.className = "skiba-calc-form__error";
        errorMsg.setAttribute("role", "alert");
        form.appendChild(errorMsg);

        const applyBtn = document.createElement("button");
        applyBtn.className = "skiba-toolbar__button skiba-toolbar__button--primary";
        applyBtn.textContent = "Add column";
        applyBtn.addEventListener("click", (evt) => {
            evt.stopPropagation();
            errorMsg.textContent = "";

            const name = nameInput.value.trim();
            if (name.length === 0) {
                errorMsg.textContent = "Give the calculated column a name.";
                return;
            }
            if (this.columns.some((c) => c.name === name)) {
                errorMsg.textContent = `"${name}" is already a column name \u2014 choose a different name.`;
                return;
            }

            const parsed = parseCalcFormula(formulaInput.value);
            if (!parsed.ok) {
                errorMsg.textContent = parsed.error ?? "Check your formula \u2014 for example: Revenue - Cost";
                return;
            }
            const unknown = parsed.referencedColumns.filter(
                (ref) => !this.columns.some((c) => c.displayName === ref || c.name === ref)
            );
            if (unknown.length > 0) {
                errorMsg.textContent = `Check your formula \u2014 I don't see a column called "${unknown[0]}".`;
                return;
            }

            this._calcColumns.set(name, { formula: formulaInput.value.trim(), parsed });
            this.recomputeVirtualColumns();
            this.computeColumnStats();
            this.applyPipeline();
            this.render();
            this.persistUserConfig();
            closeMenu();
        });
        form.appendChild(applyBtn);

        addBtn.addEventListener("click", (evt) => {
            evt.stopPropagation();
            form.style.display = form.style.display === "none" ? "block" : "none";
        });
        [nameInput, formulaInput].forEach((el) => el.addEventListener("click", (evt) => evt.stopPropagation()));

        section.appendChild(form);
        menu.appendChild(section);
        menu.appendChild(this.makeDivider());
    }

    // -----------------------------------------------------------------
    // Item 4: "Combine columns" toolbar section
    // -----------------------------------------------------------------

    private renderCombineColumnsSection(menu: HTMLDivElement, closeMenu: () => void): void {
        const section = document.createElement("div");
        section.className = "skiba-toolbar__section";

        const title = document.createElement("div");
        title.className = "skiba-toolbar__section-title";
        title.textContent = "Combined columns";
        section.appendChild(title);

        this._combinedColumns.forEach((_def, name) => {
            section.appendChild(this.makeVirtualColumnListItem(name, `Remove the combined column "${name}"? This can't be undone.`, () => {
                this._combinedColumns.delete(name);
                this.recomputeVirtualColumns();
                this.applyPipeline();
                this.render();
                this.persistUserConfig();
            }));
        });

        const addBtn = document.createElement("button");
        addBtn.className = "skiba-toolbar__button";
        addBtn.textContent = "+ Combine columns";
        section.appendChild(addBtn);

        const form = document.createElement("div");
        form.className = "skiba-calc-form";
        form.style.display = "none";

        const nameInput = document.createElement("input");
        nameInput.type = "text";
        nameInput.placeholder = "Column name, e.g. Full Name";
        nameInput.className = "skiba-calc-form__input";
        nameInput.setAttribute("aria-label", "Combined column name");
        form.appendChild(nameInput);

        const templateInput = document.createElement("input");
        templateInput.type = "text";
        templateInput.placeholder = "e.g. {FirstName} {LastName}";
        templateInput.className = "skiba-calc-form__input";
        templateInput.setAttribute("aria-label", "Combine template");
        form.appendChild(templateInput);

        const errorMsg = document.createElement("div");
        errorMsg.className = "skiba-calc-form__error";
        errorMsg.setAttribute("role", "alert");
        form.appendChild(errorMsg);

        const applyBtn = document.createElement("button");
        applyBtn.className = "skiba-toolbar__button skiba-toolbar__button--primary";
        applyBtn.textContent = "Combine";
        applyBtn.addEventListener("click", (evt) => {
            evt.stopPropagation();
            errorMsg.textContent = "";

            const name = nameInput.value.trim();
            if (name.length === 0) {
                errorMsg.textContent = "Give the combined column a name.";
                return;
            }
            if (this.columns.some((c) => c.name === name)) {
                errorMsg.textContent = `"${name}" is already a column name \u2014 choose a different name.`;
                return;
            }

            const template = templateInput.value;
            const refs = Array.from(template.matchAll(/\{([^}]+)\}/g)).map((m) => m[1].trim());
            if (refs.length < 2) {
                errorMsg.textContent = "Reference at least 2 columns, e.g. {FirstName} {LastName}.";
                return;
            }
            const unknown = refs.filter((ref) => !this.columns.some((c) => c.displayName === ref || c.name === ref));
            if (unknown.length > 0) {
                errorMsg.textContent = `I don't see a column called "${unknown[0]}" \u2014 check the spelling.`;
                return;
            }

            this._combinedColumns.set(name, { template });
            this.recomputeVirtualColumns();
            this.applyPipeline();
            this.render();
            this.persistUserConfig();
            closeMenu();
        });
        form.appendChild(applyBtn);

        addBtn.addEventListener("click", (evt) => {
            evt.stopPropagation();
            form.style.display = form.style.display === "none" ? "block" : "none";
        });
        [nameInput, templateInput].forEach((el) => el.addEventListener("click", (evt) => evt.stopPropagation()));

        section.appendChild(form);
        menu.appendChild(section);
        menu.appendChild(this.makeDivider());
    }

    /** Shared list-item row (name + delete) used by both the Calculations and Combined columns sections. */
    private makeVirtualColumnListItem(name: string, confirmMessage: string, onDelete: () => void): HTMLDivElement {
        const row = document.createElement("div");
        row.className = "skiba-calc-item";

        const label = document.createElement("span");
        label.className = "skiba-calc-item__name";
        label.textContent = name;
        row.appendChild(label);

        const del = document.createElement("button");
        del.className = "skiba-calc-item__delete";
        del.textContent = "\u2715";
        del.setAttribute("aria-label", `Remove ${name}`);
        del.addEventListener("click", (evt) => {
            evt.stopPropagation();
            // Destructive (discards a saved calculation) — confirm before applying, per the design charter.
            if (window.confirm(confirmMessage)) {
                onDelete();
            }
        });
        row.appendChild(del);
        return row;
    }

    private makeDivider(): HTMLDivElement {
        const divider = document.createElement("div");
        divider.className = "skiba-toolbar__divider";
        return divider;
    }

    private makeMenuButton(label: string, onClick: () => void): HTMLButtonElement {
        const btn = document.createElement("button");
        btn.className = "skiba-toolbar__button";
        btn.textContent = label;
        btn.setAttribute("role", "menuitem");
        btn.addEventListener("click", (evt) => {
            evt.stopPropagation();
            onClick();
        });
        return btn;
    }

    // -----------------------------------------------------------------
    // Search
    // -----------------------------------------------------------------

    private renderSearchBar(): void {
        this.clearElement(this.searchRoot);
        this.searchRoot.style.display = this.settings.searchEnabled ? "" : "none";
        if (!this.settings.searchEnabled) {
            return;
        }

        const input = document.createElement("input");
        input.type = "text";
        input.className = "skiba-search__input";
        input.placeholder = this.loc("Search_Placeholder", "Search this table");
        input.setAttribute("aria-label", this.loc("Search_AriaLabel", "Search this table"));
        input.value = this._searchTerm;
        input.addEventListener("input", () => {
            this._searchTerm = input.value;
            this.applyPipeline();
            this.renderVisibleRows();
            this.renderStatusLine();
        });
        this.searchRoot.appendChild(input);

        const status = document.createElement("span");
        status.className = "skiba-search__status";
        this.searchRoot.appendChild(status);
        this.renderStatusLine();
    }

    private renderStatusLine(): void {
        const status = this.searchRoot.querySelector<HTMLSpanElement>(".skiba-search__status");
        if (!status) {
            return;
        }
        this.clearElement(status);

        if (this._searchTerm.trim().length === 0 && this._columnFilters.size === 0) {
            return;
        }

        const matchText = document.createElement("span");
        matchText.textContent = this.loc(
            "Search_StatusMatch",
            "{0} of {1} rows match",
            String(this._filteredData.length),
            String(this._data.length)
        );
        status.appendChild(matchText);

        if (this._searchTerm.trim().length > 0 && this._hasMoreData && !this.isFetchMoreDataRestricted()) {
            const link = document.createElement("button");
            link.type = "button";
            link.className = "skiba-search__full-dataset-link";
            link.textContent = this.loc("Search_FullDataset", "Search full dataset");
            link.setAttribute("aria-label", this.loc("Search_FullDatasetAriaLabel", "Search the full dataset, including rows not yet loaded"));
            link.addEventListener("click", () => this.beginForceFetchAll("search"));
            status.appendChild(document.createTextNode(" \u2014 "));
            status.appendChild(link);
        }
    }

    // -----------------------------------------------------------------
    // Per-column filters (header-driven popover) + filter chip strip
    // -----------------------------------------------------------------

    private inferFilterType(col: ITableColumn): FilterType {
        const sample = this._data.find((r) => r.values[col.name] !== null && r.values[col.name] !== undefined);
        const v = sample ? sample.values[col.name] : undefined;
        if (typeof v === "number") {
            return "number";
        }
        if (v instanceof Date) {
            return "date";
        }
        return "text";
    }

    private openFilterPopover(col: ITableColumn, anchor: HTMLElement): void {
        this.container.querySelectorAll(".skiba-filter-popover").forEach((el) => el.remove());

        const type = this.inferFilterType(col);
        const existing = this._columnFilters.get(col.name);
        const popover = document.createElement("div");
        popover.className = "skiba-filter-popover";

        const applyAndCommit = (filter: IColumnFilter | null): void => {
            if (filter) {
                this._columnFilters.set(col.name, filter);
            } else {
                this._columnFilters.delete(col.name);
            }
            this.commitFilterChange();
        };

        if (type === "text") {
            const input = document.createElement("input");
            input.type = "text";
            input.placeholder = this.loc("Filter_ContainsPlaceholder", "Contains...");
            input.value = existing?.value ?? "";
            popover.appendChild(input);

            const apply = (): void => {
                applyAndCommit(input.value.trim().length === 0 ? null : { type: "text", operator: "contains", value: input.value });
            };
            input.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    apply();
                    popover.remove();
                }
            });
            popover.appendChild(this.filterActionsRow(apply, () => applyAndCommit(null), popover));
        } else if (type === "number") {
            const opSelect = document.createElement("select");
            const opLabels: Record<FilterOperator, string> = {
                equals: this.loc("Filter_OpEquals", "="),
                gt: this.loc("Filter_OpGt", ">"),
                gte: this.loc("Filter_OpGte", "\u2265"),
                lt: this.loc("Filter_OpLt", "<"),
                lte: this.loc("Filter_OpLte", "\u2264"),
                between: this.loc("Filter_OpBetween", "between"),
                contains: this.loc("Filter_OpContains", "contains")
            };
            (["equals", "gt", "gte", "lt", "lte", "between"] as FilterOperator[]).forEach((op) => {
                const o = document.createElement("option");
                o.value = op;
                o.textContent = opLabels[op];
                if (existing?.operator === op) {
                    o.selected = true;
                }
                opSelect.appendChild(o);
            });
            popover.appendChild(opSelect);

            const val1 = document.createElement("input");
            val1.type = "number";
            val1.value = existing?.value ?? "";
            popover.appendChild(val1);

            const val2 = document.createElement("input");
            val2.type = "number";
            val2.placeholder = this.loc("Filter_AndPlaceholder", "and");
            val2.value = existing?.value2 ?? "";
            val2.style.display = opSelect.value === "between" ? "" : "none";
            popover.appendChild(val2);

            opSelect.addEventListener("change", () => {
                val2.style.display = opSelect.value === "between" ? "" : "none";
            });

            const apply = (): void => {
                applyAndCommit(val1.value.trim().length === 0 ? null : {
                    type: "number",
                    operator: opSelect.value as FilterOperator,
                    value: val1.value,
                    value2: val2.value
                });
            };
            popover.appendChild(this.filterActionsRow(apply, () => applyAndCommit(null), popover));
        } else {
            const from = document.createElement("input");
            from.type = "date";
            from.value = existing?.value ?? "";
            popover.appendChild(from);
            const to = document.createElement("input");
            to.type = "date";
            to.value = existing?.value2 ?? "";
            popover.appendChild(to);

            const apply = (): void => {
                applyAndCommit((!from.value && !to.value) ? null : { type: "date", operator: "between", value: from.value, value2: to.value });
            };
            popover.appendChild(this.filterActionsRow(apply, () => applyAndCommit(null), popover));
        }

        const rect = anchor.getBoundingClientRect();
        const containerRect = this.container.getBoundingClientRect();
        popover.style.left = `${rect.left - containerRect.left}px`;
        popover.style.top = `${rect.bottom - containerRect.top}px`;
        this.container.appendChild(popover);

        const dismiss = (evt: MouseEvent): void => {
            if (!popover.contains(evt.target as Node) && evt.target !== anchor) {
                popover.remove();
                document.removeEventListener("click", dismiss);
            }
        };
        setTimeout(() => document.addEventListener("click", dismiss), 0);
    }

    private filterActionsRow(onApply: () => void, onClear: () => void, popover: HTMLDivElement): HTMLDivElement {
        const row = document.createElement("div");
        row.className = "skiba-filter-popover__actions";
        const clearBtn = document.createElement("button");
        clearBtn.textContent = this.loc("Filter_Clear", "Clear");
        clearBtn.addEventListener("click", () => {
            onClear();
            popover.remove();
        });
        const applyBtn = document.createElement("button");
        applyBtn.textContent = this.loc("Filter_Apply", "Apply");
        applyBtn.addEventListener("click", () => {
            onApply();
            popover.remove();
        });
        row.appendChild(clearBtn);
        row.appendChild(applyBtn);
        return row;
    }

    private commitFilterChange(): void {
        this.applyPipeline();
        this.renderHeader();
        this.renderFilterChips();
        this.renderVisibleRows();
        this.renderStatusLine();
    }

    private renderFilterChips(): void {
        this.clearElement(this.filterChipsRoot);
        if (this._columnFilters.size === 0) {
            this.filterChipsRoot.style.display = "none";
            return;
        }
        this.filterChipsRoot.style.display = "";

        this._columnFilters.forEach((filter, colName) => {
            const col = this.columns.find((c) => c.name === colName);
            const label = col ? col.displayName : colName;
            const opLabels: Record<FilterOperator, string> = {
                equals: this.loc("Filter_OpEquals", "="),
                gt: this.loc("Filter_OpGt", ">"),
                gte: this.loc("Filter_OpGte", "\u2265"),
                lt: this.loc("Filter_OpLt", "<"),
                lte: this.loc("Filter_OpLte", "\u2264"),
                between: this.loc("Filter_OpBetween", "between"),
                contains: this.loc("Filter_OpContains", "contains")
            };
            const desc = filter.type === "text"
                ? `${opLabels.contains} "${filter.value}"`
                : filter.type === "date"
                    ? `${filter.value || "..."} \u2192 ${filter.value2 || "..."}`
                    : `${opLabels[filter.operator]} ${filter.value}${filter.operator === "between" ? ` ${this.loc("Filter_AndPlaceholder", "and")} ${filter.value2}` : ""}`;

            const chip = document.createElement("span");
            chip.className = "skiba-filter-chip";
            chip.textContent = `${label}: ${desc}`;

            const remove = document.createElement("button");
            remove.className = "skiba-filter-chip__remove";
            remove.textContent = "\u00D7";
            remove.setAttribute("aria-label", this.loc("Filter_RemoveAriaLabel", "Remove filter on {0}", label));
            remove.addEventListener("click", () => {
                this._columnFilters.delete(colName);
                this.commitFilterChange();
            });
            chip.appendChild(remove);
            this.filterChipsRoot.appendChild(chip);
        });
    }

    // -----------------------------------------------------------------
    // Header (sorting, resizing, drag-to-reorder, filter icon)
    // -----------------------------------------------------------------

    /**
     * Item 34 (Module D): called from visual.ts on every update() with the visual's own
     * viewport width. Only triggers a re-render when the narrow state (or, while narrow,
     * the available width) actually changed, so a same-size update doesn't do extra work.
     * Storing rather than immediately rendering on first call is deliberate -- this can run
     * before `settings` exists (resizeViewport runs early in updateInternal()); the value
     * is simply picked up by the first real render() once settings are populated.
     */
    public setNarrowLayout(isNarrow: boolean, availableWidth: number): void {
        const changed = isNarrow !== this._isNarrow || (isNarrow && availableWidth !== this._narrowAvailableWidth);
        this._isNarrow = isNarrow;
        this._narrowAvailableWidth = availableWidth;
        // Bugfix (item 34 loop): resizeViewport() -> setNarrowLayout() runs at the TOP of
        // updateInternal(), before this cycle's data has been parsed and handed to
        // setData(). Without this guard, a narrow-state flip on the very first render (or
        // any render where width crosses the breakpoint) forces an immediate re-render
        // against stale/empty `_renderNodes` from the previous cycle -- which can itself
        // trigger another host update(), producing an infinite update/resize loop. Only
        // re-render here if there's actually data to render; the real table render later
        // in this same updateInternal() cycle will pick up the new narrow state anyway.
        if (changed && this.settings && this._renderNodes && this._renderNodes.length > 0) {
            this.renderHeader();
            this.renderVisibleRows();
        }
    }

    private visibleColumns(): ITableColumn[] {
        const pivotName = this._dragGroupColumn?.name;
        const base = this._columnOrder
            .map((name) => this.columns.find((c) => c.name === name))
            .filter((c): c is ITableColumn => !!c && !this._hiddenColumns.has(c.name) && c.name !== pivotName);

        if (!this._isNarrow) {
            return base;
        }
        // Item 1 (Module D): on a phone-narrow canvas, auto-select a reduced, leading
        // subset of columns that actually fits, on top of whatever the user has already
        // hidden via the toolbar. This is purely a *display* selection layered on top of
        // `_hiddenColumns` -- it never mutates it, so widening the tile back out restores
        // every column with no user action, and the toolbar's own column checkboxes still
        // work exactly as before underneath it.
        return selectColumnsForWidth(base, (c) => this.columnWidth(c), this._narrowAvailableWidth);
    }

    private columnWidth(col: ITableColumn): number {
        return this._columnWidths.get(col.name) ?? 150;
    }

    private renderHeader(): void {
        this.clearElement(this.headerRoot);
        const row = document.createElement("div");
        row.className = "skiba-table__row skiba-table__row--header";
        row.setAttribute("role", "row");

        this.visibleColumns().forEach((col) => {
            const th = document.createElement("div");
            th.className = "skiba-table__cell skiba-table__cell--header";
            th.setAttribute("role", "columnheader");
            th.style.width = `${this.columnWidth(col)}px`;
            th.tabIndex = 0;
            th.setAttribute("aria-sort", this.ariaSortFor(col.name));
            th.draggable = true;

            th.addEventListener("dragstart", (evt: DragEvent) => {
                evt.dataTransfer?.setData("text/skiba-column", col.name);
                th.classList.add("skiba-table__cell--dragging");
                // Item 2: reveal the "Group by" drop target only while a header is actually being dragged.
                if (!col.isMeasure) {
                    this.pivotDropRoot.style.display = "flex";
                }
            });
            th.addEventListener("dragend", () => {
                th.classList.remove("skiba-table__cell--dragging");
                this.pivotDropRoot.style.display = "none";
            });
            th.addEventListener("dragover", (evt: DragEvent) => evt.preventDefault());
            th.addEventListener("drop", (evt: DragEvent) => {
                evt.preventDefault();
                const draggedName = evt.dataTransfer?.getData("text/skiba-column");
                if (!draggedName || draggedName === col.name) {
                    return;
                }
                this.reorderColumn(draggedName, col.name);
            });

            const label = document.createElement("span");
            label.className = "skiba-table__header-label";
            label.textContent = col.displayName;
            th.appendChild(label);

            if (this._sortState.column === col.name && this._sortState.direction !== "none") {
                const arrow = document.createElement("span");
                arrow.className = "skiba-table__sort-arrow";
                arrow.textContent = this._sortState.direction === "asc" ? "\u25B2" : "\u25BC";
                th.appendChild(arrow);
            }

            if (this.settings.enableColumnFilters) {
                const filterBtn = document.createElement("button");
                filterBtn.className = "skiba-filter-icon";
                filterBtn.classList.toggle("skiba-filter-icon--active", this._columnFilters.has(col.name));
                filterBtn.textContent = "\u25BE";
                filterBtn.setAttribute("aria-label", this.loc("Filter_IconAriaLabel", "Filter {0}", col.displayName));
                filterBtn.addEventListener("click", (evt) => {
                    evt.stopPropagation();
                    this.openFilterPopover(col, filterBtn);
                });
                th.appendChild(filterBtn);
            }

            // Full Keyboard Navigation (item 14): header cells are already tabbable and
            // Enter/Space cycles sort, matching the mouse click.
            const activate = (): void => this.cycleSort(col.name);
            label.addEventListener("click", activate);
            th.addEventListener("keydown", (evt: KeyboardEvent) => {
                if (evt.key === "Enter" || evt.key === " ") {
                    evt.preventDefault();
                    activate();
                }
            });

            // Item 8: "read-only" viewers lose the resize handle entirely (not just
            // disabled) alongside the export buttons and the save-default-view button.
            if (this.settings.permission !== "read-only") {
                const resizer = document.createElement("div");
                resizer.className = "skiba-resizer";
                resizer.setAttribute("aria-hidden", "true");
                this.attachResizeDrag(resizer, col);
                th.appendChild(resizer);
            }

            row.appendChild(th);
        });

        this.headerRoot.appendChild(row);
    }

    /** Moves `draggedName` to sit at `targetName`'s current position. */
    private reorderColumn(draggedName: string, targetName: string): void {
        const from = this._columnOrder.indexOf(draggedName);
        const to = this._columnOrder.indexOf(targetName);
        if (from === -1 || to === -1) {
            return;
        }
        this._columnOrder.splice(from, 1);
        this._columnOrder.splice(to, 0, draggedName);
        this.renderHeader();
        this.renderVisibleRows();
    }

    private ariaSortFor(columnName: string): "ascending" | "descending" | "none" {
        if (this._sortState.column !== columnName) {
            return "none";
        }
        if (this._sortState.direction === "asc") {
            return "ascending";
        }
        if (this._sortState.direction === "desc") {
            return "descending";
        }
        return "none";
    }

    /** Clicking a header cycles Ascending -> Descending -> None, with a visible arrow at every step. */
    private cycleSort(columnName: string): void {
        if (this._sortState.column !== columnName) {
            this._sortState = { column: columnName, direction: "asc" };
        } else if (this._sortState.direction === "asc") {
            this._sortState = { column: columnName, direction: "desc" };
        } else if (this._sortState.direction === "desc") {
            this._sortState = { column: null, direction: "none" };
        } else {
            this._sortState = { column: columnName, direction: "asc" };
        }
        this.applyPipeline();
        this.renderHeader();
        this.renderVisibleRows();
    }

    private resetSorts(): void {
        this._sortState = { column: null, direction: "none" };
        this.applyPipeline();
        this.renderHeader();
        this.renderVisibleRows();
    }

    private resetColumnWidths(): void {
        this._columnWidths.clear();
        this.renderHeader();
        this.renderVisibleRows();
    }

    private attachResizeDrag(handle: HTMLDivElement, col: ITableColumn): void {
        d3.select(handle).call(
            d3
                .drag<HTMLDivElement, unknown>()
                .on("start", (event: d3.D3DragEvent<HTMLDivElement, unknown, unknown>) => {
                    (event.sourceEvent as Event).stopPropagation();
                    handle.classList.add("skiba-resizer--active");
                })
                .on("drag", (event: d3.D3DragEvent<HTMLDivElement, unknown, unknown>) => {
                    const current = this.columnWidth(col);
                    const next = Math.max(60, current + event.dx);
                    this._columnWidths.set(col.name, next);
                    this.renderHeader();
                    this.renderVisibleRows();
                })
                .on("end", () => {
                    handle.classList.remove("skiba-resizer--active");
                })
        );
    }

    // -----------------------------------------------------------------
    // Filter / search / sort / group pipeline
    // -----------------------------------------------------------------

    private matchesColumnFilter(row: ITableRow, colName: string, filter: IColumnFilter): boolean {
        const raw = row.values[colName];

        if (filter.type === "text") {
            if (raw === null || raw === undefined) {
                return false;
            }
            return String(raw).toLowerCase().includes(filter.value.toLowerCase());
        }

        if (filter.type === "number") {
            if (typeof raw !== "number") {
                return false;
            }
            const v1 = parseFloat(filter.value);
            switch (filter.operator) {
                case "between": {
                    const v2 = parseFloat(filter.value2 ?? filter.value);
                    return raw >= Math.min(v1, v2) && raw <= Math.max(v1, v2);
                }
                case "equals": return raw === v1;
                case "gt": return raw > v1;
                case "gte": return raw >= v1;
                case "lt": return raw < v1;
                case "lte": return raw <= v1;
                default: return true;
            }
        }

        // date
        const rawDate = raw instanceof Date ? raw : (typeof raw === "string" ? new Date(raw) : null);
        if (!rawDate || isNaN(rawDate.getTime())) {
            return false;
        }
        if (filter.value) {
            const from = new Date(filter.value);
            if (rawDate < from) {
                return false;
            }
        }
        if (filter.value2) {
            const to = new Date(filter.value2);
            if (rawDate > to) {
                return false;
            }
        }
        return true;
    }

    private applyPipeline(): void {
        let rows = this._data;

        this._columnFilters.forEach((filter, colName) => {
            rows = rows.filter((row) => this.matchesColumnFilter(row, colName, filter));
        });

        const term = this._searchTerm.trim().toLowerCase();
        if (term.length > 0) {
            rows = rows.filter((row) =>
                this.columns.some((col) => {
                    const v = row.values[col.name];
                    return v !== null && v !== undefined && String(v).toLowerCase().includes(term);
                })
            );
        }

        if (this._sortState.column && this._sortState.direction !== "none") {
            const col = this._sortState.column;
            const dir = this._sortState.direction === "asc" ? 1 : -1;
            rows = [...rows].sort((a, b) => {
                const av = a.values[col];
                const bv = b.values[col];
                if (av === null || av === undefined) return 1;
                if (bv === null || bv === undefined) return -1;
                if (typeof av === "number" && typeof bv === "number") {
                    return (av - bv) * dir;
                }
                return String(av).localeCompare(String(bv)) * dir;
            });
        }

        this._filteredData = rows;
        const baseNodes = this.effectiveGroupColumns().length > 0
            ? this.buildGroupedNodes(rows)
            : rows.map((r) => ({ kind: "row", depth: 0, row: r } as RenderNode));

        this._renderNodes = this.insertDetailNodes(baseNodes);
        this.computeNodeOffsets();
    }

    // -----------------------------------------------------------------
    // True drill-down: per-record detail sub-grid (Item 5)
    //
    // Distinct from group expand/collapse above: clicking the disclosure
    // control on a *leaf* row expands an inline sub-grid listing every
    // field of that underlying record -- including columns hidden via the
    // column-visibility toggle and Tooltip-role fields -- not just the
    // columns currently visible in the main grid.
    // -----------------------------------------------------------------

    /** Walks a flat node list and splices in a "detail" node immediately after each row node that's expanded. */
    private insertDetailNodes(nodes: RenderNode[]): RenderNode[] {
        if (this._expandedDetailRows.size === 0) {
            return nodes;
        }
        const out: RenderNode[] = [];
        nodes.forEach((n) => {
            out.push(n);
            if (n.kind === "row" && this._expandedDetailRows.has(n.row.key)) {
                out.push({ kind: "detail", depth: n.depth, row: n.row });
            }
        });
        return out;
    }

    /** Every field available for a record's detail view: all manageable columns plus Tooltip-role fields, deduped. */
    private allDetailColumns(): ITableColumn[] {
        const seen = new Set<string>();
        const list: ITableColumn[] = [];
        [...this.columns, ...this.tooltipColumns].forEach((c) => {
            if (!seen.has(c.name)) {
                seen.add(c.name);
                list.push(c);
            }
        });
        return list;
    }

    private detailRowHeight(): number {
        return this.allDetailColumns().length * this.detailFieldRowHeight + 16;
    }

    private toggleDetail(rowKey: string): void {
        if (this._expandedDetailRows.has(rowKey)) {
            this._expandedDetailRows.delete(rowKey);
        } else {
            this._expandedDetailRows.add(rowKey);
        }
        this.applyPipeline();
        this.renderVisibleRows();
    }

    /**
     * Cumulative pixel offset of every node in `_renderNodes`, since detail nodes break the
     * "every node is `defaultRowHeight` tall" assumption the virtual scroller otherwise relies on.
     */
    private computeNodeOffsets(): void {
        const offsets: number[] = [];
        let acc = 0;
        this._renderNodes.forEach((n) => {
            offsets.push(acc);
            acc += n.kind === "detail" ? this.detailRowHeight() : this.defaultRowHeight;
        });
        this._nodeOffsets = offsets;
        this._totalContentHeight = acc;
    }

    /** Binary search: index of the last node whose offset is <= target. */
    private findNodeIndexAtOffset(target: number): number {
        const offsets = this._nodeOffsets;
        let lo = 0;
        let hi = offsets.length - 1;
        let ans = 0;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (offsets[mid] <= target) {
                ans = mid;
                lo = mid + 1;
            } else {
                hi = mid - 1;
            }
        }
        return ans;
    }

    // -----------------------------------------------------------------
    // Grouping / drill-down
    // -----------------------------------------------------------------

    private bucketRows(rows: ITableRow[], col: ITableColumn): Map<string, ITableRow[]> {
        const buckets = new Map<string, ITableRow[]>();
        rows.forEach((r) => {
            const raw = r.values[col.name];
            const key = raw === null || raw === undefined ? "(blank)" : String(raw);
            const arr = buckets.get(key);
            if (arr) {
                arr.push(r);
            } else {
                buckets.set(key, [r]);
            }
        });
        return buckets;
    }

    /** Recursively groups by each "Group by" role column, in order, producing a flat list of group + row nodes. */
    private buildGroupedNodes(rows: ITableRow[]): RenderNode[] {
        const nodes: RenderNode[] = [];
        const groupCols = this.effectiveGroupColumns();

        const recurse = (subRows: ITableRow[], depth: number, prefix: string): void => {
            if (depth >= groupCols.length) {
                subRows.forEach((r) => nodes.push({ kind: "row", depth, row: r }));
                return;
            }

            const col = groupCols[depth];
            const buckets = this.bucketRows(subRows, col);

            buckets.forEach((bucketRows, key) => {
                const path = prefix + GROUP_SEP + col.name + "=" + key;

                const sums = new Map<string, number>();
                this.valueColumns.forEach((vc) => {
                    const total = d3.sum(bucketRows, (r) => {
                        const v = r.values[vc.name];
                        return typeof v === "number" ? v : 0;
                    });
                    sums.set(vc.name, total);
                });

                if (!this._groupExpansion.has(path)) {
                    this._groupExpansion.set(path, this.settings.groupsDefaultExpanded);
                }

                const rawValue = bucketRows[0].values[col.name];
                nodes.push({ kind: "group", depth, path, column: col, value: rawValue, count: bucketRows.length, sums });

                if (this._groupExpansion.get(path)) {
                    recurse(bucketRows, depth + 1, path);
                }
            });
        };

        recurse(rows, 0, "");
        return nodes;
    }

    private toggleGroup(path: string): void {
        const current = this._groupExpansion.get(path) ?? this.settings.groupsDefaultExpanded;
        this._groupExpansion.set(path, !current);
        this.applyPipeline();
        this.renderVisibleRows();
    }

    /** Walks the full (unfiltered-by-collapse) group tree, forcing every path's expansion state. */
    private setAllGroupsExpansion(expanded: boolean): void {
        const groupCols = this.effectiveGroupColumns();
        const walk = (rows: ITableRow[], depth: number, prefix: string): void => {
            if (depth >= groupCols.length) {
                return;
            }
            const col = groupCols[depth];
            const buckets = this.bucketRows(rows, col);
            buckets.forEach((bucketRows, key) => {
                const path = prefix + GROUP_SEP + col.name + "=" + key;
                this._groupExpansion.set(path, expanded);
                walk(bucketRows, depth + 1, path);
            });
        };
        walk(this._filteredData, 0, "");
        this.applyPipeline();
        this.renderVisibleRows();
    }

    private expandAllGroups(): void {
        this.setAllGroupsExpansion(true);
    }

    private collapseAllGroups(): void {
        this.setAllGroupsExpansion(false);
    }

    // -----------------------------------------------------------------
    // Saved views -- "the report's default view" (Item 7)
    //
    // Persisted via host.persistProperties() into the `savedView` object,
    // which travels with the .pbix automatically (no backend, no browser
    // storage). Saving is always an explicit user action; loading the saved
    // view onto a freshly opened report happens exactly once, driven by
    // visual.ts calling applyPersistedSavedViewIfPresent() after the first
    // setData().
    // -----------------------------------------------------------------

    /** Snapshots the renderer's current live state into a plain, JSON-serializable object. */
    private buildViewStateFromCurrent(): ISavedViewState {
        const columnWidths: { [columnName: string]: number } = {};
        this._columnWidths.forEach((width, name) => {
            columnWidths[name] = width;
        });

        const groupExpansion: { [groupPath: string]: boolean } = {};
        this._groupExpansion.forEach((expanded, path) => {
            groupExpansion[path] = expanded;
        });

        return {
            sortColumn: this._sortState.column,
            sortDirection: this._sortState.direction,
            columnOrder: [...this._columnOrder],
            columnWidths,
            hiddenColumns: [...this._hiddenColumns],
            searchTerm: this._searchTerm,
            groupExpansion
        };
    }

    /** Applies a saved view snapshot onto live state and does a full re-render. Defensive against columns that no longer exist. */
    private applyViewState(state: ISavedViewState): void {
        const knownNames = new Set(this.columns.map((c) => c.name));

        const restoredOrder = (state.columnOrder || []).filter((name) => knownNames.has(name));
        this.columns.forEach((c) => {
            if (restoredOrder.indexOf(c.name) === -1) {
                restoredOrder.push(c.name);
            }
        });
        this._columnOrder = restoredOrder;

        this._columnWidths = new Map(
            Object.keys(state.columnWidths || {})
                .filter((name) => knownNames.has(name))
                .map((name) => [name, state.columnWidths[name]] as [string, number])
        );

        this._hiddenColumns = new Set((state.hiddenColumns || []).filter((name) => knownNames.has(name)));

        this._sortState = state.sortColumn && knownNames.has(state.sortColumn)
            ? { column: state.sortColumn, direction: state.sortDirection }
            : { column: null, direction: "none" };

        this._searchTerm = state.searchTerm || "";

        this._groupExpansion = new Map(Object.entries(state.groupExpansion || {}));

        this.applyPipeline();
        this.render();
    }

    /** Called once by visual.ts on the first update() after a report opens, if a default view was saved. No-op otherwise. */
    public applyPersistedSavedViewIfPresent(): void {
        if (this._persistedViewState) {
            this.applyViewState(this._persistedViewState);
        }
    }

    /** Persists the current live state as the report's default view. An explicit user action only -- never automatic. */
    private saveCurrentViewAsDefault(): void {
        const state = this.buildViewStateFromCurrent();
        this._persistedViewState = state;
        this.host.persistProperties({
            merge: [
                {
                    objectName: "savedView",
                    selector: null,
                    properties: { state: JSON.stringify(state) }
                }
            ]
        });
    }

    /** Discards live customizations and restores the persisted default view (or the visual's original defaults if none was ever saved). Always recoverable -- no confirmation needed. */
    private resetToDefaultView(): void {
        if (this._persistedViewState) {
            this.applyViewState(this._persistedViewState);
            return;
        }
        this.applyViewState({
            sortColumn: null,
            sortDirection: "none",
            columnOrder: this.columns.map((c) => c.name),
            columnWidths: {},
            hiddenColumns: [],
            searchTerm: "",
            groupExpansion: {}
        });
    }

    // -----------------------------------------------------------------
    // Virtual scrolling body
    // -----------------------------------------------------------------

    private renderVisibleRows(): void {
        const rowHeight = this.defaultRowHeight;
        const nodes = this._renderNodes;
        const totalRows = nodes.length;

        if (totalRows === 0) {
            this.clearElement(this.bodyRoot);
            const empty = document.createElement("div");
            empty.className = "skiba-table__empty-filter";
            empty.textContent = (this._searchTerm.trim().length > 0 || this._columnFilters.size > 0)
                ? this.loc("Empty_NoRowsMatch", "No rows match your search or filters.")
                : this.loc("Empty_NoData", "No data to display.");
            this.bodyRoot.appendChild(empty);
            this.bodyRoot.style.height = "auto";
            return;
        }

        const viewportHeight = this.scrollRoot.clientHeight || 400;
        const scrollTop = this.scrollRoot.scrollTop;

        // Node heights aren't uniform once a detail sub-grid (Item 5) is expanded, so start/end
        // indices come from the precomputed offset table (computeNodeOffsets) rather than a
        // simple scrollTop / rowHeight division.
        let startIndex = 0;
        let endIndex = totalRows;
        if (this.settings.virtualScrollEnabled) {
            startIndex = Math.max(0, this.findNodeIndexAtOffset(scrollTop) - Math.floor(ROW_BUFFER / 2));
            endIndex = Math.min(totalRows, this.findNodeIndexAtOffset(scrollTop + viewportHeight) + Math.ceil(ROW_BUFFER / 2) + 1);
        }

        const topSpacerHeight = this._nodeOffsets[startIndex] ?? 0;
        const bottomSpacerHeight = this._totalContentHeight - (endIndex < totalRows ? this._nodeOffsets[endIndex] : this._totalContentHeight);

        this.clearElement(this.bodyRoot);
        this.bodyRoot.style.position = "relative";

        const topSpacer = document.createElement("div");
        topSpacer.style.height = `${topSpacerHeight}px`;
        topSpacer.style.flexShrink = "0";
        this.bodyRoot.appendChild(topSpacer);

        const visibleColumns = this.visibleColumns();
        const selectedIds = this.selectionManager.getSelectionIds() as ISelectionId[];

        for (let i = startIndex; i < endIndex; i++) {
            const node = nodes[i];
            if (node.kind === "group") {
                this.bodyRoot.appendChild(this.renderGroupRow(node, visibleColumns, rowHeight));
            } else if (node.kind === "detail") {
                this.bodyRoot.appendChild(this.renderDetailRow(node.row, node.depth));
            } else {
                const isDetailExpanded = this._expandedDetailRows.has(node.row.key);
                this.bodyRoot.appendChild(this.renderRow(node.row, node.depth, i, visibleColumns, selectedIds, rowHeight, isDetailExpanded));
            }
        }

        const bottomSpacer = document.createElement("div");
        bottomSpacer.style.height = `${bottomSpacerHeight}px`;
        bottomSpacer.style.flexShrink = "0";
        this.bodyRoot.appendChild(bottomSpacer);

        if (this.settings.showTotals) {
            this.bodyRoot.appendChild(this.renderTotalsRow(visibleColumns, rowHeight));
        }
    }

    private renderGroupRow(node: Extract<RenderNode, { kind: "group" }>, visibleColumns: ITableColumn[], rowHeight: number): HTMLDivElement {
        const rowEl = document.createElement("div");
        rowEl.className = "skiba-table__row skiba-table__row--group";
        rowEl.style.height = `${rowHeight}px`;
        rowEl.setAttribute("role", "row");

        const isExpanded = this._groupExpansion.get(node.path) ?? this.settings.groupsDefaultExpanded;

        const chevron = document.createElement("span");
        chevron.className = "skiba-group__chevron";
        chevron.textContent = isExpanded ? "\u25BC" : "\u25B6";
        chevron.style.marginLeft = `${node.depth * 16}px`;

        const label = document.createElement("span");
        label.className = "skiba-group__label";
        const valueText = node.value === null || node.value === undefined ? this.loc("Group_Blank", "(blank)") : String(node.value);
        label.textContent = `${node.column.displayName}: ${valueText} (${node.count})`;

        const head = document.createElement("div");
        head.className = "skiba-table__cell skiba-table__cell--group-label";
        head.appendChild(chevron);
        head.appendChild(label);
        rowEl.appendChild(head);

        // Item 5: the group row is the disclosure control for its detail sub-grid — keyboard
        // accessible and ARIA-labelled, matching the pattern already used by header sort buttons.
        // Full Keyboard Navigation (item 14): group rows toggle expand/collapse via Enter/Space,
        // like the header sort cells and data rows below. Local UI state (not a cross-filter
        // selection), so it stays available even when allowInteractions is false.
        rowEl.tabIndex = 0;
        rowEl.setAttribute("role", "button");
        rowEl.setAttribute("aria-expanded", String(isExpanded));
        rowEl.setAttribute("aria-label", `${node.column.displayName}: ${valueText}, ${node.count} records, ${isExpanded ? "expanded" : "collapsed"}`);
        rowEl.addEventListener("click", () => this.toggleGroup(node.path));
        rowEl.addEventListener("keydown", (evt: KeyboardEvent) => {
            if (evt.key === "Enter" || evt.key === " ") {
                evt.preventDefault();
                this.toggleGroup(node.path);
            }
        });

        // Aggregate sums for measure columns, aligned like a mini totals strip on the group row.
        visibleColumns.filter((c) => c.isMeasure).forEach((col) => {
            const cell = document.createElement("div");
            cell.className = "skiba-table__cell skiba-table__cell--group-sum";
            cell.style.width = `${this.columnWidth(col)}px`;
            const sum = node.sums.get(col.name) ?? 0;
            cell.textContent = this.formatNumber(sum);
            rowEl.appendChild(cell);
        });

        return rowEl;
    }

    private renderRow(
        row: ITableRow,
        depth: number,
        index: number,
        visibleColumns: ITableColumn[],
        selectedIds: ISelectionId[],
        rowHeight: number,
        isDetailExpanded: boolean = false
    ): HTMLDivElement {
        const rowEl = document.createElement("div");
        rowEl.className = "skiba-table__row";
        rowEl.style.height = `${rowHeight}px`;
        rowEl.setAttribute("role", "row");
        rowEl.classList.toggle("skiba-table__row--alt", index % 2 === 1);

        const isSelected = selectedIds.some((id) => id.equals(row.selectionId));
        rowEl.classList.toggle("skiba-table__row--selected", isSelected);

        // Full Keyboard Navigation (item 14): rows are focusable and Enter/Space selects,
        // mirroring the click behavior below.
        rowEl.tabIndex = 0;
        rowEl.setAttribute("aria-selected", String(isSelected));

        const selectRow = (multiSelect: boolean): void => {
            if (!this.interactionsAllowed()) {
                return;
            }
            this.selectionManager.select(row.selectionId, multiSelect).then(() => {
                this.renderVisibleRows();
            });
        };

        rowEl.addEventListener("click", (evt: MouseEvent) => {
            selectRow(evt.ctrlKey || evt.metaKey);
        });
        rowEl.addEventListener("keydown", (evt: KeyboardEvent) => {
            if (evt.key === "Enter" || evt.key === " ") {
                evt.preventDefault();
                selectRow(evt.ctrlKey || evt.metaKey);
            }
        });

        // Right-Click Context Menu (item 12): data-point mode. Native Power BI menu
        // (Include/Exclude/etc), surfaced via selectionManager -- not custom menu items.
        rowEl.addEventListener("contextmenu", (evt: MouseEvent) => {
            if (!this.interactionsAllowed()) {
                return;
            }
            evt.preventDefault();
            evt.stopPropagation();
            this.selectionManager.showContextMenu(row.selectionId, { x: evt.clientX, y: evt.clientY });
        });

        rowEl.addEventListener("mouseenter", (evt: MouseEvent) => this.showRowTooltip(row, evt));
        rowEl.addEventListener("mousemove", (evt: MouseEvent) => this.moveTooltip(evt));
        rowEl.addEventListener("mouseleave", () => this.hideTooltip());

        visibleColumns.forEach((col, idx) => {
            const cell = this.renderCell(row, col);
            if (idx === 0) {
                if (depth > 0) {
                    cell.style.paddingLeft = `${depth * 16 + 8}px`;
                }
                cell.insertBefore(this.renderDetailToggle(row, isDetailExpanded), cell.firstChild);
            }
            rowEl.appendChild(cell);
        });

        return rowEl;
    }

    /**
     * Disclosure control for a leaf row's full-record detail sub-grid (Item 5). Nested inside
     * the row's own focusable/clickable region, so it needs its own tabIndex/role and must stop
     * propagation on click and Enter/Space -- otherwise toggling detail would also fire the row's
     * cross-filter selection handler.
     */
    private renderDetailToggle(row: ITableRow, isExpanded: boolean): HTMLSpanElement {
        const toggle = document.createElement("span");
        toggle.className = "skiba-table__row-toggle";
        toggle.textContent = isExpanded ? "\u25BC" : "\u25B6";
        toggle.tabIndex = 0;
        toggle.setAttribute("role", "button");
        toggle.setAttribute("aria-expanded", String(isExpanded));
        toggle.setAttribute(
            "aria-label",
            isExpanded
                ? this.loc("Detail_Collapse", "Collapse record details")
                : this.loc("Detail_Expand", "Expand record details")
        );

        toggle.addEventListener("click", (evt: MouseEvent) => {
            evt.stopPropagation();
            this.toggleDetail(row.key);
        });
        toggle.addEventListener("keydown", (evt: KeyboardEvent) => {
            if (evt.key === "Enter" || evt.key === " ") {
                evt.preventDefault();
                evt.stopPropagation();
                this.toggleDetail(row.key);
            }
        });

        return toggle;
    }

    /**
     * The record-detail sub-grid itself: every field of the underlying row (including columns
     * hidden from the main grid and Tooltip-role fields) as a two-column Field/Value list.
     */
    private renderDetailRow(row: ITableRow, depth: number): HTMLDivElement {
        const wrap = document.createElement("div");
        wrap.className = "skiba-table__row skiba-table__row--detail";
        wrap.style.height = `${this.detailRowHeight()}px`;
        wrap.style.paddingLeft = `${depth * 16 + 24}px`;
        wrap.setAttribute("role", "row");

        const grid = document.createElement("div");
        grid.className = "skiba-detail-grid";

        this.allDetailColumns().forEach((col) => {
            const field = document.createElement("div");
            field.className = "skiba-detail-grid__field";

            const label = document.createElement("span");
            label.className = "skiba-detail-grid__label";
            label.textContent = col.displayName;

            const raw = row.values[col.name];
            const value = document.createElement("span");
            value.className = "skiba-detail-grid__value";
            value.textContent = raw === null || raw === undefined
                ? ""
                : (typeof raw === "number" ? this.formatNumber(raw) : String(raw));

            field.appendChild(label);
            field.appendChild(value);
            grid.appendChild(field);
        });

        wrap.appendChild(grid);
        return wrap;
    }

    private tier4CellColor(columnName: string, rawValue: unknown): string | null {
        const columnColor = this._tier4ColumnColors.get(columnName);
        let result = columnColor ?? null;
        const textValue = rawValue === null || rawValue === undefined ? "" : String(rawValue);
        const numericValue = typeof rawValue === "number" ? rawValue : Number(rawValue);
        this._tier4Rules.forEach((rule) => {
            if (rule.column !== columnName) return;
            const numericRule = Number(rule.value);
            const bothNumeric = Number.isFinite(numericValue) && Number.isFinite(numericRule);
            const matched = rule.operator === "contains"
                ? textValue.toLowerCase().includes(rule.value.toLowerCase())
                : rule.operator === "equals"
                    ? (bothNumeric ? numericValue === numericRule : textValue === rule.value)
                    : rule.operator === "gt"
                        ? bothNumeric && numericValue > numericRule
                        : rule.operator === "gte"
                            ? bothNumeric && numericValue >= numericRule
                            : rule.operator === "lt"
                                ? bothNumeric && numericValue < numericRule
                                : rule.operator === "lte"
                                    ? bothNumeric && numericValue <= numericRule
                                    : false;
            if (matched) result = rule.color;
        });
        return result;
    }
    private renderCell(row: ITableRow, col: ITableColumn): HTMLDivElement {
        const cell = document.createElement("div");
        cell.className = "skiba-table__cell";
        cell.style.width = `${this.columnWidth(col)}px`;
        cell.setAttribute("role", "cell");

        const rawValue = row.values[col.name];
        const text = document.createElement("span");
        text.className = "skiba-table__cell-text";
        text.textContent = rawValue === null || rawValue === undefined ? "" : String(rawValue);
        cell.appendChild(text);

        if (this._sparklineColumns.has(col.name) && col.isMeasure && typeof rawValue === "number") {
            const spark = this.renderSparkline(col, row);
            if (spark) {
                cell.classList.add("skiba-table__cell--with-sparkline");
                cell.appendChild(spark);
            }
        }

        if (this.settings.conditionalFormatEnabled && col.isMeasure && typeof rawValue === "number") {
            const range = this._columnMinMax.get(col.name);
            if (range && range.max > range.min) {
                const t = (rawValue - range.min) / (range.max - range.min);
                cell.style.backgroundColor = this._tier4ColumnColors.get(col.name) ?? colorForTier4Value(rawValue, this._tier4Rules) ?? d3.interpolateRgb(this.settings.conditionalFormatMinColor, this.settings.conditionalFormatMaxColor)(t);
            }
        }

        const tier4Color = this.tier4CellColor(col.name, rawValue);
        if (tier4Color) {
            cell.style.backgroundColor = tier4Color;
            cell.style.color = "#26320a";
        }
        if (this.settings.enableDataBars && col.isMeasure && typeof rawValue === "number") {
            const maxAbs = this.columnStatsMax(col.name);
            if (maxAbs > 0) {
                const bar = document.createElement("div");
                bar.className = "skiba-table__data-bar";
                const widthPct = Math.min(100, (Math.abs(rawValue) / maxAbs) * 100);
                bar.style.width = `${widthPct}%`;
                cell.insertBefore(bar, text);
            }
        }

        this.appendLinkActionIcon(cell, col, row);

        return cell;
    }

    // -----------------------------------------------------------------
    // Item 3: sparklines
    // -----------------------------------------------------------------

    /**
     * Trend for a numeric column leading up to and including this row, using the trailing
     * window of rows in the current search/sort/filter order (falls back to the row's own
     * position when no "Group by" dimension is present to bucket a series by).
     */
    private renderSparkline(col: ITableColumn, row: ITableRow): SVGSVGElement | null {
        const idx = this._filteredData.indexOf(row);
        if (idx === -1) {
            return null;
        }

        const windowSize = 10;
        const start = Math.max(0, idx - windowSize + 1);
        const series = this._filteredData
            .slice(start, idx + 1)
            .map((r) => r.values[col.name])
            .filter((v): v is number => typeof v === "number");

        if (series.length < 2) {
            return null;
        }

        const w = 56;
        const h = 18;
        const min = Math.min(...series);
        const max = Math.max(...series);
        const range = max - min || 1;
        const denom = series.length - 1;

        const points = series
            .map((v, i) => {
                const x = (i / denom) * (w - 2) + 1;
                const y = h - 1 - ((v - min) / range) * (h - 2);
                return `${x.toFixed(1)},${y.toFixed(1)}`;
            })
            .join(" ");

        const svgNS = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(svgNS, "svg") as SVGSVGElement;
        svg.setAttribute("class", "skiba-sparkline");
        svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
        svg.setAttribute("width", String(w));
        svg.setAttribute("height", String(h));
        svg.setAttribute("aria-hidden", "true"); // decorative — the exact value is already in the cell text
        svg.setAttribute("focusable", "false");

        const polyline = document.createElementNS(svgNS, "polyline");
        polyline.setAttribute("points", points);
        polyline.setAttribute("class", "skiba-sparkline__line");
        svg.appendChild(polyline);

        const lastValue = series[series.length - 1];
        const dot = document.createElementNS(svgNS, "circle");
        dot.setAttribute("cx", String(w - 1));
        dot.setAttribute("cy", String(h - 1 - ((lastValue - min) / range) * (h - 2)));
        dot.setAttribute("r", "1.5");
        dot.setAttribute("class", "skiba-sparkline__dot");
        svg.appendChild(dot);

        return svg;
    }

    // -----------------------------------------------------------------
    // Conditional URL actions (Item 9)
    //
    // Rules are authored as a JSON array in the formatting pane (Power BI's
    // format-pane API doesn't support arbitrary user-added rows in a repeating
    // UI), evaluated top-to-bottom, first match wins. Every resolved URL is
    // hard-checked to http(s) only and every substituted value is
    // encodeURIComponent()-escaped before host.launchUrl() is ever called --
    // launchUrl() is the certification-approved way for a Power BI visual to
    // open a link and needs no special privilege declaration.
    // -----------------------------------------------------------------

    /** If `col` is the designated link-icon column and a rule matches this row, appends a small clickable link icon to `cell`. */
    private appendLinkActionIcon(cell: HTMLDivElement, col: ITableColumn, row: ITableRow): void {
        const iconColumn = (this.settings.linkActionIconColumn || "").trim();
        if (!iconColumn || col.name !== iconColumn) {
            return;
        }

        const rule = this.findMatchingLinkRule(row);
        if (!rule) {
            return;
        }

        const url = this.resolveLinkActionUrl(rule, row);
        if (!url) {
            return;
        }

        const linkBtn = document.createElement("button");
        linkBtn.className = "skiba-link-icon";
        linkBtn.textContent = "\u2197"; // ↗ — reuses the same plain Unicode-glyph icon pattern as the gear/chevron/sort-arrow icons elsewhere in this file, no new icon font/library
        linkBtn.setAttribute("aria-label", "Open linked page");
        linkBtn.title = "Open linked page";
        linkBtn.addEventListener("click", (evt) => {
            evt.stopPropagation();
            this.host.launchUrl(url);
        });
        cell.appendChild(linkBtn);
    }

    /** Evaluates configured link-action rules top-to-bottom against a row's values; returns the first match, or null. */
    private findMatchingLinkRule(row: ITableRow): ILinkActionRule | null {
        const rules = this.settings.linkActionRules || [];
        for (let i = 0; i < rules.length; i++) {
            if (this.evaluateLinkActionRule(rules[i], row)) {
                return rules[i];
            }
        }
        return null;
    }

    private evaluateLinkActionRule(rule: ILinkActionRule, row: ITableRow): boolean {
        const raw = row.values[rule.column];
        if (raw === null || raw === undefined) {
            return false;
        }

        if (rule.operator === "equals") {
            return String(raw) === rule.value;
        }
        if (rule.operator === "notEquals") {
            return String(raw) !== rule.value;
        }
        if (rule.operator === "contains") {
            return String(raw).toLowerCase().indexOf(rule.value.toLowerCase()) !== -1;
        }

        // gt / gte / lt / lte — numeric comparison
        const numRaw = typeof raw === "number" ? raw : parseFloat(String(raw));
        const numRule = parseFloat(rule.value);
        if (isNaN(numRaw) || isNaN(numRule)) {
            return false;
        }
        switch (rule.operator) {
            case "gt": return numRaw > numRule;
            case "gte": return numRaw >= numRule;
            case "lt": return numRaw < numRule;
            case "lte": return numRaw <= numRule;
            default: return false;
        }
    }

    /**
     * Resolves `{ColumnName}` placeholders in a rule's urlTemplate against this
     * row's values, URL-encoding every substituted value. Returns null (never
     * throws) if the resolved string's scheme isn't exactly http:// or https://,
     * which is a hard mandatory safety check, not a best-effort one.
     */
    private resolveLinkActionUrl(rule: ILinkActionRule, row: ITableRow): string | null {
        const resolved = rule.urlTemplate.replace(/\{([^{}]+)\}/g, (_match, columnName: string) => {
            const v = row.values[columnName];
            const strVal = v === null || v === undefined ? "" : String(v);
            return encodeURIComponent(strVal);
        });

        if (!/^https:\/\//i.test(resolved) && !/^http:\/\//i.test(resolved)) {
            return null;
        }
        return resolved;
    }

    private columnStatsMax(columnName: string): number {
        if (this.columnMaxCache.has(columnName)) {
            return this.columnMaxCache.get(columnName)!;
        }
        let max = 0;
        this._data.forEach((r) => {
            const v = r.values[columnName];
            if (typeof v === "number") {
                max = Math.max(max, Math.abs(v));
            }
        });
        this.columnMaxCache.set(columnName, max);
        return max;
    }

    private renderTotalsRow(visibleColumns: ITableColumn[], rowHeight: number): HTMLDivElement {
        const rowEl = document.createElement("div");
        rowEl.className = "skiba-table__row skiba-table__row--totals";
        rowEl.style.height = `${rowHeight}px`;

        visibleColumns.forEach((col, idx) => {
            const cell = document.createElement("div");
            cell.className = "skiba-table__cell";
            cell.style.width = `${this.columnWidth(col)}px`;

            if (idx === 0) {
                cell.textContent = this.settings.totalsLabel;
            } else if (col.isMeasure) {
                const sum = d3.sum(this._filteredData, (r) => {
                    const v = r.values[col.name];
                    return typeof v === "number" ? v : 0;
                });
                cell.textContent = this.formatNumber(sum);
            }
            rowEl.appendChild(cell);
        });

        return rowEl;
    }

    private formatNumber(value: number): string {
        const governance = this.settings.exportGovernance;
        return formatLocaleNumber(value, governance?.locale, governance?.currency);
    }

    // -----------------------------------------------------------------
    // Smart tooltips (mean / deviation) — insight without extra UI
    // -----------------------------------------------------------------

    private computeColumnStats(): void {
        this._columnStats.clear();
        this._columnMinMax.clear();
        this.columnMaxCache.clear();
        this.columns.filter((c) => c.isMeasure).forEach((col) => {
            const values = this._data
                .map((r) => r.values[col.name])
                .filter((v): v is number => typeof v === "number");
            if (values.length === 0) {
                return;
            }
            const mean = d3.mean(values) ?? 0;
            const deviation = d3.deviation(values) ?? 0;
            this._columnStats.set(col.name, { mean, deviation });
            this._columnMinMax.set(col.name, { min: d3.min(values) ?? 0, max: d3.max(values) ?? 0 });
        });
    }

    /**
     * Native Tooltip Registration (item 19): smart mean/deviation tooltips for numeric
     * measure columns (unchanged), plus a simple value tooltip for Tooltip-role fields
     * (item 19's "Tooltips" data role) that aren't already covered above -- including
     * non-numeric ones, which the original implementation silently dropped.
     */
    private showRowTooltip(row: ITableRow, evt: MouseEvent): void {
        if (!this.tooltipService.enabled()) {
            return;
        }

        const items: VisualTooltipDataItem[] = [];
        const covered = new Set<string>();

        this.columns.filter((c) => c.isMeasure).forEach((col) => {
            const raw = row.values[col.name];
            if (typeof raw !== "number") {
                return;
            }
            covered.add(col.name);
            const stats = this._columnStats.get(col.name);
            let detail = this.formatNumber(raw);
            if (stats) {
                const variancePct = stats.mean !== 0 ? ((raw - stats.mean) / stats.mean) * 100 : 0;
                const sign = variancePct >= 0 ? "+" : "";
                const avgLabel = this.loc("Tooltip_Avg", "avg");
                const vsAvgLabel = this.loc("Tooltip_VsAvg", "vs avg");
                detail += ` (${avgLabel} ${this.formatNumber(stats.mean)}, ${sign}${variancePct.toFixed(1)}% ${vsAvgLabel}, \u03C3 ${this.formatNumber(stats.deviation)})`;
            }
            items.push({ displayName: col.displayName, value: detail });
        });

        // Tooltip-role fields: simple value tooltip, numeric or not, skipping any column
        // already covered by the smart numeric tooltip above to avoid duplicate lines.
        this.tooltipColumns.forEach((col) => {
            if (covered.has(col.name)) {
                return;
            }
            const raw = row.values[col.name];
            if (raw === null || raw === undefined) {
                return;
            }
            const value = typeof raw === "number" ? this.formatNumber(raw) : String(raw);
            items.push({ displayName: col.displayName, value });
        });

        if (items.length === 0) {
            return;
        }

        this.tooltipService.show({
            coordinates: [evt.clientX, evt.clientY],
            isTouchEvent: false,
            dataItems: items,
            identities: [row.selectionId]
        });
    }

    private moveTooltip(evt: MouseEvent): void {
        this.tooltipService.move({
            coordinates: [evt.clientX, evt.clientY],
            isTouchEvent: false,
            dataItems: [],
            identities: []
        });
    }

    private hideTooltip(): void {
        this.tooltipService.hide({ immediately: true, isTouchEvent: false });
    }

    // -----------------------------------------------------------------
    // Export
    // -----------------------------------------------------------------

    private exportCSV(): void {
        const visibleColumns = this.visibleColumns();
        const header = visibleColumns.map((c) => c.displayName);
        const rows: string[][] = this._filteredData.map((row) =>
            visibleColumns.map((col) => {
                const v = row.values[col.name];
                return v === null || v === undefined ? "" : String(v);
            })
        );
        const csv = d3.csvFormatRows([header, ...rows]);
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        this.downloadBlob(blob, "data-lake-tables-export.csv");
        recordExportAudit(createExportAuditEvent("csv", this.settings.exportGovernance?.username || "unknown", this._filteredData.length));
    }

    /** Real .xlsx export via SheetJS — requires `npm install xlsx --save` in the project. */
    private exportExcel(): void {
        const visibleColumns = this.visibleColumns();
        const header = visibleColumns.map((c) => c.displayName);
        const aoa: (string | number)[][] = [header];

        this._filteredData.forEach((row) => {
            aoa.push(visibleColumns.map((col) => {
                const v = row.values[col.name];
                if (v === null || v === undefined) {
                    return "";
                }
                return typeof v === "number" ? v : String(v);
            }));
        });

        const worksheet = XLSX.utils.aoa_to_sheet(aoa);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Data");
        const wbout: ArrayBuffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
        const blob = new Blob([wbout], { type: "application/octet-stream" });
        this.downloadBlob(blob, "data-lake-tables-export.xlsx");
        recordExportAudit(createExportAuditEvent("excel", this.settings.exportGovernance?.username || "unknown", this._filteredData.length));
    }

    /**
     * Dedicated multi-page PDF export via jsPDF + jspdf-autotable. Replaces the old
     * window.print()-based path entirely — one clear "Export PDF" behavior. Exports exactly
     * what's on screen: current search/sort/column-filter/grouping state, not the raw data.
     */
    private exportPDF(): void {
        const visibleColumns = this.visibleColumns();
        const head = [visibleColumns.map((c) => c.displayName)];
        const indent = (depth: number): string => "    ".repeat(depth);

        const bodyRows: string[][] = this._renderNodes.map((node) => {
            if (node.kind === "group") {
                const valueText = node.value === null || node.value === undefined ? "(blank)" : String(node.value);
                return visibleColumns.map((col, idx) => {
                    if (idx === 0) {
                        return `${indent(node.depth)}${node.column.displayName}: ${valueText} (${node.count})`;
                    }
                    if (col.isMeasure) {
                        const sum = node.sums.get(col.name);
                        return sum !== undefined ? this.formatNumber(sum) : "";
                    }
                    return "";
                });
            }
            return visibleColumns.map((col, idx) => {
                const raw = node.row.values[col.name];
                const text = raw === null || raw === undefined ? "" : String(raw);
                return idx === 0 ? `${indent(node.depth)}${text}` : text;
            });
        });

        let totalsRowIndex = -1;
        if (this.settings.showTotals) {
            totalsRowIndex = bodyRows.length;
            bodyRows.push(
                visibleColumns.map((col, idx) => {
                    if (idx === 0) {
                        return this.settings.totalsLabel;
                    }
                    if (col.isMeasure) {
                        const sum = d3.sum(this._filteredData, (r) => {
                            const v = r.values[col.name];
                            return typeof v === "number" ? v : 0;
                        });
                        return this.formatNumber(sum);
                    }
                    return "";
                })
            );
        }

        const doc = new jsPDF({
            orientation: visibleColumns.length > 6 ? "landscape" : "portrait",
            unit: "pt"
        });
        const exportDate = new Date().toLocaleString();
        const title = this.reportTitle;

        autoTable(doc, {
            head,
            body: bodyRows,
            startY: 56,
            margin: { top: 56 },
            styles: {
                font: "helvetica",
                fontSize: 8,
                textColor: this.settings.cellFont,
                fillColor: this.settings.cellBg,
                lineColor: "#e6e6e6",
                lineWidth: 0.5,
                cellPadding: 4
            },
            headStyles: {
                fillColor: this.settings.headerBg,
                textColor: this.settings.headerFont,
                fontStyle: this.settings.headerBold ? "bold" : "normal"
            },
            alternateRowStyles: {
                fillColor: this.settings.altRow
            },
            didParseCell: (data) => {
                // Match the on-screen totals row styling (bold + shaded), not just black-and-white text.
                if (totalsRowIndex >= 0 && data.section === "body" && data.row.index === totalsRowIndex) {
                    data.cell.styles.fontStyle = "bold";
                    data.cell.styles.fillColor = this.settings.totalsBg;
                }
            },
            didDrawPage: (data) => {
                const left = data.settings.margin.left;
                doc.setFontSize(12);
                doc.setTextColor("#333333");
                doc.text(title, left, 24);
                doc.setFontSize(8);
                doc.setTextColor("#888888");
                doc.text(`Exported ${exportDate}`, left, 38);
            },
            showHead: "everyPage"
        });

        const watermark = buildWatermarkText(this.settings.exportGovernance);
        if (watermark) {
            doc.setTextColor("#9CA3AF");
            doc.setFontSize(9);
            doc.text(watermark, doc.internal.pageSize.getWidth() / 2, doc.internal.pageSize.getHeight() - 18, { align: "center" });
        }
        recordExportAudit(createExportAuditEvent("pdf", this.settings.exportGovernance?.username || "unknown", this._filteredData.length));
        doc.save("data-lake-tables-export.pdf");
    }

    private downloadBlob(blob: Blob, filename: string): void {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    // -----------------------------------------------------------------
    // Empty state & landing page
    // -----------------------------------------------------------------

    /** Renders the calm SKIBA ANALYTICS placeholder for "fields assigned, zero rows returned". */
    public renderEmptyState(): void {
        this.clearElement(this.container);
        const wrap = document.createElement("div");
        wrap.className = "skiba-empty-state";

        const brand = document.createElement("div");
        brand.className = "skiba-empty-state__brand";
        brand.textContent = this.loc("EmptyState_Brand", "FFLEXAT");
        wrap.appendChild(brand);

        const tagline = document.createElement("div");
        tagline.className = "skiba-empty-state__tagline";
        tagline.textContent = this.loc("EmptyState_Tagline", "Next-Gen Analytical Tables");
        wrap.appendChild(tagline);

        const helper = document.createElement("div");
        helper.className = "skiba-empty-state__helper";
        helper.textContent = this.loc("EmptyState_Helper", "Add fields to Rows and Values to get started");
        wrap.appendChild(helper);

        this.container.appendChild(wrap);
    }

    /**
     * Landing / Welcome Page (item 15): shown only before any fields have ever been
     * assigned to the visual (distinct from renderEmptyState above). Reuses the existing
     * `.skiba-empty-state` branding classes rather than a second, inconsistent design, with
     * an added plain-language description of what Data Lake Tables does.
     */
    public renderLandingPage(): void {
        this.clearElement(this.container);
        const wrap = document.createElement("div");
        wrap.className = "skiba-empty-state skiba-landing-page";

        const brand = document.createElement("div");
        brand.className = "skiba-empty-state__brand";
        brand.textContent = this.loc("Landing_Brand", "FFLEXAT");
        wrap.appendChild(brand);

        const tagline = document.createElement("div");
        tagline.className = "skiba-empty-state__tagline";
        tagline.textContent = this.loc("Landing_Tagline", "Datalake intelligence for accountable decisions");
        wrap.appendChild(tagline);

        const description = document.createElement("div");
        description.className = "skiba-landing-page__description";
        description.textContent = this.loc(
            "Landing_Description",
            "The fastest, cleanest, most intuitive way to view, slice, and export your Power BI data \u2014 without enterprise bloat."
        );
        wrap.appendChild(description);

        const helper = document.createElement("div");
        helper.className = "skiba-empty-state__helper";
        helper.textContent = this.loc("Landing_Helper", "Add fields to Rows and Values to see your table.");
        wrap.appendChild(helper);

        this.container.appendChild(wrap);
    }
}

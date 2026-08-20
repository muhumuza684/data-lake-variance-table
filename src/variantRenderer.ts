import powerbi from "powerbi-visuals-api";

import DataViewTable = powerbi.DataViewTable;
import DataViewMetadataColumn = powerbi.DataViewMetadataColumn;

function cellValue(row: powerbi.DataViewTableRow, columns: DataViewMetadataColumn[], roleNames: string[]): unknown {
    for (let i = 0; i < columns.length; i += 1) {
        const roles = columns[i].roles || {};
        if (roleNames.some((role) => !!roles[role])) {
            return row[i];
        }
    }
    return undefined;
}

function formatValue(value: unknown): string {
    if (value === null || value === undefined || value === "") return "—";
    if (value instanceof Date) return value.toLocaleDateString();
    if (typeof value === "number") return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
    return String(value);
}

function clear(container: HTMLElement, className: string): HTMLDivElement {
    container.replaceChildren();
    const root = document.createElement("div");
    root.className = className;
    container.appendChild(root);
    return root;
}

export function renderHeatMap(container: HTMLElement, table: DataViewTable, columns: DataViewMetadataColumn[]): void {
    const root = clear(container, "dlt-variant dlt-hitmap");
    const heading = document.createElement("div");
    heading.className = "dlt-variant__heading";
    heading.textContent = "HITMAP";
    root.appendChild(heading);
    const grid = document.createElement("div");
    grid.className = "dlt-hitmap__grid";
    const values = (table.rows || []).map((row) => {
        const value = cellValue(row, columns, ["values", "value"]);
        return typeof value === "number" ? value : Number(value) || 0;
    });
    const min = Math.min(...values, 0);
    const max = Math.max(...values, 1);
    (table.rows || []).forEach((row, index) => {
        const label = document.createElement("div");
        label.className = "dlt-hitmap__label";
        label.textContent = formatValue(cellValue(row, columns, ["rows", "row", "category"]));
        const cell = document.createElement("div");
        cell.className = "dlt-hitmap__cell";
        const ratio = max === min ? 0.5 : (values[index] - min) / (max - min);
        cell.style.setProperty("--dlt-heat", String(Math.max(0, Math.min(1, ratio))));
        cell.textContent = formatValue(values[index]);
        cell.title = `${label.textContent}: ${cell.textContent}`;
        grid.append(label, cell);
    });
    root.appendChild(grid);
}

export function renderTimeline(container: HTMLElement, table: DataViewTable, columns: DataViewMetadataColumn[]): void {
    const root = clear(container, "dlt-variant dlt-ganti");
    const heading = document.createElement("div");
    heading.className = "dlt-variant__heading";
    heading.textContent = "GANTI";
    root.appendChild(heading);
    const timeline = document.createElement("div");
    timeline.className = "dlt-ganti__timeline";
    (table.rows || []).forEach((row) => {
        const task = document.createElement("div");
        task.className = "dlt-ganti__task";
        const label = document.createElement("div");
        label.className = "dlt-ganti__label";
        label.textContent = formatValue(cellValue(row, columns, ["task", "category", "rows", "row"]));
        const bar = document.createElement("div");
        bar.className = "dlt-ganti__bar";
        const start = new Date(String(cellValue(row, columns, ["startDate"])));
        const end = new Date(String(cellValue(row, columns, ["endDate"])));
        const progress = Number(cellValue(row, columns, ["percentComplete", "values"])) || 0;
        const span = Number.isFinite(start.getTime()) && Number.isFinite(end.getTime()) ? Math.max(1, end.getTime() - start.getTime()) : 1;
        bar.style.setProperty("--dlt-duration", `${Math.min(100, Math.max(8, span / 86400000))}%`);
        bar.style.setProperty("--dlt-progress", `${Math.min(100, Math.max(0, progress))}%`);
        bar.title = `${label.textContent}: ${formatValue(progress)}%`;
        task.append(label, bar);
        timeline.appendChild(task);
    });
    root.appendChild(timeline);
}

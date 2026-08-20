export type ExportKind = "csv" | "excel" | "pdf";
export type GovernmentCurrency = "UGX" | "USD" | "EUR" | "GBP" | "MWK";
export interface IExportGovernance { enabled: boolean; watermarkText: string; locale: string; currency: string; username: string; }
export interface IExportAuditEvent { kind: ExportKind; username: string; rowCount: number; timestamp: string; }

const localeFormatterCache = new Map<string, Intl.NumberFormat>();

export function formatLocaleNumber(value: number, locale = "en-UG", currency = ""): string {
    const key = `${locale}|${currency}`;
    let formatter = localeFormatterCache.get(key);
    if (!formatter) {
        formatter = new Intl.NumberFormat(locale, currency
            ? { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }
            : { minimumFractionDigits: 0, maximumFractionDigits: 2 });
        localeFormatterCache.set(key, formatter);
    }
    return formatter.format(value);
}

export function buildWatermarkText(governance?: Partial<IExportGovernance>): string {
    if (!governance || governance.enabled !== true) { return ""; }
    return String(governance.watermarkText || "CONFIDENTIAL").slice(0, 160);
}

export function createExportAuditEvent(kind: ExportKind, username: string, rowCount: number, now = new Date()): IExportAuditEvent {
    return { kind, username: username || "unknown", rowCount: Math.max(0, Math.floor(rowCount)), timestamp: now.toISOString() };
}

export function recordExportAudit(event: IExportAuditEvent): void {
    if (typeof console !== "undefined" && typeof console.info === "function") { console.info("[Skiba Tables export audit]", JSON.stringify(event)); }
}

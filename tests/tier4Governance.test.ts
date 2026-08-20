import { buildWatermarkText, createExportAuditEvent, formatLocaleNumber } from "../src/tier4Governance";
describe("Tier 4 export governance", () => {
    it("formats UGX values using locale and currency", () => { expect(formatLocaleNumber(1234567.5, "en-UG", "UGX")).toContain("1,234,567.50"); });
    it("builds a bounded optional watermark", () => { expect(buildWatermarkText({ enabled: false, watermarkText: "X" })).toBe(""); expect(buildWatermarkText({ enabled: true, watermarkText: "CONFIDENTIAL — URA" })).toBe("CONFIDENTIAL — URA"); });
    it("creates an auditable export event", () => { expect(createExportAuditEvent("pdf", "analyst@ura.example", 12, new Date("2026-01-01T00:00:00.000Z"))).toEqual({ kind: "pdf", username: "analyst@ura.example", rowCount: 12, timestamp: "2026-01-01T00:00:00.000Z" }); });
});

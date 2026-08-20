import { parseSavedViewState, DEFAULT_SAVED_VIEW_STATE } from "../src/savedViewState";

describe("saved-report compatibility matrix", () => {
    const fixtures: Array<[string, Record<string, unknown>]> = [
        ["pre-colorPreset save", {
            sortColumn: "revenue", sortDirection: "desc", columnOrder: ["region", "revenue"],
            columnWidths: { revenue: 120 }, hiddenColumns: [], searchTerm: "", groupExpansion: {}
        }],
        ["pre-Fetch-More-Data save", { sortColumn: "status", sortDirection: "asc", searchTerm: "flagged" }],
        ["current-version save", {
            sortColumn: "status", sortDirection: "asc", columnOrder: ["status", "id"],
            columnWidths: { status: 120 }, hiddenColumns: ["notes"], searchTerm: "flagged",
            groupExpansion: { "region/EU": true }
        }]
    ];

    test.each(fixtures)("%s parses without throwing", (_label, fixture) => {
        expect(() => parseSavedViewState(JSON.stringify(fixture))).not.toThrow();
        expect(parseSavedViewState(JSON.stringify(fixture))).not.toBeNull();
    });

    test("legacy fixtures receive parser defaults", () => {
        const result = parseSavedViewState(JSON.stringify({ sortColumn: "revenue" }));
        expect(result).toEqual({ ...DEFAULT_SAVED_VIEW_STATE, sortColumn: "revenue" });
    });
});
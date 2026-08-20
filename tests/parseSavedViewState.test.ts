// tests/parseSavedViewState.test.ts
//
// Regression coverage for backward-compatible saved-state parsing. Verifies that
// parseSavedViewState degrades gracefully when a persisted blob is missing fields
// that did not exist in an older version of the visual, rather than losing the
// whole saved view or throwing.

import { parseSavedViewState, DEFAULT_SAVED_VIEW_STATE } from "../src/savedViewState";

describe("parseSavedViewState - backward compatibility", () => {
    it("backfills missing fields with their defaults when parsing a legacy blob", () => {
        const legacyBlob = {
            sortColumn: "revenue",
            sortDirection: "desc"
            // columnOrder, columnWidths, hiddenColumns, searchTerm, groupExpansion
            // intentionally absent - these fields did not exist in older saved state.
        };

        const result = parseSavedViewState(JSON.stringify(legacyBlob));

        expect(result).not.toBeNull();
        expect(result!.sortColumn).toBe("revenue");
        expect(result!.sortDirection).toBe("desc");
        expect(result!.columnOrder).toEqual(DEFAULT_SAVED_VIEW_STATE.columnOrder);
        expect(result!.columnWidths).toEqual(DEFAULT_SAVED_VIEW_STATE.columnWidths);
        expect(result!.hiddenColumns).toEqual(DEFAULT_SAVED_VIEW_STATE.hiddenColumns);
        expect(result!.searchTerm).toBe(DEFAULT_SAVED_VIEW_STATE.searchTerm);
        expect(result!.groupExpansion).toEqual(DEFAULT_SAVED_VIEW_STATE.groupExpansion);
    });

    it("preserves every field when a current, complete blob is passed", () => {
        const currentBlob = {
            sortColumn: "status",
            sortDirection: "asc",
            columnOrder: ["status", "id"],
            columnWidths: { status: 120 },
            hiddenColumns: ["notes"],
            searchTerm: "flagged",
            groupExpansion: { "region/EU": true }
        };

        const result = parseSavedViewState(JSON.stringify(currentBlob));

        expect(result).toEqual(currentBlob);
    });

    it("returns null for malformed JSON rather than throwing", () => {
        expect(parseSavedViewState("{not valid json")).toBeNull();
    });

    it("returns null for an empty or non-object blob", () => {
        expect(parseSavedViewState("")).toBeNull();
        expect(parseSavedViewState("42")).toBeNull();
        expect(parseSavedViewState("null")).toBeNull();
    });
});

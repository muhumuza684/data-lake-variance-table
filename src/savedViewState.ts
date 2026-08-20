import { ISavedViewState } from "./tableRenderer";

/** Defaults applied to any ISavedViewState field missing from a persisted blob (e.g. one saved
 *  by an older version of the visual before that field existed), so a legacy saved view degrades
 *  gracefully instead of losing the whole state or crashing on a partial object. */
export const DEFAULT_SAVED_VIEW_STATE: ISavedViewState = {
    sortColumn: null,
    sortDirection: "none",
    columnOrder: [],
    columnWidths: {},
    hiddenColumns: [],
    searchTerm: "",
    groupExpansion: {}
};

/**
 * Parses a raw JSON saved-view-state blob (as persisted via host.persistProperties under the
 * `savedView.state` object property) into an ISavedViewState, backfilling any field missing
 * from the blob -- e.g. one written by an older version of the visual before that field existed
 * -- with its default from DEFAULT_SAVED_VIEW_STATE. Returns null (never throws) if the string
 * isn't valid JSON or doesn't parse to an object.
 */
export function parseSavedViewState(rawJson: string): ISavedViewState | null {
    if (typeof rawJson !== "string" || rawJson.trim().length === 0) {
        return null;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(rawJson);
    } catch {
        return null;
    }
    if (typeof parsed !== "object" || parsed === null) {
        return null;
    }
    return { ...DEFAULT_SAVED_VIEW_STATE, ...(parsed as Partial<ISavedViewState>) };
}

import { normalizeRenderingFailure } from "../src/renderDiagnostics";

describe("Tier 3 rendering diagnostics", () => {
    it.each([
        [new Error("invalid viewport dimensions"), "rendering"],
        [new Error("dataView data unavailable"), "data"],
        [new Error("formatting state unavailable"), "state"],
        [new Error("fetchMoreData failed"), "fetch"]
    ])("classifies %s", (error, kind) => {
        const result = normalizeRenderingFailure(error);
        expect(result.kind).toBe(kind);
        expect(result.reason).toBe(error.message);
    });

    it("always returns a non-empty reason for non-Error failures", () => {
        expect(normalizeRenderingFailure("unexpected failure")).toEqual({ kind: "unknown", reason: "unexpected failure" });
    });
});

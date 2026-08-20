import { parseCustomPalette, paletteEndpoints } from "../src/tier4Palette";
describe("approved custom palette behavior", () => {
  test("accepts CSV/JSON hex values, dedupes, and caps at twelve", () => {
    const values = parseCustomPalette('["#faf623", "#124e9b", "#FAF623"]');
    expect(values).toEqual(["#FAF623", "#124E9B"]);
    const many = parseCustomPalette(Array.from({length: 20}, (_, i) => `#${String(i).padStart(6, "0")}`).join(","));
    expect(many?.length).toBe(12);
  });
  test("rejects malformed or single-color palettes", () => {
    expect(parseCustomPalette("nope")).toBeNull();
    expect(parseCustomPalette("#FAF623")).toBeNull();
  });
  test("derives endpoints for live data bars", () => {
    expect(paletteEndpoints(["#FAF623", "#124E9B"])).toEqual(["#FAF623", "#124E9B"]);
  });
});

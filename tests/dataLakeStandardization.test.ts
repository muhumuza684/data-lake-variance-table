import fs from "fs";
import path from "path";

describe("FFLEXAT standardization", () => {
    const root = path.resolve(__dirname, "..");
    const renderer = fs.readFileSync(path.join(root, "src", "tableRenderer.ts"), "utf8");
    const styles = fs.readFileSync(path.join(root, "style", "visual.less"), "utf8");
    const pbiviz = JSON.parse(fs.readFileSync(path.join(root, "pbiviz.json"), "utf8"));

    test("uses the FFLEXAT identity", () => {
        expect(String(pbiviz.visual.name)).toBe("FFLEXAT");
        expect(String(pbiviz.visual.displayName)).toBe("FFLEXAT");
        expect(renderer).toContain("FFLEXAT");
    });

    test("provides the branded settings surface and scroll behavior", () => {
        expect(styles).toContain(".datalake-tables-settings-button");
        expect(styles).toContain(".datalake-tables-settings-menu");
        expect(styles).toContain("overflow-y: auto");
        expect(styles).toContain("--dlt-navy");
        expect(styles).toContain("--dlt-yellow");
    });

    test("exposes working layout controls and persistence hooks", () => {
        expect(renderer).toContain("renderDataLakeLayoutSection");
        expect(renderer).toContain("this.settings.fontSize");
        expect(renderer).toContain("this.settings.rowHeight");
        expect(renderer).toContain("this.persistUserConfig()");
    });
});
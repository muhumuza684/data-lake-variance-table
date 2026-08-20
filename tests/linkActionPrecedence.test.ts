/**
 * E2 target #1 from T3, real analog.
 *
 * See colorGradient.test.ts's header comment for the full flag: the code's
 * own "Item 9" is the conditional URL-action link-rule system
 * (findMatchingLinkRule / evaluateLinkActionRule / resolveLinkActionUrl), not
 * a color system. It DOES have exactly the shape T3 described: multiple rule
 * sources (an authored array of rules), evaluated against a row, with a
 * defined precedence order. That order, per the code, is: **top-to-bottom
 * array order, first match wins** (see findMatchingLinkRule's doc comment
 * and loop). This suite verifies that order against the real code rather
 * than assuming it.
 */
import { TableRenderer, ILinkActionRule } from "../src/tableRenderer";
import {
    makeFakeHost,
    makeFakeSelectionManager,
    makeFakeTooltipService,
    makeFakeLocalizationManager,
    makeFakeColorPalette
} from "./mocks/powerbiMocks";
import { col, row, makeSettings, linkRule } from "./mocks/fixtures";

function buildRenderer() {
    const container = document.createElement("div");
    const host = makeFakeHost();
    const renderer = new TableRenderer(
        container,
        host,
        makeFakeSelectionManager(),
        makeFakeTooltipService(),
        makeFakeLocalizationManager(),
        makeFakeColorPalette()
    );
    return { renderer, container, host };
}

const idCol = col("id", { isMeasure: false, isGroupBy: false });
const statusCol = col("status", { isMeasure: false, isGroupBy: false });
const scoreCol = col("score", { isMeasure: true });

function iconButtonForRow(container: HTMLElement, idValue: string): HTMLButtonElement | null {
    const cells = Array.from(container.querySelectorAll(".skiba-table__cell")) as HTMLElement[];
    const idCell = cells.find((c) => c.querySelector(".skiba-table__cell-text")?.textContent === idValue);
    return (idCell?.querySelector(".skiba-link-icon") as HTMLButtonElement) ?? null;
}

describe("link-action rule precedence (findMatchingLinkRule)", () => {
    it("applies the single rule when only one is configured and it matches", () => {
        const { renderer, container } = buildRenderer();
        const rules: ILinkActionRule[] = [linkRule({ column: "status", operator: "equals", value: "flagged", urlTemplate: "https://example.test/{id}" })];
        renderer.setData(
            [idCol, statusCol],
            [],
            [scoreCol],
            [],
            [row({ id: "R1", status: "flagged", score: 1 })],
            makeSettings({ linkActionRules: rules, linkActionIconColumn: "id" })
        );
        expect(iconButtonForRow(container, "R1")).not.toBeNull();
    });

    it("does not render the icon when no configured rule matches the row", () => {
        const { renderer, container } = buildRenderer();
        const rules: ILinkActionRule[] = [linkRule({ column: "status", operator: "equals", value: "flagged" })];
        renderer.setData(
            [idCol, statusCol],
            [],
            [scoreCol],
            [],
            [row({ id: "R1", status: "ok", score: 1 })],
            makeSettings({ linkActionRules: rules, linkActionIconColumn: "id" })
        );
        expect(iconButtonForRow(container, "R1")).toBeNull();
    });

    it("when multiple rules could match the same row, the FIRST rule in array order wins", () => {
        const { renderer, container, host } = buildRenderer();
        // Both rules match row R1 (score 100 is > 10 AND status is "flagged"). Array order
        // puts the "gt" rule first, so its urlTemplate should be the one that fires.
        const rules: ILinkActionRule[] = [
            linkRule({ column: "score", operator: "gt", value: "10", urlTemplate: "https://first.test/{id}" }),
            linkRule({ column: "status", operator: "equals", value: "flagged", urlTemplate: "https://second.test/{id}" })
        ];
        renderer.setData(
            [idCol, statusCol],
            [],
            [scoreCol],
            [],
            [row({ id: "R1", status: "flagged", score: 100 })],
            makeSettings({ linkActionRules: rules, linkActionIconColumn: "id" })
        );
        const btn = iconButtonForRow(container, "R1");
        expect(btn).not.toBeNull();
        btn!.click();
        expect(host.launchUrl).toHaveBeenCalledWith("https://first.test/R1");
        expect(host.launchUrl).not.toHaveBeenCalledWith("https://second.test/R1");
    });

    it("reversing the same two rules' array order flips which one wins (proves order, not rule content, decides precedence)", () => {
        const { renderer, container, host } = buildRenderer();
        const rules: ILinkActionRule[] = [
            linkRule({ column: "status", operator: "equals", value: "flagged", urlTemplate: "https://second.test/{id}" }),
            linkRule({ column: "score", operator: "gt", value: "10", urlTemplate: "https://first.test/{id}" })
        ];
        renderer.setData(
            [idCol, statusCol],
            [],
            [scoreCol],
            [],
            [row({ id: "R1", status: "flagged", score: 100 })],
            makeSettings({ linkActionRules: rules, linkActionIconColumn: "id" })
        );
        const btn = iconButtonForRow(container, "R1")!;
        btn.click();
        expect(host.launchUrl).toHaveBeenCalledWith("https://second.test/R1");
    });

    it("falls through a non-matching first rule to a matching second rule", () => {
        const { renderer, container, host } = buildRenderer();
        const rules: ILinkActionRule[] = [
            linkRule({ column: "status", operator: "equals", value: "not-this-value", urlTemplate: "https://first.test/{id}" }),
            linkRule({ column: "score", operator: "gte", value: "50", urlTemplate: "https://second.test/{id}" })
        ];
        renderer.setData(
            [idCol, statusCol],
            [],
            [scoreCol],
            [],
            [row({ id: "R1", status: "flagged", score: 100 })],
            makeSettings({ linkActionRules: rules, linkActionIconColumn: "id" })
        );
        const btn = iconButtonForRow(container, "R1")!;
        btn.click();
        expect(host.launchUrl).toHaveBeenCalledWith("https://second.test/R1");
    });

    it("refuses to resolve a URL whose scheme isn't exactly http/https (safety check in resolveLinkActionUrl)", () => {
        const { renderer, container, host } = buildRenderer();
        const rules: ILinkActionRule[] = [linkRule({ column: "status", operator: "equals", value: "flagged", urlTemplate: "javascript:alert({id})" })];
        renderer.setData(
            [idCol, statusCol],
            [],
            [scoreCol],
            [],
            [row({ id: "R1", status: "flagged", score: 1 })],
            makeSettings({ linkActionRules: rules, linkActionIconColumn: "id" })
        );
        // resolveLinkActionUrl returns null for a non-http(s) scheme, so appendLinkActionIcon
        // should bail out before creating the button at all.
        expect(iconButtonForRow(container, "R1")).toBeNull();
    });
});

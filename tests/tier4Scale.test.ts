import { formatLocaleNumber } from "../src/tier4Governance";
describe("Tier 4 government-scale utility budget", () => {
    it("formats 250,000 values within the utility budget", () => { const started = Date.now(); const values = Array.from({ length: 250000 }, (_, i) => formatLocaleNumber(i * 1.25, "en-UG", "UGX")); expect(values).toHaveLength(250000); expect(Date.now() - started).toBeLessThan(15000); });
});

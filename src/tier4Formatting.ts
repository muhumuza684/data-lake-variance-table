export type Tier4PaletteName = "default" | "deuteranopia" | "protanopia" | "brand";

export interface ITier4ConditionalRule {
    column: string;
    operator: "equals" | "contains" | "gt" | "gte" | "lt" | "lte";
    value: string;
    color: string;
}

export interface ITier4SavedTheme {
    name: string;
    palette: Tier4PaletteName;
    headerBg?: string;
    headerFont?: string;
    cellBg?: string;
    cellFont?: string;
    accent?: string;
}

export const TIER4_PALETTES: Record<Tier4PaletteName, string[]> = {
    default: ["#FDE2E2", "#2E7D32"],
    deuteranopia: ["#F4A582", "#0571B0"],
    protanopia: ["#FEE0B6", "#2166AC"],
    brand: ["#FAF623", "#124E9B"]
};

export function paletteColors(name: Tier4PaletteName): [string, string] {
    const p = TIER4_PALETTES[name] ?? TIER4_PALETTES.default;
    return [p[0], p[1]];
}

export function matchesTier4Rule(raw: unknown, rule: ITier4ConditionalRule): boolean {
    const text = raw === null || raw === undefined ? "" : String(raw);
    const lhs = Number(raw);
    const rhs = Number(rule.value);
    switch (rule.operator) {
        case "equals": return text === rule.value;
        case "contains": return text.toLowerCase().includes(rule.value.toLowerCase());
        case "gt": return Number.isFinite(lhs) && Number.isFinite(rhs) && lhs > rhs;
        case "gte": return Number.isFinite(lhs) && Number.isFinite(rhs) && lhs >= rhs;
        case "lt": return Number.isFinite(lhs) && Number.isFinite(rhs) && lhs < rhs;
        case "lte": return Number.isFinite(lhs) && Number.isFinite(rhs) && lhs <= rhs;
    }
}

export function colorForTier4Value(raw: unknown, rules: ITier4ConditionalRule[]): string | null {
    const rule = rules.find((candidate) => matchesTier4Rule(raw, candidate));
    return rule ? rule.color : null;
}

export function safeTier4Theme(raw: unknown): ITier4SavedTheme | null {
    if (!raw || typeof raw !== "object") return null;
    const value = raw as Partial<ITier4SavedTheme>;
    if (typeof value.name !== "string" || !value.name.trim()) return null;
    const palette = value.palette === "deuteranopia" || value.palette === "protanopia" || value.palette === "brand" ? value.palette : "default";
    return { name: value.name.slice(0, 80), palette, headerBg: value.headerBg, headerFont: value.headerFont, cellBg: value.cellBg, cellFont: value.cellFont, accent: value.accent };
}

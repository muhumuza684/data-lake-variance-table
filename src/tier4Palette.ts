export function parseCustomPalette(raw: string): string[] | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    let values: unknown = trimmed;
    try { if (trimmed.startsWith("[")) values = JSON.parse(trimmed); } catch { return null; }
    const list = Array.isArray(values) ? values : String(values).split(/[;,\s]+/);
    const colors = list.map((v) => String(v).trim().toUpperCase()).filter((v) => /^#[0-9A-F]{6}$/.test(v));
    const unique = Array.from(new Set(colors)).slice(0, 12);
    return unique.length >= 2 ? unique : null;
}
export function paletteEndpoints(colors: string[]): [string, string] {
    return [colors[0] ?? "#FAF623", colors[colors.length - 1] ?? "#124E9B"];
}

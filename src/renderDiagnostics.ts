export type RenderingFailureKind = "data" | "rendering" | "state" | "fetch" | "unknown";

export interface IRenderingFailure { kind: RenderingFailureKind; reason: string; }

export function normalizeRenderingFailure(error: unknown): IRenderingFailure {
    const reason = error instanceof Error ? error.message : String(error);
    const lower = reason.toLowerCase();
    const kind: RenderingFailureKind = lower.includes("fetch") ? "fetch" : lower.includes("data") || lower.includes("dataview") ? "data" : lower.includes("state") || lower.includes("format") || lower.includes("persist") ? "state" : lower.includes("render") || lower.includes("viewport") ? "rendering" : "unknown";
    return { kind, reason: reason || "Unknown rendering failure" };
}

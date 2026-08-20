"use strict";

/**
 * Module D (Item 34) — Mobile Support.
 *
 * Width, in pixels, at or below which the visual should apply its compact/mobile
 * layout. Derived from Microsoft's own mobile-layout guidance ("Best practices for
 * creating mobile-optimized Power BI reports"): 323 points is the documented maximum
 * screen width a visual gets on the phone layout canvas. We round up slightly (340px)
 * to cover visuals sized a little above that documented maximum, while still safely
 * excluding normal desktop-canvas widths.
 */
export const MOBILE_BREAKPOINT_PX = 340;

/**
 * Pure, side-effect-free check for "is this visual currently narrow enough that it
 * should render its compact/mobile layout." Deliberately takes the *visual's own*
 * viewport width (options.viewport.width from update()), not window.innerWidth —
 * see the note next to resizeViewport() in visual.ts for why a CSS @media query
 * alone isn't reliable in this host: the container's pixel size is set directly
 * from inline styles derived from options.viewport, which doesn't necessarily match
 * the surrounding browser/webview window's size.
 */
export function isNarrowViewport(width: number, breakpoint: number = MOBILE_BREAKPOINT_PX): boolean {
    return width > 0 && width <= breakpoint;
}

/**
 * Item 1 (base rendering): given columns in their current display order and each
 * one's rendered pixel width, returns the largest leading subset that fits within
 * `availableWidth` — always keeping at least the first column, even if it alone
 * overflows, since dropping every column would be worse than one being tight.
 *
 * "Priority" here means "current display order" (the same order the user already
 * controls via drag-to-reorder) rather than any new ranking concept — this reuses
 * an ordering the user already owns instead of inventing a separate one.
 *
 * Pure and side-effect free so it can be unit tested without any DOM or Power BI host.
 */
export function selectColumnsForWidth<T>(
    columns: T[],
    widthOf: (col: T) => number,
    availableWidth: number
): T[] {
    if (columns.length === 0) {
        return [];
    }
    const result: T[] = [columns[0]];
    let used = widthOf(columns[0]);
    for (let i = 1; i < columns.length; i++) {
        const w = widthOf(columns[i]);
        if (used + w > availableWidth) {
            break;
        }
        result.push(columns[i]);
        used += w;
    }
    return result;
}
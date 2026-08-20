// jsdom doesn't implement layout, so anything TableRenderer reads off getBoundingClientRect /
// clientHeight etc. for virtual-scroll math returns 0. That's fine for the tests in this suite —
// none of them assert on scroll math — but a couple of code paths call ResizeObserver, which jsdom
// doesn't implement at all and will throw ReferenceError on construction. Stub it out.
if (typeof (globalThis as any).ResizeObserver === "undefined") {
    (globalThis as any).ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
    };
}

// Same story for matchMedia, which some Power BI host utilities probe for on load.
if (typeof window !== "undefined" && !window.matchMedia) {
    (window as any).matchMedia = () => ({
        matches: false,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false
    });
}

// jspdf probes HTMLCanvasElement.getContext() at import time to detect browser-canvas
// support (see node_modules/jspdf/src/libs/png.js). jsdom implements the element but not
// a real 2D context, so this logs a benign "not implemented" console.error on every test
// file that imports tableRenderer.ts (which imports jspdf for the PDF export feature).
// It doesn't affect any assertion -- stub a no-op context so the probe succeeds quietly
// instead of spamming CI logs.
if (typeof HTMLCanvasElement !== "undefined") {
    // @ts-ignore -- deliberately loose stub, not a full CanvasRenderingContext2D
    HTMLCanvasElement.prototype.getContext = () => null;
}

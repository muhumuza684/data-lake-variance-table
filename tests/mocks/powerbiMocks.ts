/**
 * TableRenderer's constructor takes five live Power BI host services
 * (IVisualHost, ISelectionManager, ITooltipService, ILocalizationManager,
 * ISandboxExtendedColorPalette) that only exist inside the real Power BI
 * runtime. None of E2's target logic (color resolution, setData/segment
 * handling) calls into most of their methods, so these are deliberately
 * thin — just enough surface area that construction and setData() don't
 * throw. Extend individual methods here if a future test needs one that
 * currently just no-ops.
 */

export function makeFakeSelectionId(id: string) {
    return {
        equals: (other: any) => other && other.__id === id,
        getKey: () => id,
        includes: () => false,
        getSelector: () => ({}),
        hasIdentity: () => true,
        __id: id
    };
}

export function makeFakeHost(): any {
    return {
        createSelectionIdBuilder: () => ({
            withCategory: function () { return this; },
            withMeasure: function () { return this; },
            withTable: function () { return this; },
            createSelectionId: () => makeFakeSelectionId("fake")
        }),
        persistProperties: jest.fn(),
        launchUrl: jest.fn(),
        hostCapabilities: { allowInteractions: true },
        colorPalette: {
            getColor: (key: string) => ({ value: "#000000" })
        },
        tooltipService: { enabled: () => false },
        eventService: { renderingStarted: jest.fn(), renderingFinished: jest.fn(), renderingFailed: jest.fn() }
    };
}

export function makeFakeSelectionManager(): any {
    return {
        select: jest.fn().mockResolvedValue([]),
        clear: jest.fn().mockResolvedValue(undefined),
        hasSelection: () => false,
        getSelectionIds: (): any[] => [],
        registerOnSelectCallback: jest.fn(),
        applySelectionFilter: jest.fn()
    };
}

export function makeFakeTooltipService(): any {
    return {
        show: jest.fn(),
        move: jest.fn(),
        hide: jest.fn(),
        enabled: () => false
    };
}

export function makeFakeLocalizationManager(): any {
    // Returns the key itself (unresolved) so TableRenderer.loc() falls back to
    // the fallback string it's called with -- matches real behavior for an
    // untranslated/dev-server locale (see the loc() doc comment in tableRenderer.ts).
    return {
        getDisplayName: (key: string) => key
    };
}

export function makeFakeColorPalette(): any {
    return {
        getColor: (key: string) => ({ value: "#888888" }),
        isHighContrast: false,
        background: { value: "#ffffff" },
        foreground: { value: "#000000" }
    };
}

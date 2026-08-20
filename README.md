# FFLEXAT

FFLEXAT — governed comparison tables for actual, plan, forecast, and variance analysis.

## Current platform status

This project inherits the sanitized Data Lake Tables platform for packaging, settings persistence, accessibility, diagnostics, export governance, localization, and regression testing.

**Implementation focus:** Comparison table foundation; visual-specific variance renderer is the next implementation layer.

This is an independent implementation. It does not include proprietary source code, logos, assets, identifiers, or branding from reference visuals.

## Data contract

- `category` — Category (Grouping)
- `group` — Group (Grouping)
- `values` — Values (Measure)
- `previous` — Previous (Measure)
- `plan` — Plan (Measure)
- `forecast` — Forecast (Measure)
- `tooltips` — Tooltips (Grouping)

# Tier 3 regression re-check

Run:

npx jest --runInBand
npx tsc --noEmit -p .
npx pbiviz package

Keyboard navigation: inspect the existing keyboard-navigation suite and confirm Enter/Space activation, tab order, and focus behavior remain green.

Segment accumulation: inspect 	ests/setDataSegments.test.ts and confirm cumulative rows remain stable after later features.

Search honesty: confirm a search term initially reports loaded-row matches and exposes an explicit Search Full Dataset action only when more data is available; confirm the localized progress state appears while the force-fetch is active.

Rendering diagnostics: record any malformed-data case that does not produce a meaningful rendering failure reason as a separate follow-up finding; do not silently patch the mobile exclusion zone.
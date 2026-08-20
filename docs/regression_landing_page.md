# Landing-page permanent regression protocol

1. Open the saved report in Power BI Desktop and confirm the visual is present.
2. Close Power BI Desktop completely, reopen the report, and confirm the visual renders after the report reloads.
3. Remove the visual, save, close, reopen, reimport the .pbiviz, and confirm the visual renders again.
4. Rebind the row and value fields. Confirm the landing page appears only before fields have ever been assigned, not when a filtered query returns zero rows.
5. Start Performance Analyzer, refresh the report, wait 10–15 seconds, and confirm that a rendered table is not replaced by the landing page during trailing update/reconciliation calls.
6. Repeat with a saved view from before colorPreset, before Fetch More Data, and from the current version.

Automated companion: run the existing visual lifecycle and parser suites plus the new saved-report matrix. The full malformed VisualUpdateOptions diagnostics harness remains a follow-up if the current test mocks do not expose the private update path safely.

Do not perform the excluded mobile Performance Analyzer validation or the excluded 48-step item 42 flow until the separate mobile fix lands.
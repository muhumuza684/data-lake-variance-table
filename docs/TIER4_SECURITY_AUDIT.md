# Security audit worksheet

Run npm audit and save the JSON result before making dependency changes. Do not use npm audit fix --force without reviewing major-version impact.

Audit these input surfaces: search term, column filter values, calculated-column formulas, saved-view names, link-action rules, export watermark text, and any new toolbar popover values.

Require textContent/createElement rather than innerHTML for DOM labels. Require URL encoding at link construction. Treat formula parsing as a safe grammar, not eval or new Function. Confirm saved state is JSON-validated and bounded before persistence.
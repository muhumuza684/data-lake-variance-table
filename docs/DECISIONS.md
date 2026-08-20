# D1 Decision — No-export versus Fetch More Data

The no-export permission does not block Fetch More Data. It continues to block CSV, Excel, and PDF export. The read-only permission remains a separate policy and continues to block Fetch More Data under the current product rule.

Export restriction and in-visual loading are separate controls: a viewer may inspect the complete dataset without creating an extracted artifact. This is client-side visual policy, not DRM; dataset-level Row-Level Security remains the security boundary.

Search covers loaded rows by default and offers an explicit Search Full Dataset action. Uganda Revenue Authority is a representative government/enterprise customer example, not the exclusive target. Malawi/MWK formatting is out of scope.

The source/test alignment for D1 is intentionally deferred because the active branch contains uncommitted changes in the source files. Apply it only after those changes are committed or stashed.
# Tier 4 compatibility and security research

## Verified Microsoft sources

- Fetch More Data: https://learn.microsoft.com/en-us/power-bi/developer/visuals/fetch-more-data
- Visuals API changelog: https://learn.microsoft.com/en-us/power-bi/developer/visuals/changelog
- Report Server changelog: https://learn.microsoft.com/en-us/power-bi/report-server/changelog
- Sensitivity labels in Power BI: https://learn.microsoft.com/en-us/fabric/enterprise/powerbi/service-security-sensitivity-label-overview

## Conclusions

Microsoft documents Fetch More Data for loading chunks beyond the 30K-row data view limit and supports aggregate-all-chunks and incremental loading. The project must retain cumulative segment behavior and test the explicit fetchMoreData contract.

The visuals API changelog maps API versions to Desktop releases, but the Report Server changelog does not identify the npm powerbi-visuals-api version hosted by the current Report Server line. Do not claim compatibility until the target Report Server build and its custom-visual API matrix are confirmed.

Purview labels are applied by Power BI to reports, semantic models, dashboards, dataflows, and supported export paths. No custom-visual capabilities.json hook for independently applying or reading a Purview label was identified in the Microsoft documentation. The visual must not claim to enforce labels independently; rely on Power BI supported exports and tenant policy.

Malawi/MWK is explicitly out of scope for this deployment. Uganda Revenue Authority is representative only, not the exclusive target.
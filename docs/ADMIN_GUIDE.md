# Skiba Tables Administrator Guide

Bind and govern the Permissions measure according to the report’s security model. Treat the visual’s permission checks as UI policy, not DRM; use dataset Row-Level Security for data protection.

Keep the visual package and the Power BI host release aligned. Before deployment to Report Server, verify the target Server build’s custom-visual API support and run the package in a staging report with Import and DirectQuery models.

For government and enterprise deployments, define an approved watermark policy, export audit retention policy, locale policy, and sensitivity-label policy at the report/tenant level. The visual must not invent a backend audit server or independently implement Purview encryption.
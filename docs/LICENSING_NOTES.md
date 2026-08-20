# Licensing & Permission Gating — Plain-Language Notes

**Audience:** anyone who talks to customers about this product — sales,
account management, support — not just engineers.

## The one-sentence version

Permission and tier gating in Skiba Tables (export restrictions, read-only
mode, and premium-feature gating) is **client-configurable, not
tamper-proof**. Never describe it to a customer — especially a government or
enterprise customer with strict security requirements — as DRM, encryption,
or a security control.

## What it actually does

Skiba Tables has an optional "Permissions" field well. A report author can
bind it to a DAX measure that looks up the current viewer (typically via
`USERPRINCIPALNAME()` or `USERNAME()` against a permissions table) and
returns a text value such as:

- `"no-export"` — hides the Export CSV / Export All buttons and disables
  "Fetch More Data"
- `"read-only"` — the above, plus disables column resizing
- `"no-premium"` — disables Link Actions (clickable URL rules) and
  Conditional Formatting (the color scale)

> **ASSUMED — confirm with product owner.** `"no-premium"` and the two
> features it gates (Link Actions, Conditional Formatting) are this
> engineering session's best guess at what "tier/license gating" should mean
> for Item 26, made without a product owner available to ask synchronously.
> There was no existing spec for which values or features to use. See
> `src/tierGating.ts` for the full reasoning. Do not treat this as a
> confirmed product decision until someone signs off on it — it's flagged
> here specifically so this doc doesn't quietly overstate what's actually
> decided.

If the Permissions field is left unbound, everyone gets full functionality.
This is opt-in, not a default security posture.

## Why it is not tamper-proof

Power BI custom visuals run **entirely client-side**, inside the report
consumer's browser or the Power BI Desktop/mobile app. The visual has no
server component and no way to independently verify who is really looking at
the report. Concretely:

- Anyone with **report-editing access** can remove or rebind the Permissions
  measure, or delete the visual and re-add it without the binding.
- Anyone with **model-editing access** can edit the underlying DAX measure to
  always return a permissive value (or no value at all).
- The check itself runs in JavaScript on the viewer's own machine — someone
  with enough technical access to the report or model can bypass it. This is
  true of essentially all client-side UI restrictions in any Power BI
  visual; it isn't a defect specific to this one.

In short: this feature controls what buttons and features **appear** in the
visual for people who aren't trying to get around it. It does not, and
cannot, stop someone with edit access to the report or model from disabling
it. It's a UI/workflow convenience, not a security boundary.

## What this means for the underlying data

None of this restricts access to the underlying dataset. A viewer who can't
export from this visual can often still reach the same rows through Power
BI's other built-in export/analyze features, other visuals on the same
report, or the semantic model directly — depending on their platform
permissions. If a customer's actual requirement is "user X must never see or
export row-level data Y," the correct tool is **Row-Level Security (RLS)**
at the model level, not this visual's Permissions field.

## What NOT to tell a customer

Do not say or imply any of the following:

- "This encrypts or protects the data" — it doesn't; it only changes what
  the visual's own UI shows.
- "This is tamper-proof" or "this can't be bypassed" — it can be, by anyone
  with report- or model-editing access.
- "This meets [government/enterprise] security requirements" on its own —
  it doesn't. Pair it with RLS and platform-level governance if that's the
  actual requirement.

## What IS reasonable to tell a customer

- "This lets a report author show or hide export/premium-feature controls
  per viewer, driven by a DAX measure they control."
- "It's a good fit for reducing accidental misuse — e.g., hiding an export
  button so casual viewers don't think they're meant to export — not for
  protecting sensitive data from a determined or technically privileged
  user."
- "For real per-user data protection, combine this with Row-Level Security."

## Where this is implemented (for engineers)

- `capabilities.json` — the "Permissions" data role and its recognized
  values.
- `src/visual.ts` — `resolvePermission()` reads the resolved value once per
  viewer.
- `src/tierGating.ts` — `resolveTierRestrictions()` (Item 26, ASSUMED)
  derives premium-feature gating from that same value.
- `src/tableRenderer.ts` — `isExportRestricted()` is the existing
  enforcement point for export / Fetch More Data gating (D1/D2).

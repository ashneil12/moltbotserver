# Fork Invariants

These are the behaviors that define this fork. Any upstream intake must preserve them.

## Managed Platform

- Managed-platform deployments must not use upstream self-update flows directly.
- Platform-controlled updates should remain authoritative for managed instances.
- Managed platform callers that are intentionally trusted should keep their scoped exemptions.

## MoltBot Override Seams

- MoltBot-only behavior should live in explicit seams where possible.
- Prefer `src/moltbot-overrides/*` over scattering fork logic through upstream-owned files.
- When an upstream change touches fork behavior, prefer redirecting through an override seam.

## Search / Browser / Infra Customizations

- Browser-container and CDP-related customizations must remain functional.
- Fork-owned search/runtime behavior should not be silently removed by upstream adoption.
- Sidecar and deployment assumptions used by the managed platform must remain intact.

## Fork Process

- No default stash-and-rebase workflow.
- No blind upstream syncs.
- Upstream changes are reviewed selectively and adopted intentionally.

## Operational Rule

If an upstream change would violate one of these invariants:

- do not cherry-pick it directly
- re-implement the intent locally instead, or skip it

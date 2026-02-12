---
title: "Credit System"
summary: "Credits vs BYOK routing, pricing, and storage"
read_when:
  - Explaining credits, BYOK, or gateway routing in the dashboard
  - Debugging credit deductions or balance issues
---

# Credit system

This document describes how the dashboard handles billing and routing for MoltBot instances. Credits mode routes requests through Vercel AI Gateway, while BYOK mode sends requests directly to providers.

## Modes

### Credits mode

- Requests are routed through Vercel AI Gateway in `dashboard/src/app/api/gateway/chat/route.ts`.
- Balances are checked before routing.

### BYOK mode

- Requests call provider APIs directly using the user's stored API keys.
- Costs are billed by the provider.

## Credit deduction

- Costs are calculated in `dashboard/src/lib/pricing.ts`.
- Per-model prices are defined in cents per 1M tokens and `MARKUP_PERCENTAGE` applies a 10% markup.
- `deductCredits` in `dashboard/src/lib/billing.ts` calls the `deduct_credits` RPC in `dashboard/supabase/migrations/function_deduct_credits.sql`, which updates balances and logs usage.

## Database schema

The authoritative column list is defined in the Supabase types in `dashboard/src/lib/supabase.ts`.

`user_balances`
- `user_id` (uuid)
- `balance_cents`
- `total_topped_up_cents`
- `total_spent_cents`
- `billing_mode` (`credits` or `byok`)
- `created_at`
- `updated_at`

`usage_transactions`
- `id`
- `user_id`
- `type` (`topup` or `usage`)
- `amount_cents`
- `provider`
- `model`
- `input_tokens`
- `output_tokens`
- `stripe_session_id`
- `instance_id`
- `created_at`

## Env vars

### Supabase (required for balances and usage logging)

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

### Stripe (required for credit top-ups)

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `NEXT_PUBLIC_APP_URL`

### Vercel AI Gateway auth (credits mode routing)

- Production uses Vercel OIDC for `@ai-sdk/gateway`.
- Local dev: set `VERCEL_TOKEN` or run `vercel dev` so gateway requests can authenticate.

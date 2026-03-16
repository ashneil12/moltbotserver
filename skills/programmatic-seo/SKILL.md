---
name: programmatic-seo
description: Generate high-quality, data-driven SEO pages at scale using templates and structured data. Use when the user mentions "programmatic SEO," "template pages," "page generation at scale," "SEO landing pages," or wants to automate creation of location/service/product pages.
metadata: { "openclaw": { "emoji": "🔍" } }
---

# Programmatic SEO v2

Generate reproducible, high-quality SEO pages at scale using templates and data.

## When to use

- User wants to create SEO-driven pages at scale
- Location + service combination pages (e.g., "plumber in Austin")
- Product comparisons, integrations, or alternative pages
- Glossaries, directories, or data-driven landing pages
- Any request mentioning "programmatic SEO" or "template pages"

## Anti-patterns (reject these)

- **Thin pages**: Only a swapped city name with identical body copy
- **Doorway pages**: Auto-generated pages with no unique value, designed only to funnel traffic
- **Duplicate content**: Pages that share > 40% of their content with siblings
- **Keyword stuffing**: Overloading pages with target terms at the expense of readability

## Good candidates

| Type                | Example                                                             |
| ------------------- | ------------------------------------------------------------------- |
| Local service pages | `[service] in [city]` with local data (reviews, pricing, providers) |
| Comparison pages    | `[product A] vs [product B]` with feature tables, pricing, ratings  |
| Integration pages   | `[tool] + [tool]` with setup guides, use cases                      |
| Glossary/directory  | Industry terms or business listings with unique descriptions        |
| Alternative pages   | `[product] alternatives` with genuine comparison data               |

## Workflow

### Phase 1: Data Collection

1. **Enumerate variables** — identify all combinations (locations × services, products × categories, etc.)
2. **Validate unique data** — each page MUST have ≥ 3 unique data points (local stats, reviews, pricing, etc.)
3. **Source data** — pull from APIs, databases, CSV/JSON files, or web scraping
4. **Quality gate** — discard combinations that can't meet the uniqueness threshold

```
Example data structure:
{
  "city": "Austin",
  "service": "plumbing",
  "avg_cost": "$150-$300",
  "top_providers": ["AquaFix", "PipePros"],
  "local_reviews": 847,
  "avg_rating": 4.6,
  "population": 978908
}
```

### Phase 2: Template Design

1. **Create modular sections** — each section should be independently useful
2. **Dynamic introductions** — never use the same opening paragraph across pages
3. **Schema markup** — add structured data (LocalBusiness, Product, FAQ, etc.)
4. **Internal linking** — build hub/child/sibling link architecture

Template structure:

```
├── Hero (dynamic title + city-specific intro)
├── Key Stats (unique data points)
├── Provider List (local data)
├── Pricing Table (market-specific)
├── FAQ Section (mix of universal + local questions)
├── Related Pages (sibling + parent links)
└── Breadcrumbs (hub → category → page)
```

### Phase 3: Quality Thresholds

Every generated page MUST pass these checks before publishing:

| Metric                       | Minimum                       |
| ---------------------------- | ----------------------------- |
| Unique words                 | ≥ 500                         |
| Unique data points per page  | ≥ 3                           |
| Shared content with siblings | ≤ 40%                         |
| Schema markup                | Required                      |
| Internal links               | ≥ 3 (hub + sibling + related) |
| Meta title                   | Unique, ≤ 60 chars            |
| Meta description             | Unique, ≤ 155 chars           |
| H1                           | Exactly 1, unique             |

Pages that fail any threshold → flag for manual review or `noindex`.

### Phase 4: Internal Linking Architecture

```
Hub Page (e.g., "Plumbing Services")
├── Child Pages (e.g., "Plumber in Austin", "Plumber in Dallas")
│   ├── Sibling Links (Austin ↔ Dallas ↔ Houston)
│   └── Related Links (e.g., "HVAC in Austin")
└── Breadcrumbs: Home > Services > Plumbing > Austin
```

Rules:

- Every child links back to its hub
- Every child links to ≥ 2 siblings
- Breadcrumbs on every page
- No orphan pages (every page reachable from hub in ≤ 3 clicks)

### Phase 5: Indexing & Monitoring

1. **Generate XML sitemap** — include all pages, set `lastmod` and `changefreq`
2. **Batch submission** — submit sitemap to Search Console, don't submit all URLs at once
3. **Noindex thin pages** — any page below quality thresholds gets `<meta name="robots" content="noindex">`
4. **Monitor via Search Console** — track indexing status, click-through rates, and impressions
5. **Prune underperformers** — after 90 days, noindex or consolidate pages with zero impressions

## Implementation checklist

```
[ ] Define variable combinations (locations, services, products, etc.)
[ ] Source unique data for each combination
[ ] Build modular page template with schema markup
[ ] Generate pages with quality threshold validation
[ ] Implement internal linking (hub/child/sibling/breadcrumbs)
[ ] Generate XML sitemap
[ ] Submit to Search Console in batches
[ ] Set up monitoring for indexing and performance
[ ] Schedule 90-day prune review
```

## Notes

- **Credit**: Adapted from the `programmatic-seo` ClawHub skill by [@alirezarezvani](https://clawhub.ai/alirezarezvani/programmatic-seo)
- Start with a small batch (10-20 pages) to validate the template before scaling
- Always prefer real, sourced data over AI-generated filler
- Update pages when source data changes — stale data erodes trust and rankings
- Consider A/B testing different template structures on a subset before full rollout

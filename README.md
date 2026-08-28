# Texas Business Worth

A conversion-focused Texas private-business valuation funnel built for outbound email traffic.

## Architecture

- **Cloudflare Worker + Static Assets** — frontend and API deploy as one unit.
- **Cloudflare D1** — sessions, valuation results, benchmark versions, campaign attribution and seller leads.
- **Server-side valuation engine** — benchmark multiples and adjustment logic never rely on client-supplied calculations.
- **Cloudflare Rate Limiting** — separate estimate and lead-submission limits.
- **Cloudflare Turnstile** — optional on the seller contact form; server-side validation is implemented.
- **Generic benchmark ingestion** — weekly scheduled import from a licensed/custom JSON feed when configured.
- **CRM webhook** — optional server-side seller-lead delivery.

Cloudflare recommends Workers Static Assets for new full-stack Worker applications. This package uses a Worker-first `/api/*` route and serves `/public` as static assets.

## 1. Create the D1 database

```bash
npm install
npx wrangler d1 create texas-business-worth
```

Copy the returned database ID into `wrangler.jsonc` in place of:

```text
REPLACE_WITH_D1_DATABASE_ID
```

## 2. Apply database migrations

Local development:

```bash
npm run db:local
```

Production:

```bash
npm run db:remote
```

The seed migration gives the calculator a working baseline. **Those seed values are modeling defaults and should not be represented as licensed transaction comps.** Replace/supersede them with licensed data before making strong claims about comp depth.

## 3. Run locally

```bash
npm run dev
```

## 4. Turnstile (recommended for production)

Create a Turnstile widget for your production hostname.

Set the public site key in `wrangler.jsonc`:

```json
"TURNSTILE_SITE_KEY": "your_public_site_key"
```

Store the secret only as a Worker secret:

```bash
npx wrangler secret put TURNSTILE_SECRET_KEY
```

If `TURNSTILE_SECRET_KEY` is not configured, lead submission works without Turnstile for local/staging use.

## 5. CRM webhook (optional)

```bash
npx wrangler secret put CRM_WEBHOOK_URL
npx wrangler secret put CRM_WEBHOOK_SECRET
```

On a completed seller lead, the Worker posts a JSON event to `CRM_WEBHOOK_URL`. This can point to a CRM, Make, Zapier, n8n or your own endpoint.

## 6. Licensed benchmark/API feed

The scheduled Worker supports a generic JSON benchmark feed. Configure:

```bash
npx wrangler secret put BENCHMARK_FEED_URL
npx wrangler secret put BENCHMARK_FEED_TOKEN
```

The Worker refreshes the feed weekly (Monday 08:15 UTC). You can also trigger it manually through `/api/admin/refresh-benchmarks` after setting:

```bash
npx wrangler secret put ADMIN_IMPORT_KEY
```

Expected feed format:

```json
{
  "benchmarks": [
    {
      "sector": "home_services",
      "label": "Residential HVAC",
      "geography": "austin",
      "naics": "238220",
      "revenue_min": 1000000,
      "revenue_max": 5000000,
      "earnings_min": 150000,
      "earnings_max": 1200000,
      "sde_low": 3.1,
      "sde_high": 4.0,
      "ebitda_low": 4.2,
      "ebitda_high": 5.5,
      "revenue_low": 0.6,
      "revenue_high": 0.95,
      "source_name": "Licensed Provider Name",
      "source_url": "https://provider.example",
      "sample_size": 47,
      "effective_date": "2026-Q2"
    }
  ]
}
```

Supported geography values: `texas`, `austin`, `san_antonio`, `houston`, `dfw`, `texas_other`.


### Benchmark selection logic

The Worker supports exact NAICS and company-size ranges. When several rows match, it hierarchically blends them: exact NAICS + metro receives the highest weight, then exact NAICS + Texas, then sector + metro, then sector + Texas. Sample size controls how much a local row can influence the estimate, so a tiny metro sample shrinks toward broader Texas data instead of becoming the entire valuation.

### Recommended production data hierarchy

1. Same-industry private transaction data.
2. Texas same-industry transactions.
3. Texas Triangle / metro transactions where sample size is sufficient.
4. Similar-size transactions.
5. Local industry financial benchmarks (margins, payroll, revenue per employee, growth).
6. BLS/Census/Texas public datasets as context/risk inputs rather than direct sale comps.

Do not force a metro-specific multiple from a tiny local sample. A production model should shrink thin local samples toward the broader Texas/national industry distribution.

## 7. Outbound email campaign links

Create one campaign and random token per business. Example SQL:

```sql
INSERT INTO campaigns (id, name, source)
VALUES ('campaign-2026-09-hvac-austin', 'Austin HVAC Sept 2026', 'cold_email');

INSERT INTO campaign_links
(public_token, campaign_id, company_name, industry_label, sector, naics, metro)
VALUES
('7f05f9f0-USE-A-RANDOM-TOKEN', 'campaign-2026-09-hvac-austin',
 'Example HVAC Co', 'Residential HVAC contractor', 'home_services', '238220', 'austin');
```

Email link:

```text
https://yourdomain.com/?t=7f05f9f0-USE-A-RANDOM-TOKEN
```

Do **not** put the owner's email, phone or financial data in the URL.


### Batch-create email valuation links

A helper is included for outbound campaigns:

```bash
python scripts/make_campaign_links.py examples/prospects.csv campaign-2026-09-hvac-austin https://yourdomain.com
```

It outputs a CSV containing one random valuation URL per company and a SQL file you can import into D1.

## 8. Deploy

```bash
npm run deploy
```

For GitHub auto-deploy, connect the repository to Cloudflare and use the deploy command `npm run deploy`. Store secrets in Cloudflare, not GitHub source files.

## Funnel behavior

1. Landing page promises a confidential Texas-adjusted estimate.
2. No contact information is required.
3. Four initial questions produce a valuation range.
4. Five optional refinement questions tighten the result and create a buyer-attractiveness/value-gap report.
5. Only after value is delivered does the site ask whether the owner would consider selling in the estimated range.
6. `Yes` or `Possibly` reveals the contact form.
7. `Not right now` ends without collecting contact information.

## Analytics events stored in D1

- `valuation_started`
- `initial_valuation_shown`
- `refinement_started`
- `refinement_completed`
- `selling_intent_yes`
- `selling_intent_maybe`
- `selling_intent_not_now`
- `contact_started`
- `contact_completed`

## Before production

- Replace or validate seed benchmark assumptions with licensed / defensible data.
- Have an M&A/valuation professional review model weights and disclosures.
- Have counsel finalize privacy policy, consent language and outbound email compliance.
- Add the actual operating entity and contact details to legal pages.
- Configure Turnstile and test server-side validation.
- Configure CRM webhook and verify failed-delivery monitoring.
- Add backup/retention/deletion procedures for D1 lead records.

import { calculateValuation, getBenchmark, inferNaics } from './valuation.js';
import { refreshBenchmarks } from './importer.js';

const ALLOWED_METROS = new Set(['austin','san_antonio','houston','dfw','texas_other']);
const ALLOWED_SECTORS = new Set(['home_services','construction','professional','healthcare','manufacturing','distribution','retail','software','hospitality','other']);
const ALLOWED_GROWTH = new Set(['declining_major','declining_minor','flat','grow_1_10','grow_10_20','grow_20_plus']);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith('/api/')) {
      const assetResponse = await env.ASSETS.fetch(request);
      return withSecurityHeaders(assetResponse);
    }

    try {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: apiHeaders() });

      if (url.pathname === '/api/health' && request.method === 'GET') {
        return json({ ok: true, modelVersion: env.MODEL_VERSION || 'TBW-1.0' });
      }

      if (url.pathname === '/api/config' && request.method === 'GET') {
        return json({
          turnstileSiteKey: env.TURNSTILE_SITE_KEY || '',
          modelVersion: env.MODEL_VERSION || 'TBW-1.0',
          benchmarkVersion: env.BENCHMARK_VERSION || 'seed'
        });
      }

      if (url.pathname === '/api/session' && request.method === 'POST') {
        const body = await readJson(request, 8000);
        const sessionId = crypto.randomUUID();
        const campaign = await resolveCampaign(env, body.campaignToken);
        await env.DB.prepare(`
          INSERT INTO valuation_sessions
          (id, campaign_id, landing_path, referrer, user_agent, metro, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `).bind(
          sessionId,
          campaign?.campaign_id || null,
          safeText(body.landingPath, 300),
          safeText(request.headers.get('referer'), 500),
          safeText(request.headers.get('user-agent'), 500),
          null
        ).run();
        await recordEvent(env, sessionId, 'valuation_started', { campaign: campaign?.campaign_id || null });
        return json({ sessionId, prefill: campaign?.prefill || null });
      }

      if (url.pathname === '/api/estimate' && request.method === 'POST') {
        const body = await readJson(request, 20000);
        validateEstimate(body);
        await rateLimit(env.ESTIMATE_RATE_LIMITER, body.sessionId, 'estimate');
        await assertSession(env, body.sessionId);

        const resolvedNaics = safeText(body.naics, 12) || inferNaics(body.industryLabel, body.sector);
        const benchmark = await getBenchmark(env, body.sector, body.metro, resolvedNaics, body.revenue, body.earnings);
        const normalizedBody = { ...body, naics: resolvedNaics };
        const result = calculateValuation(normalizedBody, benchmark);
        const id = crypto.randomUUID();

        await env.DB.prepare(`
          INSERT INTO valuation_results
          (id, session_id, model_version, benchmark_version, sector, industry_label, naics,
           metro, revenue, earnings, earnings_type, growth, refined, inputs_json,
           benchmark_json, result_json, value_low, value_high, multiple_low, multiple_high,
           created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `).bind(
          id,
          body.sessionId,
          env.MODEL_VERSION || 'TBW-1.0',
          env.BENCHMARK_VERSION || 'seed',
          body.sector,
          safeText(body.industryLabel, 160),
          resolvedNaics,
          body.metro,
          Number(body.revenue),
          Number(body.earnings),
          body.earningsType,
          body.growth,
          body.refined ? 1 : 0,
          JSON.stringify(redactEstimateInput(normalizedBody)),
          JSON.stringify(benchmark),
          JSON.stringify(result),
          result.range.low,
          result.range.high,
          result.multiple.low,
          result.multiple.high
        ).run();

        await env.DB.prepare(`
          UPDATE valuation_sessions SET metro=?, updated_at=CURRENT_TIMESTAMP WHERE id=?
        `).bind(body.metro, body.sessionId).run();

        await recordEvent(env, body.sessionId, body.refined ? 'refinement_completed' : 'initial_valuation_shown', {
          valuationId: id,
          low: result.range.low,
          high: result.range.high
        });

        return json({
          valuationId: id,
          ...result,
          benchmark: {
            label: benchmark.label,
            geography: benchmark.geography,
            sourceName: benchmark.source_name,
            sampleSize: benchmark.sample_size,
            effectiveDate: benchmark.effective_date
          }
        });
      }

      if (url.pathname === '/api/event' && request.method === 'POST') {
        const body = await readJson(request, 5000);
        await assertSession(env, body.sessionId);
        const allowed = new Set(['refinement_started','selling_intent_yes','selling_intent_maybe','selling_intent_not_now','contact_started']);
        if (!allowed.has(body.event)) throw httpError(400, 'Invalid event');
        await recordEvent(env, body.sessionId, body.event, body.meta || {});
        return json({ ok: true });
      }

      if (url.pathname === '/api/lead' && request.method === 'POST') {
        const body = await readJson(request, 12000);
        validateLead(body);
        await rateLimit(env.LEAD_RATE_LIMITER, body.sessionId, 'lead');
        await assertSession(env, body.sessionId);
        await verifyTurnstile(request, env, body.turnstileToken);

        const leadId = crypto.randomUUID();
        const valuation = await env.DB.prepare(`
          SELECT id, value_low, value_high, sector, metro, revenue, earnings, earnings_type
          FROM valuation_results
          WHERE session_id=? ORDER BY created_at DESC LIMIT 1
        `).bind(body.sessionId).first();

        const score = leadScore(body, valuation);
        await env.DB.prepare(`
          INSERT INTO seller_leads
          (id, session_id, valuation_id, full_name, email, phone, preferred_contact,
           selling_intent, sale_timing, lead_score, consent_text, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `).bind(
          leadId,
          body.sessionId,
          valuation?.id || null,
          safeText(body.fullName, 120),
          normalizeEmail(body.email),
          normalizePhone(body.phone),
          body.preferredContact,
          body.sellingIntent,
          body.saleTiming,
          score,
          'User requested a confidential conversation about a potential business sale.'
        ).run();

        await recordEvent(env, body.sessionId, 'contact_completed', { leadId, score });

        if (env.CRM_WEBHOOK_URL) {
          ctx.waitUntil(sendToCrm(env, {
            event: 'seller_lead.created',
            lead: {
              id: leadId,
              name: safeText(body.fullName, 120),
              email: normalizeEmail(body.email),
              phone: normalizePhone(body.phone),
              preferredContact: body.preferredContact,
              sellingIntent: body.sellingIntent,
              saleTiming: body.saleTiming,
              leadScore: score
            },
            valuation: valuation || null
          }));
        }

        return json({ ok: true, leadId });
      }

      if (url.pathname === '/api/admin/refresh-benchmarks' && request.method === 'POST') {
        const provided = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
        if (!env.ADMIN_IMPORT_KEY || !timingSafeEqual(provided, env.ADMIN_IMPORT_KEY)) throw httpError(401, 'Unauthorized');
        const result = await refreshBenchmarks(env);
        return json(result);
      }

      return json({ error: 'Not found' }, 404);
    } catch (error) {
      const status = Number(error?.status) || 500;
      if (status >= 500) console.error(error);
      return json({ error: status >= 500 ? 'Something went wrong.' : error.message }, status);
    }
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(refreshBenchmarks(env).catch(async (error) => {
      console.error('Benchmark refresh failed', error);
      if (env.DB) {
        await env.DB.prepare(`INSERT INTO data_refresh_log (source_name, status, rows_imported, detail) VALUES (?, 'error', 0, ?)`)
          .bind('BENCHMARK_FEED_URL', String(error.message || error).slice(0, 800)).run();
      }
    }));
  }
};

async function readJson(request, maxBytes) {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > maxBytes) throw httpError(413, 'Request too large');
  let body;
  try { body = await request.json(); } catch { throw httpError(400, 'Invalid JSON'); }
  return body || {};
}

function validateEstimate(body) {
  if (!isUuid(body.sessionId)) throw httpError(400, 'Invalid session');
  if (!ALLOWED_SECTORS.has(body.sector)) throw httpError(400, 'Select a valid industry');
  if (!ALLOWED_METROS.has(body.metro)) throw httpError(400, 'Select a valid Texas market');
  if (!ALLOWED_GROWTH.has(body.growth)) throw httpError(400, 'Select a valid revenue trend');
  if (!['sde','ebitda'].includes(body.earningsType)) throw httpError(400, 'Select SDE or EBITDA');
  const revenue = Number(body.revenue);
  const earnings = Number(body.earnings);
  if (!Number.isFinite(revenue) || revenue < 50000 || revenue > 500000000) throw httpError(400, 'Revenue is outside the supported range');
  if (!Number.isFinite(earnings) || earnings < 10000 || earnings > 100000000) throw httpError(400, 'Earnings are outside the supported range');
  if (earnings > revenue * 1.5) throw httpError(400, 'Please check the revenue and earnings entered');
  if (body.refined) {
    const required = ['recurring','customerConcentration','ownerDependence','management','yearsOperating'];
    if (required.some(k => body[k] === undefined || body[k] === null || body[k] === '')) throw httpError(400, 'Complete the refinement questions');
  }
}

function validateLead(body) {
  if (!isUuid(body.sessionId)) throw httpError(400, 'Invalid session');
  if (!['yes','maybe'].includes(body.sellingIntent)) throw httpError(400, 'Selling intent is required');
  if (!['now','within_6','6_12','1_3','exploring'].includes(body.saleTiming)) throw httpError(400, 'Select a timeline');
  if (!['phone','text','email'].includes(body.preferredContact)) throw httpError(400, 'Select a preferred contact method');
  if (!safeText(body.fullName, 120) || safeText(body.fullName, 120).length < 2) throw httpError(400, 'Enter your name');
  if (!/^\S+@\S+\.\S+$/.test(normalizeEmail(body.email))) throw httpError(400, 'Enter a valid email');
  if (body.preferredContact !== 'email' && normalizePhone(body.phone).replace(/\D/g,'').length < 10) throw httpError(400, 'Enter a valid phone number');
}

async function assertSession(env, sessionId) {
  const row = await env.DB.prepare('SELECT id FROM valuation_sessions WHERE id=? LIMIT 1').bind(sessionId).first();
  if (!row) throw httpError(404, 'Session expired. Please restart the valuation.');
}

async function resolveCampaign(env, token) {
  if (!token || typeof token !== 'string' || token.length > 160) return null;
  const row = await env.DB.prepare(`
    SELECT cl.campaign_id, cl.company_name, cl.industry_label, cl.sector, cl.naics, cl.metro
    FROM campaign_links cl
    JOIN campaigns c ON c.id = cl.campaign_id
    WHERE cl.public_token=? AND cl.active=1 AND c.active=1
    LIMIT 1
  `).bind(token).first();
  if (!row) return null;
  await env.DB.prepare('UPDATE campaign_links SET clicks=clicks+1, last_clicked_at=CURRENT_TIMESTAMP WHERE public_token=?').bind(token).run();
  return {
    campaign_id: row.campaign_id,
    prefill: {
      companyName: row.company_name || '',
      industryLabel: row.industry_label || '',
      sector: row.sector || '',
      naics: row.naics || '',
      metro: row.metro || ''
    }
  };
}

async function recordEvent(env, sessionId, eventName, meta = {}) {
  if (!env.DB) return;
  await env.DB.prepare(`INSERT INTO analytics_events (session_id, event_name, meta_json, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)`)
    .bind(sessionId, safeText(eventName, 80), JSON.stringify(meta).slice(0, 4000)).run();
}

async function rateLimit(binding, sessionId, bucket) {
  if (!binding?.limit) return;
  const result = await binding.limit({ key: `${bucket}:${sessionId}` });
  if (!result.success) throw httpError(429, 'Too many requests. Please try again shortly.');
}

async function verifyTurnstile(request, env, token) {
  if (!env.TURNSTILE_SECRET_KEY) return;
  if (!token) throw httpError(400, 'Please complete the security check');
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET_KEY);
  form.append('response', token);
  const ip = request.headers.get('CF-Connecting-IP');
  if (ip) form.append('remoteip', ip);
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
  const result = await response.json();
  if (!result.success) throw httpError(400, 'Security check failed. Please try again.');
}

async function sendToCrm(env, payload) {
  const headers = { 'content-type': 'application/json' };
  if (env.CRM_WEBHOOK_SECRET) headers['authorization'] = `Bearer ${env.CRM_WEBHOOK_SECRET}`;
  const response = await fetch(env.CRM_WEBHOOK_URL, { method: 'POST', headers, body: JSON.stringify(payload) });
  if (!response.ok) throw new Error(`CRM webhook returned ${response.status}`);
}

function leadScore(body, valuation) {
  let score = 40;
  if (body.sellingIntent === 'yes') score += 20;
  if (body.saleTiming === 'now') score += 20;
  else if (body.saleTiming === 'within_6') score += 16;
  else if (body.saleTiming === '6_12') score += 10;
  else if (body.saleTiming === '1_3') score += 4;
  if (valuation?.value_high >= 1000000) score += 8;
  if (valuation?.value_high >= 3000000) score += 6;
  return Math.min(100, score);
}

function redactEstimateInput(body) {
  const { sessionId, ...rest } = body;
  return rest;
}

function normalizeEmail(v) { return String(v || '').trim().toLowerCase().slice(0, 254); }
function normalizePhone(v) { return String(v || '').trim().replace(/[^\d+() .-]/g, '').slice(0, 30); }
function safeText(v, max) { return v == null ? '' : String(v).trim().slice(0, max); }
function isUuid(v) { return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v || '')); }
function httpError(status, message) { const e = new Error(message); e.status = status; return e; }
function timingSafeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function apiHeaders() {
  return {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin'
  };
}
function json(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: apiHeaders() }); }
function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set('x-content-type-options', 'nosniff');
  headers.set('x-frame-options', 'DENY');
  headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  headers.set('cross-origin-opener-policy', 'same-origin');
  headers.set('content-security-policy', "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://challenges.cloudflare.com; font-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

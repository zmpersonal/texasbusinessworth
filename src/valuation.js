const METRO_ADJUSTMENTS = {
  austin: { label: 'Austin–Round Rock', pct: 0.03 },
  dfw: { label: 'Dallas–Fort Worth', pct: 0.05 },
  houston: { label: 'Houston', pct: -0.01 },
  san_antonio: { label: 'San Antonio', pct: 0.0 },
  texas_other: { label: 'Elsewhere in Texas', pct: 0.0 }
};

const FALLBACK_BENCHMARKS = {
  home_services: { label: 'Home & Trade Services', sde_low: 2.7, sde_high: 3.7, ebitda_low: 3.8, ebitda_high: 5.2, rev_low: 0.55, rev_high: 0.9 },
  construction: { label: 'Construction & Specialty Contracting', sde_low: 2.5, sde_high: 3.5, ebitda_low: 3.7, ebitda_high: 5.0, rev_low: 0.4, rev_high: 0.75 },
  professional: { label: 'Professional Services', sde_low: 2.8, sde_high: 4.0, ebitda_low: 4.0, ebitda_high: 5.8, rev_low: 0.7, rev_high: 1.2 },
  healthcare: { label: 'Healthcare Services', sde_low: 2.9, sde_high: 4.2, ebitda_low: 4.2, ebitda_high: 6.1, rev_low: 0.7, rev_high: 1.25 },
  manufacturing: { label: 'Manufacturing', sde_low: 2.7, sde_high: 3.9, ebitda_low: 4.1, ebitda_high: 5.8, rev_low: 0.55, rev_high: 1.0 },
  distribution: { label: 'Distribution & Wholesale', sde_low: 2.4, sde_high: 3.4, ebitda_low: 3.6, ebitda_high: 5.0, rev_low: 0.35, rev_high: 0.7 },
  retail: { label: 'Retail', sde_low: 2.0, sde_high: 3.0, ebitda_low: 3.0, ebitda_high: 4.3, rev_low: 0.25, rev_high: 0.55 },
  software: { label: 'Software & IT Services', sde_low: 3.1, sde_high: 4.7, ebitda_low: 4.8, ebitda_high: 7.5, rev_low: 0.9, rev_high: 1.8 },
  hospitality: { label: 'Hospitality & Food Service', sde_low: 2.0, sde_high: 3.0, ebitda_low: 3.1, ebitda_high: 4.5, rev_low: 0.3, rev_high: 0.65 },
  other: { label: 'Other Privately Held Business', sde_low: 2.4, sde_high: 3.5, ebitda_low: 3.7, ebitda_high: 5.2, rev_low: 0.45, rev_high: 0.85 }
};

export async function getBenchmark(env, sector, metro, naics = '', revenue = 0, earnings = 0) {
  const fallback = { ...(FALLBACK_BENCHMARKS[sector] || FALLBACK_BENCHMARKS.other), source_name: 'TBW seed benchmark', geography: 'texas', sample_size: null, effective_date: '2026-Q3', naics: null };
  if (!env.DB) return fallback;

  try {
    const result = await env.DB.prepare(`
      SELECT sector, label, naics, geography, revenue_min, revenue_max, earnings_min, earnings_max,
             sde_low, sde_high, ebitda_low, ebitda_high,
             revenue_low AS rev_low, revenue_high AS rev_high, source_name,
             source_url, sample_size, effective_date
      FROM valuation_benchmarks
      WHERE (sector = ? OR sector = 'other')
        AND geography IN (?, 'texas')
        AND (naics = '' OR naics = ?)
        AND ? >= revenue_min
        AND ? <= revenue_max
        AND ? >= earnings_min
        AND ? <= earnings_max
      ORDER BY effective_date DESC
      LIMIT 30
    `).bind(sector, metro, naics || '', Number(revenue), Number(revenue), Number(earnings), Number(earnings)).all();

    const rows = result?.results || [];
    if (!rows.length) return fallback;

    // Hierarchical blending: exact local comps matter most when sample size supports them.
    // Thin metro samples shrink toward broader Texas / sector data.
    const scored = rows.map(row => {
      const exactNaics = !!naics && row.naics === naics;
      const local = row.geography === metro;
      let hierarchy = exactNaics && local ? 5 : exactNaics ? 3.6 : local ? 2.2 : 1.2;
      const sample = Number(row.sample_size);
      const sampleReliability = Number.isFinite(sample) && sample > 0 ? Math.min(1, Math.sqrt(sample / 40)) : 0.45;
      const sizeSpecific = Number(row.revenue_min) > 0 || Number(row.revenue_max) < 1000000000000000 || Number(row.earnings_min) > 0 || Number(row.earnings_max) < 1000000000000000;
      if (sizeSpecific) hierarchy *= 1.15;
      return { row, weight: hierarchy * sampleReliability };
    });

    const totalWeight = scored.reduce((sum, x) => sum + x.weight, 0) || 1;
    const fields = ['sde_low','sde_high','ebitda_low','ebitda_high','rev_low','rev_high'];
    const blended = { ...fallback };
    for (const field of fields) {
      blended[field] = scored.reduce((sum, x) => sum + Number(x.row[field]) * x.weight, 0) / totalWeight;
    }
    blended.label = scored[0].row.label || fallback.label;
    blended.geography = scored.some(x => x.row.geography === metro) ? metro : 'texas';
    blended.source_name = `Blended: ${[...new Set(scored.map(x => x.row.source_name))].slice(0,3).join(' + ')}`;
    blended.sample_size = scored.reduce((sum, x) => sum + (Number(x.row.sample_size) || 0), 0) || null;
    blended.effective_date = scored.map(x => x.row.effective_date).sort().reverse()[0] || fallback.effective_date;
    blended.naics = naics || null;
    blended.component_count = scored.length;
    return blended;
  } catch (_) {
    return fallback;
  }
}

export function inferNaics(label = '', sector = '') {
  const s = String(label).toLowerCase();
  const rules = [
    [/hvac|heating|air conditioning|air-conditioning/, '238220'],
    [/plumb/, '238220'],
    [/roof/, '238160'],
    [/electric(al|ian)?/, '238210'],
    [/landscap|lawn care/, '561730'],
    [/pest|extermin/, '561710'],
    [/tree (service|trimm|care)|arbor/, '561730'],
    [/janitor|commercial clean/, '561720'],
    [/residential clean|house clean|maid/, '561720'],
    [/general contractor|home builder|residential construction/, '236115'],
    [/account|bookkeep|cpa/, '541211'],
    [/marketing|advertising agency/, '541810'],
    [/management consult/, '541611'],
    [/law firm|legal service|attorney/, '541110'],
    [/software|saas|computer system|it service|managed service provider|\bmsp\b/, '541512'],
    [/dental|dentist/, '621210'],
    [/physician|medical practice|doctor/, '621111'],
    [/home health/, '621610'],
    [/restaurant|food service/, '722511'],
    [/machine shop|machining/, '332710'],
    [/fabricat/, '332999'],
    [/wholesale|distribut/, '423990'],
    [/ecommerce|e-commerce|online retail/, '454110']
  ];
  for (const [re, code] of rules) if (re.test(s)) return code;
  return sector === 'home_services' ? '' : '';
}
export function calculateValuation(input, benchmark) {
  const revenue = clampMoney(input.revenue);
  const earnings = clampMoney(input.earnings);
  const earningsType = input.earningsType === 'ebitda' ? 'ebitda' : 'sde';
  const metro = METRO_ADJUSTMENTS[input.metro] || METRO_ADJUSTMENTS.texas_other;

  let baseLow = Number(benchmark[`${earningsType}_low`]);
  let baseHigh = Number(benchmark[`${earningsType}_high`]);

  const adjustments = [];
  let multipleAdj = 0;

  const sizeAdj = getSizeAdjustment(earnings, earningsType);
  if (sizeAdj !== 0) {
    multipleAdj += sizeAdj;
    adjustments.push(driver('Earnings scale', sizeAdj, sizeAdj > 0 ? 'Larger earnings base can broaden the buyer pool.' : 'Smaller earnings bases typically trade at lower multiples.'));
  }

  const growthAdj = growthAdjustment(input.growth);
  if (growthAdj !== 0) {
    multipleAdj += growthAdj;
    adjustments.push(driver('Revenue trend', growthAdj, growthCopy(input.growth)));
  }

  if (input.refined) {
    const recurringAdj = recurringAdjustment(input.recurring);
    multipleAdj += recurringAdj;
    adjustments.push(driver('Recurring / repeat revenue', recurringAdj, recurringCopy(input.recurring)));

    const concentrationAdj = concentrationAdjustment(input.customerConcentration);
    multipleAdj += concentrationAdj;
    adjustments.push(driver('Customer concentration', concentrationAdj, concentrationCopy(input.customerConcentration)));

    const ownerAdj = ownerDependenceAdjustment(input.ownerDependence);
    multipleAdj += ownerAdj;
    adjustments.push(driver('Owner dependence', ownerAdj, ownerCopy(input.ownerDependence)));

    const managementAdj = managementAdjustment(input.management);
    multipleAdj += managementAdj;
    adjustments.push(driver('Management depth', managementAdj, managementCopy(input.management)));

    const yearsAdj = yearsAdjustment(Number(input.yearsOperating || 0));
    if (yearsAdj !== 0) {
      multipleAdj += yearsAdj;
      adjustments.push(driver('Operating history', yearsAdj, yearsAdj > 0 ? 'Long operating history can reduce perceived execution risk.' : 'A short operating history can increase buyer uncertainty.'));
    }
  }

  // Limit additive adjustment so a short questionnaire cannot create extreme multiples.
  multipleAdj = Math.max(-0.9, Math.min(1.05, multipleAdj));
  const adjustedLow = Math.max(1.2, baseLow + multipleAdj);
  const adjustedHigh = Math.max(adjustedLow + 0.35, baseHigh + multipleAdj);

  const earningsValueLow = earnings * adjustedLow;
  const earningsValueHigh = earnings * adjustedHigh;

  const revenueLow = Number(benchmark.rev_low ?? benchmark.revenue_low ?? 0.45);
  const revenueHigh = Number(benchmark.rev_high ?? benchmark.revenue_high ?? 0.85);
  const revenueValueLow = revenue * revenueLow;
  const revenueValueHigh = revenue * revenueHigh;

  // Earnings method is primary. Revenue is a sanity check, not an equal-weight model.
  let low = earningsValueLow * 0.85 + revenueValueLow * 0.15;
  let high = earningsValueHigh * 0.85 + revenueValueHigh * 0.15;

  low *= 1 + metro.pct;
  high *= 1 + metro.pct;

  if (high < low) [low, high] = [high, low];
  const midpoint = (low + high) / 2;
  const mostLikelyLow = midpoint - (high - low) * 0.18;
  const mostLikelyHigh = midpoint + (high - low) * 0.18;

  const confidence = input.refined ? 86 : 66;
  const score = input.refined ? buyerScore(input) : null;
  const gap = input.refined ? valueGap(input, benchmark, adjustedHigh, revenueValueHigh, metro.pct, high) : null;

  const positives = adjustments.filter(a => a.delta > 0.001).sort((a,b) => b.delta - a.delta).slice(0, 3);
  const negatives = adjustments.filter(a => a.delta < -0.001).sort((a,b) => a.delta - b.delta).slice(0, 3);

  return {
    range: { low: roundValue(low), high: roundValue(high) },
    mostLikely: { low: roundValue(mostLikelyLow), high: roundValue(mostLikelyHigh) },
    midpoint: roundValue(midpoint),
    multiple: { low: roundMultiple(adjustedLow), high: roundMultiple(adjustedHigh), type: earningsType.toUpperCase() },
    metro: { ...metro },
    confidence,
    buyerScore: score,
    valueGap: gap,
    positives,
    negatives,
    modelInputs: {
      baseMultipleLow: baseLow,
      baseMultipleHigh: baseHigh,
      totalMultipleAdjustment: roundMultiple(multipleAdj),
      metroAdjustmentPct: metro.pct,
      earningsWeight: 0.85,
      revenueWeight: 0.15
    }
  };
}

function valueGap(input, benchmark, currentHighMultiple, revenueValueHigh, metroPct, currentHighValue) {
  let potentialMultiple = currentHighMultiple;
  const opportunities = [];

  if (['essential', 'high'].includes(input.ownerDependence)) {
    potentialMultiple += 0.35;
    opportunities.push({ title: 'Reduce owner dependence', detail: 'Build management coverage and document key operating processes.' });
  }
  if (['none', 'low'].includes(input.recurring)) {
    potentialMultiple += 0.25;
    opportunities.push({ title: 'Increase recurring revenue', detail: 'Maintenance agreements, subscriptions or repeat-service programs can improve revenue visibility.' });
  }
  if (['over_50', '25_50'].includes(input.customerConcentration)) {
    potentialMultiple += 0.30;
    opportunities.push({ title: 'Diversify customer concentration', detail: 'Reducing reliance on a few customers can lower buyer risk.' });
  }
  if (['declining_major', 'declining_minor', 'flat'].includes(input.growth)) {
    potentialMultiple += 0.20;
    opportunities.push({ title: 'Re-establish growth', detail: 'Consistent organic growth can expand the buyer pool and support stronger pricing.' });
  }
  if (input.management === 'none') {
    potentialMultiple += 0.20;
    opportunities.push({ title: 'Strengthen management depth', detail: 'A credible second layer of leadership can improve transferability.' });
  }

  potentialMultiple = Math.min(potentialMultiple, currentHighMultiple + 0.95);
  const earningsPotential = Number(input.earnings) * potentialMultiple;
  const potentialHigh = (earningsPotential * 0.85 + revenueValueHigh * 0.15) * (1 + metroPct);
  const currentMid = currentHighValue;
  return {
    current: roundValue(currentMid),
    potential: roundValue(Math.max(currentMid, potentialHigh)),
    increase: roundValue(Math.max(0, potentialHigh - currentMid)),
    opportunities: opportunities.slice(0, 3)
  };
}

function buyerScore(input) {
  let earningsQuality = 14;
  let growth = 10;
  let independence = 10;
  let recurring = 10;
  let concentration = 10;

  growth += ({ declining_major: -6, declining_minor: -3, flat: 0, grow_1_10: 3, grow_10_20: 6, grow_20_plus: 8 }[input.growth] || 0);
  recurring += ({ none: -4, low: -2, medium: 2, high: 6, very_high: 8 }[input.recurring] || 0);
  independence += ({ normal: 8, manageable: 4, difficult: 0, high: -4, essential: -7 }[input.ownerDependence] || 0);
  concentration += ({ under_10: 8, '10_25': 4, '25_50': -1, over_50: -6 }[input.customerConcentration] || 0);
  if (input.management === 'yes') independence += 2;
  if (input.management === 'none') independence -= 2;
  if (Number(input.yearsOperating || 0) >= 10) earningsQuality += 4;
  else if (Number(input.yearsOperating || 0) < 3) earningsQuality -= 4;

  const score = Math.max(25, Math.min(96, earningsQuality + growth + independence + recurring + concentration));
  const label = score >= 80 ? 'Highly Marketable' : score >= 65 ? 'Marketable' : score >= 50 ? 'Moderately Marketable' : 'Needs Preparation';
  return { score: Math.round(score), label };
}

function driver(title, delta, detail) {
  return { title, delta: roundMultiple(delta), direction: delta > 0 ? 'positive' : delta < 0 ? 'negative' : 'neutral', detail };
}

function getSizeAdjustment(earnings, type) {
  if (type === 'ebitda') {
    if (earnings >= 3000000) return 0.55;
    if (earnings >= 1500000) return 0.35;
    if (earnings >= 750000) return 0.18;
    if (earnings < 250000) return -0.22;
    return 0;
  }
  if (earnings >= 1000000) return 0.38;
  if (earnings >= 500000) return 0.20;
  if (earnings >= 250000) return 0.08;
  if (earnings < 120000) return -0.25;
  return 0;
}

function growthAdjustment(v) { return ({ declining_major: -0.42, declining_minor: -0.20, flat: -0.05, grow_1_10: 0.10, grow_10_20: 0.28, grow_20_plus: 0.45 }[v] || 0); }
function recurringAdjustment(v) { return ({ none: -0.10, low: 0, medium: 0.12, high: 0.25, very_high: 0.35 }[v] || 0); }
function concentrationAdjustment(v) { return ({ under_10: 0.15, '10_25': 0.05, '25_50': -0.18, over_50: -0.42 }[v] || 0); }
function ownerDependenceAdjustment(v) { return ({ normal: 0.15, manageable: 0.05, difficult: -0.12, high: -0.32, essential: -0.50 }[v] || 0); }
function managementAdjustment(v) { return ({ yes: 0.20, partial: 0.05, none: -0.12 }[v] || 0); }
function yearsAdjustment(v) { if (v >= 10) return 0.10; if (v > 0 && v < 3) return -0.12; return 0; }

function growthCopy(v) { return ({ declining_major: 'A material decline generally increases buyer risk.', declining_minor: 'Recent softness can pressure valuation until the trend stabilizes.', flat: 'Flat revenue provides less support for a premium multiple.', grow_1_10: 'Steady growth modestly supports valuation.', grow_10_20: 'Double-digit growth can improve buyer demand.', grow_20_plus: 'Strong growth can support a premium, subject to durability and margin quality.' }[v] || 'Revenue trend factored into the estimate.'); }
function recurringCopy(v) { return ({ none: 'Little contracted or repeat revenue reduces forward visibility.', low: 'Limited repeat revenue provides modest visibility.', medium: 'A meaningful repeat customer base supports predictability.', high: 'High recurring or repeat revenue improves revenue visibility.', very_high: 'Very high recurring revenue can materially improve predictability.' }[v] || 'Revenue visibility factored into the estimate.'); }
function concentrationCopy(v) { return ({ under_10: 'No dominant customer reduces concentration risk.', '10_25': 'Customer concentration appears manageable.', '25_50': 'A large customer creates meaningful transition risk.', over_50: 'Heavy dependence on one customer can materially reduce buyer appetite.' }[v] || 'Customer concentration factored into the estimate.'); }
function ownerCopy(v) { return ({ normal: 'The company appears capable of operating without daily owner involvement.', manageable: 'Management can cover much of the owner’s role.', difficult: 'The business still relies meaningfully on the owner.', high: 'Revenue or operations would likely suffer if the owner exited quickly.', essential: 'The owner appears central to business continuity.' }[v] || 'Transferability factored into the estimate.'); }
function managementCopy(v) { return ({ yes: 'A day-to-day management layer can make the company easier to transfer.', partial: 'Some management coverage exists, but buyers may need transition support.', none: 'Lack of day-to-day management increases transition dependence on the owner.' }[v] || 'Management depth factored into the estimate.'); }

function clampMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(500000000, n));
}
function roundMultiple(n) { return Math.round(n * 100) / 100; }
function roundValue(n) {
  if (n >= 10000000) return Math.round(n / 100000) * 100000;
  if (n >= 1000000) return Math.round(n / 25000) * 25000;
  return Math.round(n / 5000) * 5000;
}

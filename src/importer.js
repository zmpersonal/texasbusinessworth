export async function refreshBenchmarks(env) {
  if (!env.BENCHMARK_FEED_URL || !env.BENCHMARK_FEED_TOKEN || !env.DB) {
    return { skipped: true, reason: 'Benchmark feed not configured' };
  }

  const response = await fetch(env.BENCHMARK_FEED_URL, {
    headers: {
      'Authorization': `Bearer ${env.BENCHMARK_FEED_TOKEN}`,
      'Accept': 'application/json'
    }
  });
  if (!response.ok) throw new Error(`Benchmark feed returned ${response.status}`);

  const payload = await response.json();
  const rows = Array.isArray(payload) ? payload : payload.benchmarks;
  if (!Array.isArray(rows)) throw new Error('Benchmark feed must return an array or { benchmarks: [] }');

  let imported = 0;
  for (const row of rows.slice(0, 5000)) {
    if (!validRow(row)) continue;
    await env.DB.prepare(`
      INSERT INTO valuation_benchmarks
      (sector, label, naics, geography, revenue_min, revenue_max, earnings_min, earnings_max,
       sde_low, sde_high, ebitda_low, ebitda_high, revenue_low, revenue_high, source_name,
       source_url, sample_size, effective_date, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(sector, naics, geography, source_name, effective_date, revenue_min, revenue_max, earnings_min, earnings_max)
      DO UPDATE SET
        label=excluded.label,
        sde_low=excluded.sde_low,
        sde_high=excluded.sde_high,
        ebitda_low=excluded.ebitda_low,
        ebitda_high=excluded.ebitda_high,
        revenue_low=excluded.revenue_low,
        revenue_high=excluded.revenue_high,
        source_url=excluded.source_url,
        sample_size=excluded.sample_size,
        updated_at=CURRENT_TIMESTAMP
    `).bind(
      row.sector,
      String(row.label || row.sector).slice(0, 120),
      row.naics ? String(row.naics).slice(0, 12) : '',
      row.geography,
      boundedNumber(row.revenue_min, 0), boundedNumber(row.revenue_max, 1000000000000000),
      boundedNumber(row.earnings_min, 0), boundedNumber(row.earnings_max, 1000000000000000),
      Number(row.sde_low), Number(row.sde_high),
      Number(row.ebitda_low), Number(row.ebitda_high),
      Number(row.revenue_low), Number(row.revenue_high),
      String(row.source_name).slice(0, 120),
      row.source_url ? String(row.source_url).slice(0, 500) : null,
      Number.isFinite(Number(row.sample_size)) ? Number(row.sample_size) : null,
      String(row.effective_date).slice(0, 40)
    ).run();
    imported++;
  }

  await env.DB.prepare(`
    INSERT INTO data_refresh_log (source_name, status, rows_imported, detail)
    VALUES (?, 'success', ?, ?)
  `).bind('BENCHMARK_FEED_URL', imported, `Imported ${imported} benchmark rows`).run();

  return { skipped: false, imported };
}

function validRow(row) {
  const geos = ['texas', 'austin', 'san_antonio', 'houston', 'dfw', 'texas_other'];
  const nums = ['sde_low','sde_high','ebitda_low','ebitda_high','revenue_low','revenue_high'];
  return row &&
    typeof row.sector === 'string' && row.sector.length <= 60 &&
    geos.includes(row.geography) &&
    typeof row.source_name === 'string' &&
    row.effective_date &&
    nums.every(k => Number.isFinite(Number(row[k])) && Number(row[k]) > 0) &&
    Number(row.sde_high) >= Number(row.sde_low) &&
    Number(row.ebitda_high) >= Number(row.ebitda_low) &&
    Number(row.revenue_high) >= Number(row.revenue_low);
}

function boundedNumber(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

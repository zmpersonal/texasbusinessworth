PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS campaign_links (
  public_token TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  company_name TEXT,
  industry_label TEXT,
  sector TEXT,
  naics TEXT,
  metro TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  clicks INTEGER NOT NULL DEFAULT 0,
  last_clicked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_campaign_links_campaign ON campaign_links(campaign_id);

CREATE TABLE IF NOT EXISTS valuation_sessions (
  id TEXT PRIMARY KEY,
  campaign_id TEXT,
  landing_path TEXT,
  referrer TEXT,
  user_agent TEXT,
  metro TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_campaign ON valuation_sessions(campaign_id);
CREATE INDEX IF NOT EXISTS idx_sessions_created ON valuation_sessions(created_at);

CREATE TABLE IF NOT EXISTS valuation_benchmarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sector TEXT NOT NULL,
  label TEXT NOT NULL,
  naics TEXT NOT NULL DEFAULT '',
  geography TEXT NOT NULL,
  revenue_min REAL NOT NULL DEFAULT 0,
  revenue_max REAL NOT NULL DEFAULT 1000000000000000,
  earnings_min REAL NOT NULL DEFAULT 0,
  earnings_max REAL NOT NULL DEFAULT 1000000000000000,
  sde_low REAL NOT NULL,
  sde_high REAL NOT NULL,
  ebitda_low REAL NOT NULL,
  ebitda_high REAL NOT NULL,
  revenue_low REAL NOT NULL,
  revenue_high REAL NOT NULL,
  source_name TEXT NOT NULL,
  source_url TEXT,
  sample_size INTEGER,
  effective_date TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(sector, naics, geography, source_name, effective_date, revenue_min, revenue_max, earnings_min, earnings_max)
);
CREATE INDEX IF NOT EXISTS idx_benchmarks_lookup ON valuation_benchmarks(sector, naics, geography, effective_date DESC);

CREATE TABLE IF NOT EXISTS valuation_results (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  benchmark_version TEXT NOT NULL,
  sector TEXT NOT NULL,
  industry_label TEXT,
  naics TEXT,
  metro TEXT NOT NULL,
  revenue REAL NOT NULL,
  earnings REAL NOT NULL,
  earnings_type TEXT NOT NULL,
  growth TEXT NOT NULL,
  refined INTEGER NOT NULL DEFAULT 0 CHECK (refined IN (0,1)),
  inputs_json TEXT NOT NULL,
  benchmark_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  value_low REAL NOT NULL,
  value_high REAL NOT NULL,
  multiple_low REAL NOT NULL,
  multiple_high REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES valuation_sessions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_results_session ON valuation_results(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_results_created ON valuation_results(created_at);

CREATE TABLE IF NOT EXISTS seller_leads (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  valuation_id TEXT,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  preferred_contact TEXT NOT NULL,
  selling_intent TEXT NOT NULL,
  sale_timing TEXT NOT NULL,
  lead_score INTEGER NOT NULL,
  consent_text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES valuation_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (valuation_id) REFERENCES valuation_results(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_leads_created ON seller_leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_score ON seller_leads(lead_score DESC);

CREATE TABLE IF NOT EXISTS analytics_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  meta_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES valuation_sessions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_events_session ON analytics_events(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_events_name ON analytics_events(event_name, created_at);

CREATE TABLE IF NOT EXISTS data_refresh_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_name TEXT NOT NULL,
  status TEXT NOT NULL,
  rows_imported INTEGER NOT NULL DEFAULT 0,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

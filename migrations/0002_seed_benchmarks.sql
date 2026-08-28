-- Seed values are modeling defaults, not a substitute for a licensed transaction-comp database.
-- They allow the funnel to work on day one and should be superseded by licensed/API-fed rows.
INSERT OR IGNORE INTO valuation_benchmarks
(sector,label,geography,sde_low,sde_high,ebitda_low,ebitda_high,revenue_low,revenue_high,source_name,source_url,sample_size,effective_date)
VALUES
('home_services','Home & Trade Services','texas',2.70,3.70,3.80,5.20,0.55,0.90,'TBW seed benchmark',NULL,NULL,'2026-Q3'),
('construction','Construction & Specialty Contracting','texas',2.50,3.50,3.70,5.00,0.40,0.75,'TBW seed benchmark',NULL,NULL,'2026-Q3'),
('professional','Professional Services','texas',2.80,4.00,4.00,5.80,0.70,1.20,'TBW seed benchmark',NULL,NULL,'2026-Q3'),
('healthcare','Healthcare Services','texas',2.90,4.20,4.20,6.10,0.70,1.25,'TBW seed benchmark',NULL,NULL,'2026-Q3'),
('manufacturing','Manufacturing','texas',2.70,3.90,4.10,5.80,0.55,1.00,'TBW seed benchmark',NULL,NULL,'2026-Q3'),
('distribution','Distribution & Wholesale','texas',2.40,3.40,3.60,5.00,0.35,0.70,'TBW seed benchmark',NULL,NULL,'2026-Q3'),
('retail','Retail','texas',2.00,3.00,3.00,4.30,0.25,0.55,'TBW seed benchmark',NULL,NULL,'2026-Q3'),
('software','Software & IT Services','texas',3.10,4.70,4.80,7.50,0.90,1.80,'TBW seed benchmark',NULL,NULL,'2026-Q3'),
('hospitality','Hospitality & Food Service','texas',2.00,3.00,3.10,4.50,0.30,0.65,'TBW seed benchmark',NULL,NULL,'2026-Q3'),
('other','Other Privately Held Business','texas',2.40,3.50,3.70,5.20,0.45,0.85,'TBW seed benchmark',NULL,NULL,'2026-Q3');

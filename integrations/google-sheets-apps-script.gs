/**
 * Texas Business Worth -> Google Sheets receiver
 *
 * Setup:
 * 1) Create/open the Google Sheet that should receive leads.
 * 2) Extensions -> Apps Script, replace the starter code with this file.
 * 3) In Apps Script: Project Settings -> Script Properties, add:
 *      TBW_WEBHOOK_SECRET = a long random secret
 * 4) Deploy -> New deployment -> Web app.
 *      Execute as: Me
 *      Who has access: Anyone
 * 5) Copy the /exec URL into Cloudflare secret GOOGLE_SHEETS_WEBHOOK_URL.
 * 6) Put the same secret into Cloudflare secret GOOGLE_SHEETS_WEBHOOK_SECRET.
 */

const SHEET_NAME = 'Seller Leads';
const HEADERS = [
  'Received At','Lead ID','Lead Score','Selling Intent','Sale Timing',
  'Contact Name','Email','Phone','Preferred Contact',
  'Business Name','Business Address','Industry','Sector','NAICS','Metro',
  'Revenue','Earnings','Earnings Type','Growth','Years Operating',
  'Recurring / Repeat','Largest Customer','Owner Dependence','Management',
  'Seller Target Price','Valuation Low','Valuation High','Most Likely Low','Most Likely High',
  'Multiple Low','Multiple High','Buyer Score','Buyer Label','Potential Upper Value',
  'Stress Test Price','Price Source','Down Payment %','Interest Rate','Loan Term Years',
  'Cash At Close','Monthly P&I','Annual Debt Service','DSCR','Take Home / Year','Cash-on-Cash',
  'Financing Note'
];

function doPost(e) {
  try {
    const payload = JSON.parse((e.postData && e.postData.contents) || '{}');
    const expected = PropertiesService.getScriptProperties().getProperty('TBW_WEBHOOK_SECRET') || '';
    if (expected && payload.sheetSecret !== expected) return json_({ok:false,error:'unauthorized'});

    const sheet = getSheet_();
    const lead = payload.lead || {};
    const business = payload.business || {};
    const quality = business.quality || {};
    const valuation = payload.valuation || {};
    const gap = valuation.valueGap || {};
    const finance = payload.acquisitionSnapshot || {};

    const row = [
      payload.receivedAt || new Date().toISOString(), lead.id || '', lead.leadScore || '', lead.sellingIntent || '', lead.saleTiming || '',
      lead.name || '', lead.email || '', lead.phone || '', lead.preferredContact || '',
      business.name || '', business.address || '', business.industry || '', business.sector || '', business.naics || '', business.metro || '',
      business.revenue || '', business.earnings || '', business.earningsType || '', business.growth || '', business.yearsOperating || '',
      quality.recurring || '', quality.customerConcentration || '', quality.ownerDependence || '', quality.management || '',
      business.targetSalePrice || '', valuation.low || '', valuation.high || '', valuation.mostLikelyLow || '', valuation.mostLikelyHigh || '',
      valuation.multipleLow || '', valuation.multipleHigh || '', valuation.buyerScore || '', valuation.buyerLabel || '', gap.potential || '',
      finance.askingPrice || '', finance.priceSource || '', finance.downPaymentPct || '', finance.interestRate || '', finance.loanTermYears || '',
      finance.cashAtClose || '', finance.monthlyPI || '', finance.annualDebt || '', finance.dscr || '', finance.takeHome || '', finance.cashOnCash || '',
      finance.note || ''
    ];

    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try { sheet.appendRow(row); } finally { lock.releaseLock(); }
    return json_({ok:true});
  } catch (err) {
    return json_({ok:false,error:String(err && err.message || err)});
  }
}

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1,1,1,HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

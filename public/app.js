const state = {
  sessionId: null,
  valuationId: null,
  metro: '', sector: '', industryLabel: '', naics: '',
  businessName: '', businessAddress: '', targetSalePrice: 0,
  revenue: 0, earnings: 0, earningsType: 'sde', growth: '',
  refined: false,
  recurring: '', customerConcentration: '', ownerDependence: '', management: '', yearsOperating: '',
  sellingIntent: '', preferredContact: '',
  config: { turnstileSiteKey: '' },
  currentResult: null,
  prefill: null,
  currentStep: 0
};

const stepIds = ['step-location','step-industry','step-financials','step-growth'];
const qs = s => document.querySelector(s);
const qsa = s => [...document.querySelectorAll(s)];

boot();

async function boot() {
  bindActions();
  try { state.config = await api('/api/config'); } catch (_) {}
  const saved = sessionStorage.getItem('tbw_state');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      // Deliberately do not restore contact information.
      Object.assign(state, parsed, { config: state.config, preferredContact: '', sellingIntent: '' });
    } catch (_) {}
  }
}

function bindActions() {
  qsa('[data-action="start"]').forEach(b => b.addEventListener('click', startValuation));
  qsa('[data-action="restart"]').forEach(b => b.addEventListener('click', () => { sessionStorage.removeItem('tbw_state'); location.href='/'; }));

  qsa('[data-field]').forEach(group => {
    group.addEventListener('click', e => {
      const button = e.target.closest('button[data-value]');
      if (!button) return;
      e.preventDefault();
      selectButton(group, button);
      state[group.dataset.field] = button.dataset.value;
      persist();
      afterSelection(group.dataset.field);
    });
  });

  qs('#industryNext').addEventListener('click', () => {
    state.industryLabel = qs('#industryLabel').value.trim() || sectorLabel(state.sector);
    showStep(2);
  });
  qs('#financialNext').addEventListener('click', submitFinancials);
  qs('#backButton').addEventListener('click', () => showStep(Math.max(0, state.currentStep - 1)));
  qs('#refineButton').addEventListener('click', openRefinement);
  qs('#refineBack').addEventListener('click', () => { showOnly('result'); window.scrollTo({top:0,behavior:'smooth'}); });
  qs('#recalculateButton').addEventListener('click', submitRefinement);

  qsa('[data-intent]').forEach(b => b.addEventListener('click', () => handleIntent(b.dataset.intent)));
  qs('#leadForm').addEventListener('submit', submitLead);

  ['revenue','earnings','targetSalePrice'].forEach(id => {
    const el = qs(`#${id}`);
    el.addEventListener('input', () => { el.value = formatNumberInput(el.value); });
  });
}

async function startValuation() {
  qs('[data-action="start"]').disabled = true;
  try {
    const token = new URL(location.href).searchParams.get('t') || '';
    const data = await api('/api/session', { method:'POST', body:{ campaignToken:token, landingPath:location.pathname + location.search } });
    state.sessionId = data.sessionId;
    state.prefill = data.prefill;
    applyPrefill();
    persist();
    showOnly('wizard');
    showStep(0);
    window.scrollTo({top:0,behavior:'smooth'});
  } catch (err) {
    alert(err.message || 'Unable to start the valuation. Please try again.');
    qs('[data-action="start"]').disabled = false;
  }
}

function applyPrefill() {
  if (!state.prefill) return;
  if (state.prefill.metro) state.metro = state.prefill.metro;
  if (state.prefill.sector) state.sector = state.prefill.sector;
  if (state.prefill.industryLabel) state.industryLabel = state.prefill.industryLabel;
  if (state.prefill.naics) state.naics = state.prefill.naics;
  if (state.prefill.companyName) state.businessName = state.prefill.companyName;
}

function afterSelection(field) {
  if (field === 'metro') setTimeout(() => showStep(1), 110);
  if (field === 'sector') qs('#industryNext').disabled = false;
  if (field === 'growth') setTimeout(calculateInitial, 120);
}

function showStep(index) {
  state.currentStep = index;
  stepIds.forEach((id,i) => qs(`#${id}`).classList.toggle('hidden', i !== index));
  qs('#step-calculating').classList.add('hidden');
  qs('#backButton').classList.toggle('hidden', index === 0);
  qs('#progressBar').style.width = `${(index+1)*25}%`;
  qs('#progressText').textContent = `Step ${index+1} of 4`;
  syncSelections();
  persist();
}

function syncSelections() {
  qsa('[data-field]').forEach(group => {
    const field = group.dataset.field;
    qsa('button[data-value]', group).forEach(b => b.classList.toggle('selected', state[field] === b.dataset.value));
  });
  if (state.industryLabel) qs('#industryLabel').value = state.industryLabel;
  if (state.revenue) qs('#revenue').value = comma(state.revenue);
  if (state.earnings) qs('#earnings').value = comma(state.earnings);
  if (qs('#businessName') && state.businessName) qs('#businessName').value = state.businessName;
  if (qs('#businessAddress') && state.businessAddress) qs('#businessAddress').value = state.businessAddress;
  if (qs('#targetSalePrice') && state.targetSalePrice) qs('#targetSalePrice').value = comma(state.targetSalePrice);
  if (qs('#yearsOperating') && state.yearsOperating) qs('#yearsOperating').value = state.yearsOperating;
  qs('#industryNext').disabled = !state.sector;
}

function submitFinancials() {
  const revenue = parseMoney(qs('#revenue').value);
  const earnings = parseMoney(qs('#earnings').value);
  const error = qs('#financialError');
  error.textContent = '';
  if (revenue < 50000) return error.textContent = 'Enter annual revenue of at least $50,000.';
  if (earnings < 10000) return error.textContent = 'Enter annual earnings of at least $10,000.';
  if (earnings > revenue * 1.5) return error.textContent = 'Please double-check the revenue and earnings amounts.';
  state.revenue = revenue; state.earnings = earnings;
  persist(); showStep(3);
}

async function calculateInitial() {
  showCalculating();
  const payload = estimatePayload(false);
  try {
    const [result] = await Promise.all([api('/api/estimate',{method:'POST',body:payload}), animateCalculation()]);
    state.currentResult = result; state.valuationId = result.valuationId; state.refined = false;
    persist(); renderResult(result); showOnly('result'); window.scrollTo({top:0,behavior:'smooth'});
  } catch (err) {
    showOnly('wizard'); showStep(3); alert(err.message || 'Unable to calculate the estimate.');
  }
}

function showCalculating() {
  stepIds.forEach(id => qs(`#${id}`).classList.add('hidden'));
  qs('#step-calculating').classList.remove('hidden');
  qs('#backButton').classList.add('hidden');
  qs('#progressBar').style.width='100%';
  qs('#progressText').textContent='Calculating';
}

async function animateCalculation() {
  const items = qsa('#calcList li');
  const started = performance.now();
  const minimumMs = 4000;
  const stepMs = Math.floor(3500 / Math.max(1, items.length));
  items.forEach(el => el.classList.remove('done'));
  for (let i=0;i<items.length;i++) {
    items.forEach((el,j) => { el.classList.toggle('active',j===i); if(j<i) el.classList.add('done'); });
    await sleep(stepMs);
  }
  const elapsed = performance.now() - started;
  if (elapsed < minimumMs) await sleep(minimumMs - elapsed);
  items.forEach(el => { el.classList.remove('active'); el.classList.add('done'); });
}

function renderResult(r) {
  qs('#resultRange').textContent = `${moneyShort(r.range.low)} – ${moneyShort(r.range.high)}`;
  qs('#confidenceValue').textContent = `${r.confidence}%`;
  qs('#trackLow').textContent = moneyShort(r.range.low);
  qs('#trackHigh').textContent = moneyShort(r.range.high);
  qs('#trackLikely').textContent = `Most likely ${moneyShort(r.mostLikely.low)}–${moneyShort(r.mostLikely.high)}`;
  qs('#multipleRange').textContent = `${r.multiple.low.toFixed(2)}× – ${r.multiple.high.toFixed(2)}× ${r.multiple.type}`;
  qs('#methodType').textContent = `${r.multiple.type} primary + revenue check`;
  qs('#marketLabel').textContent = r.metro.label;
  qs('#industryResult').textContent = state.industryLabel || sectorLabel(state.sector);
  const b = r.benchmark || {};
  qs('#benchmarkNote').textContent = `Benchmark: ${b.sourceName || 'Texas Business Worth model'} · ${geoLabel(b.geography || 'texas')}${b.sampleSize ? ` · ${b.sampleSize.toLocaleString()} observations` : ''}${b.effectiveDate ? ` · ${b.effectiveDate}` : ''}`;

  const drivers = [...(r.positives || []), ...(r.negatives || [])].slice(0,5);
  if (!drivers.length) drivers.push({title:'Texas market calibration',direction:'neutral',detail:'Your estimate reflects the selected Texas market and business category.',delta:0});
  qs('#driversList').innerHTML = drivers.map(d => `<div class="driver-item"><span class="driver-icon ${escapeHtml(d.direction)}">${d.direction==='positive'?'↑':d.direction==='negative'?'↓':'•'}</span><div><b>${escapeHtml(d.title)} ${d.delta ? `<em>${d.delta>0?'+':''}${d.delta.toFixed(2)}×</em>`:''}</b><small>${escapeHtml(d.detail)}</small></div></div>`).join('');

  qs('#refineCta').classList.toggle('hidden', !!state.refined);
  qs('#refinedModules').classList.toggle('hidden', !state.refined);
  if (state.refined) renderRefined(r);
}

function renderRefined(r) {
  qs('#buyerScore').textContent = r.buyerScore?.score ?? '—';
  qs('#buyerLabel').textContent = r.buyerScore?.label ?? 'Marketability analyzed';
  qs('#gapCurrent').textContent = moneyShort(r.valueGap?.current || r.range.high);
  qs('#gapPotential').textContent = moneyShort(r.valueGap?.potential || r.range.high);
  qs('#gapIncrease').textContent = r.valueGap?.increase ? `+${moneyShort(r.valueGap.increase)}` : 'Limited';
  const opps = r.valueGap?.opportunities || [];
  qs('#opportunityList').innerHTML = opps.length ? opps.map(o => `<div><b>${escapeHtml(o.title)}</b><small>${escapeHtml(o.detail)}</small></div>`).join('') : '<div><b>Strong current profile</b><small>Your answers did not reveal a large modelled value gap from the factors measured here.</small></div>';
  qs('#intentQuestion').textContent = `Would you consider selling if you could get an offer around ${moneyShort(r.range.low)}–${moneyShort(r.range.high)}?`;
}

function openRefinement() {
  postEvent('refinement_started');
  showOnly('refine'); syncSelections();
  window.scrollTo({top:0,behavior:'smooth'});
}

async function submitRefinement() {
  state.businessName = qs('#businessName').value.trim();
  state.businessAddress = qs('#businessAddress').value.trim();
  state.targetSalePrice = parseMoney(qs('#targetSalePrice').value);
  state.yearsOperating = qs('#yearsOperating').value;
  const required = ['businessName','businessAddress','recurring','customerConcentration','ownerDependence','management','yearsOperating'];
  const missing = required.filter(k => !state[k]);
  if (missing.length) return qs('#refineError').textContent='Add the business name and address, then complete all five questions.';
  qs('#refineError').textContent='';
  qs('#recalculateButton').disabled=true; qs('#recalculateButton').textContent='Updating valuation…';
  try {
    state.refined = true;
    const r = await api('/api/estimate',{method:'POST',body:estimatePayload(true)});
    state.currentResult=r; state.valuationId=r.valuationId; persist(); renderResult(r); showOnly('result');
    window.scrollTo({top:0,behavior:'smooth'});
  } catch (err) {
    state.refined=false; qs('#refineError').textContent=err.message || 'Unable to update the estimate.';
  } finally {
    qs('#recalculateButton').disabled=false; qs('#recalculateButton').textContent='Update My Valuation →';
  }
}

async function handleIntent(intent) {
  state.sellingIntent = intent;
  if (intent === 'not_now') {
    postEvent('selling_intent_not_now');
    qs('#intentCard').innerHTML='<div class="intent-icon">✓</div><div><div class="eyebrow">VALUATION COMPLETE</div><h3>Your estimate is yours to use.</h3><p>No contact information is required. You can return later if selling becomes relevant.</p></div>';
    return;
  }
  postEvent(intent === 'yes' ? 'selling_intent_yes' : 'selling_intent_maybe');
  showSection('leadSection');
  await postEvent('contact_started');
  loadTurnstile();
  qs('#leadSection').scrollIntoView({behavior:'smooth',block:'start'});
}

async function submitLead(e) {
  e.preventDefault();
  const error = qs('#leadError'); error.textContent='';
  if (!state.preferredContact) return error.textContent='Select how you prefer to be contacted.';
  const email = qs('#email').value.trim(), phone=qs('#phone').value.trim();
  if (state.preferredContact !== 'email' && phone.replace(/\D/g,'').length < 10) return error.textContent='Enter a phone number for phone or text contact.';
  const submit = e.currentTarget.querySelector('button[type="submit"]'); submit.disabled=true; submit.textContent='Submitting confidentially…';
  try {
    const turnstileToken = window.turnstile ? window.turnstile.getResponse() : '';
    await api('/api/lead',{method:'POST',body:{
      sessionId:state.sessionId, sellingIntent:state.sellingIntent,
      fullName:qs('#fullName').value.trim(), email, phone,
      businessName:state.businessName, businessAddress:state.businessAddress, targetSalePrice:state.targetSalePrice || 0,
      preferredContact:state.preferredContact, saleTiming:qs('#saleTiming').value,
      turnstileToken
    }});
    sessionStorage.removeItem('tbw_state'); showOnly('success'); window.scrollTo({top:0,behavior:'smooth'});
  } catch (err) {
    error.textContent=err.message || 'Unable to submit. Please try again.';
    if (window.turnstile) window.turnstile.reset();
  } finally { submit.disabled=false; submit.textContent='Request a Confidential Conversation →'; }
}

function loadTurnstile() {
  if (!state.config.turnstileSiteKey || qs('#turnstileMount').dataset.loaded) return;
  qs('#turnstileMount').dataset.loaded='1';
  const render = () => window.turnstile.render('#turnstileMount',{sitekey:state.config.turnstileSiteKey,theme:'light',size:'flexible'});
  if (window.turnstile) return render();
  window.onloadTurnstile = render;
  const s=document.createElement('script'); s.src='https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onloadTurnstile&render=explicit'; s.async=true; s.defer=true; document.head.appendChild(s);
}

function estimatePayload(refined) {
  return {
    sessionId:state.sessionId, metro:state.metro, sector:state.sector,
    industryLabel:state.industryLabel || sectorLabel(state.sector), naics:state.naics || '',
    revenue:state.revenue, earnings:state.earnings, earningsType:state.earningsType,
    growth:state.growth, refined,
    ...(refined ? { businessName:state.businessName, businessAddress:state.businessAddress, targetSalePrice:Number(state.targetSalePrice)||0, recurring:state.recurring, customerConcentration:state.customerConcentration, ownerDependence:state.ownerDependence, management:state.management, yearsOperating:Number(state.yearsOperating) } : {})
  };
}

function selectButton(group, button) { qsa('button[data-value]',group).forEach(b=>b.classList.remove('selected')); button.classList.add('selected'); }
function showOnly(id) { ['landing','wizard','result','refine','leadSection','success'].forEach(x => qs(`#${x}`)?.classList.toggle('hidden',x!==id)); }
function showSection(id) { qs(`#${id}`).classList.remove('hidden'); }
function persist() {
  const safe = {...state}; delete safe.config; delete safe.prefill; delete safe.sellingIntent; delete safe.preferredContact;
  sessionStorage.setItem('tbw_state',JSON.stringify(safe));
}
async function postEvent(event,meta={}) { try { if(state.sessionId) await api('/api/event',{method:'POST',body:{sessionId:state.sessionId,event,meta}}); } catch(_){} }
async function api(path, options={}) {
  const init={method:options.method||'GET',headers:{'content-type':'application/json'}};
  if(options.body) init.body=JSON.stringify(options.body);
  const r=await fetch(path,init); let data={}; try{data=await r.json();}catch(_){}
  if(!r.ok) throw new Error(data.error||`Request failed (${r.status})`); return data;
}
function parseMoney(v){return Number(String(v||'').replace(/[^\d.]/g,''))||0}
function formatNumberInput(v){const digits=String(v).replace(/\D/g,'').slice(0,12);return digits?Number(digits).toLocaleString('en-US'):''}
function comma(n){return Number(n).toLocaleString('en-US')}
function moneyShort(n){n=Number(n)||0;if(n>=1000000){const m=n/1000000;return `$${m>=10?m.toFixed(1):m.toFixed(2).replace(/0$/,'')}M`}if(n>=1000)return `$${Math.round(n/1000)}K`;return `$${Math.round(n).toLocaleString()}`}
function sectorLabel(v){return ({home_services:'Home & Trade Services',construction:'Construction & Specialty Contracting',professional:'Professional Services',healthcare:'Healthcare Services',manufacturing:'Manufacturing',distribution:'Distribution & Wholesale',retail:'Retail',software:'Software & IT Services',hospitality:'Hospitality & Food Service',other:'Other Privately Held Business'}[v]||'Privately Held Business')}
function geoLabel(v){return ({texas:'Texas',austin:'Austin–Round Rock',san_antonio:'San Antonio',houston:'Houston',dfw:'Dallas–Fort Worth',texas_other:'Texas'}[v]||'Texas')}
function escapeHtml(s){return String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}

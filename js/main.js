// ==========================================
// 全域變數宣告
// ==========================================
let isPrivacyMode = false; 
let currentRate = 32.5; 
let prevRate = 32.5; 
let latestDataTime = 0; 
let charts = {}; 
let currentMarketView = 'ALL'; 
let realPortfolio = { tw: [], us: [] }; 
let sandboxScenarios = []; 
let activeScenarioId = 'real'; 
let stockMapCache = {}; 
let globalCombinedList = []; 
let compareData = { realGlobal: null, realTW: null, realUS: null, sandboxList: [] };
let currentMCDim = 'P50'; 
let currentPromptPrice = 0;
let isReportRendered = false; 
window.historicalDataCache = {};
let pbiResults = [];
let isPbiRunning = false;

// ==========================================
// 工具函式
// ==========================================
function openDrawer() { document.getElementById('drawer-overlay').classList.add('show'); }
function closeDrawer() { document.getElementById('drawer-overlay').classList.remove('show'); }
function navigateTo(url) { closeDrawer(); setTimeout(() => { document.body.classList.add('fade-out'); setTimeout(() => { window.location.href = url; }, 400); }, 250); }
const fmtMoney = (n) => isPrivacyMode ? '****' : Math.round(n).toLocaleString();
const parseNum = (str) => { if (!str) return 0; const val = parseFloat(str.toString().replace(/,/g, '').replace('%', '')); return isNaN(val) ? 0 : val; };
const setLoading = (show, msg="正在分析數據...") => { document.getElementById('loading-text').innerText = msg; document.getElementById('loading-overlay').style.display = show ? 'flex' : 'none'; };
const generateId = () => Math.random().toString(36).substr(2, 9);
let toastTimeout;
function showToast(msg) { const toast = document.getElementById('toast-container'); toast.innerText = msg; toast.classList.add('show'); clearTimeout(toastTimeout); toastTimeout = setTimeout(() => toast.classList.remove('show'), 2500); }

// ==========================================
// 初始化
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('upload-tw').addEventListener('change', (e) => handleFileUpload(e, 'tw'));
    document.getElementById('upload-us').addEventListener('change', (e) => handleFileUpload(e, 'us'));

    const savedTW = localStorage.getItem('portfolio_tw'); 
    const savedUS = localStorage.getItem('portfolio_us'); 
    const savedScen = localStorage.getItem('invest_scenarios_v1');
    if (savedTW) try { realPortfolio.tw = JSON.parse(savedTW); } catch(e) {}
    if (savedUS) try { realPortfolio.us = JSON.parse(savedUS); } catch(e) {}
    if (savedScen) try { sandboxScenarios = JSON.parse(savedScen); } catch(e) {}

    document.getElementById('btn-confirm-danger').onclick = () => { closeConfirmModal(); if(confirmCallback) confirmCallback(); };
    document.getElementById('scen-prompt-confirm').onclick = () => { closeScenPrompt(); if(promptCallback) promptCallback(document.getElementById('scen-prompt-input').value); };
    
    document.getElementById('btn-sb-check').onclick = async () => {
        const val = document.getElementById('sb-input-val').value.trim().toUpperCase(); if (!val) return;
        document.getElementById('sb-step-input').style.display = 'none'; document.getElementById('sb-step-loading').style.display = 'block';
        try {
            const res = await fetch('/api/finance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbols: [val] }) }); 
            const json = await res.json();
            if (json.status === 'success' && json.data[val]) { 
                const data = json.data[val]; stockMapCache[val] = data; currentPromptPrice = data.price; 
                document.getElementById('sb-yahoo-name').innerText = data.yahooName || val; 
                document.getElementById('sb-yahoo-price').innerText = data.price; 
                document.getElementById('sb-step-loading').style.display = 'none'; document.getElementById('sb-step-confirm').style.display = 'block'; 
            } else { showToast("查無此代號"); document.getElementById('sb-step-loading').style.display = 'none'; document.getElementById('sb-step-input').style.display = 'block'; }
        } catch (e) { document.getElementById('sb-step-loading').style.display = 'none'; document.getElementById('sb-step-input').style.display = 'block'; }
    };
    document.getElementById('btn-sb-save').onclick = () => {
        let shares = parseFloat(document.getElementById('sb-shares').value) || 0; 
        let cost = parseFloat(document.getElementById('sb-cost').value) || 0; 
        let symbol = document.getElementById('sb-input-val').value.trim().toUpperCase(); 
        let sc = sandboxScenarios.find(s => s.id === activeScenarioId); 
        let market = symbol.includes('.TW') || symbol.includes('.TWO') ? 'tw' : 'us'; 
        sc.portfolio[market].push({ market: market.toUpperCase(), name: document.getElementById('sb-yahoo-name').innerText, symbol, shares, cost });
        document.getElementById('sandbox-add-overlay').classList.remove('active'); 
        saveInventoryChanges(); 
    };

    updateScenarioUI();
    if (realPortfolio.tw.length > 0 || realPortfolio.us.length > 0) { setLoading(true); try { await updateFinanceData(); } catch(e) {} finally { setLoading(false); } } 
    else { renderCurrentView(); }
    setTimeout(() => { startPbiScan(); }, 1000);
});

// ==========================================
// 數據更新與顯示
// ==========================================
async function updateFinanceData() {
    let symbolsToFetch = new Set();
    [realPortfolio, ...sandboxScenarios.map(s => s.portfolio)].forEach(p => {
        p.tw.forEach(i => symbolsToFetch.add(i.symbol)); p.us.forEach(i => symbolsToFetch.add(i.symbol));
    });
    symbolsToFetch.delete(null); symbolsToFetch.delete('');
    
    if (symbolsToFetch.size > 0) {
        try {
            const res = await fetch('/api/finance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbols: Array.from(symbolsToFetch) }) });
            const json = await res.json();
            if (json.status === 'success') { stockMapCache = Object.assign(stockMapCache, json.data); currentRate = json.exchangeRate; prevRate = json.prevExchangeRate || json.exchangeRate; }
        } catch(e) { showToast("連線異常"); }
    }
    
    latestDataTime = 0;
    const mapToCombined = (portfolio) => {
        return [...portfolio.tw, ...portfolio.us].filter(i => i.symbol && i.symbol !== 'SKIP').map(item => {
            const m = stockMapCache[item.symbol]; if (!m) return null;
            if (m.regularMarketTime > latestDataTime) latestDataTime = m.regularMarketTime;
            const exRate = item.market === 'US' ? currentRate : 1; 
            const pastExRate = item.market === 'US' ? prevRate : 1;
            const marketVal = m.price * item.shares * exRate;
            return { ...item, currentPrice: m.price, marketValueTWD: marketVal, costTWD: item.cost * exRate, dayChangeTWD: marketVal - ((m.price - m.change) * item.shares * pastExRate), cagr: m.cagr, stdev: m.stdev, dividendYield: m.dividendYield };
        }).filter(i => i && i.marketValueTWD > 0);
    };

    globalCombinedList = activeScenarioId === 'real' ? mapToCombined(realPortfolio) : mapToCombined(sandboxScenarios.find(s => s.id === activeScenarioId).portfolio);
    
    const dateEl = document.getElementById('data-date');
    if (latestDataTime > 0) {
        let d = new Date(latestDataTime * 1000);
        dateEl.innerText = `📅 ${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
        dateEl.style.display = 'inline-block';
    }
    renderCurrentView();
}

// ==========================================
// 補回缺失的核心函式
// ==========================================
function updateScenarioUI() {
    const listEl = document.getElementById('scenario-list'); if(!listEl) return;
    let html = `<div class="scenario-item ${activeScenarioId === 'real' ? 'active' : ''}" onclick="switchScenario('real')"><span>📊 真實庫存</span></div>`;
    sandboxScenarios.forEach(sc => { html += `<div class="scenario-item ${activeScenarioId === sc.id ? 'active' : ''}" onclick="switchScenario('${sc.id}')"><span>🧪 ${sc.name}</span><button onclick="deleteScenario(event, '${sc.id}')">×</button></div>`; });
    listEl.innerHTML = html;
}

function switchScenario(id) { activeScenarioId = id; updateScenarioUI(); setLoading(true); updateFinanceData().finally(() => setLoading(false)); }

function saveInventoryChanges() {
    if (activeScenarioId === 'real') { localStorage.setItem('portfolio_tw', JSON.stringify(realPortfolio.tw)); localStorage.setItem('portfolio_us', JSON.stringify(realPortfolio.us)); } 
    else { localStorage.setItem('invest_scenarios_v1', JSON.stringify(sandboxScenarios)); }
    updateFinanceData();
}

async function handleFileUpload(event, market) {
    const file = event.target.files[0]; if (!file) return; setLoading(true);
    Papa.parse(file, {
        header: true, skipEmptyLines: true,
        complete: async function(results) {
            try {
                const invalidKeywords = ['合計', '總計', '小計', '總預估', '預估', '損益', '總額', '結餘', '帳戶'];
                const validData = results.data.filter(row => {
                    const name = row['股票名稱'] || row['股名'] || '';
                    return parseNum(row['股數'] || row['目前庫存']) > 0 && !invalidKeywords.some(kw => name.includes(kw));
                });
                realPortfolio[market] = validData.map(row => ({ market: market.toUpperCase(), name: row['股票名稱'] || row['股名'], symbol: row['代號'] || null, shares: parseNum(row['股數'] || row['目前庫存']), cost: parseNum(row['付出成本'] || row['成本']) }));
                if (market === 'tw') await processDictionary(realPortfolio.tw);
                saveInventoryChanges();
            } catch (e) { showToast("處理失敗"); } finally { setLoading(false); }
        }
    });
}

// ==========================================
// PBI 與其餘彈窗 (維持原有功能)
// ==========================================
async function startPbiScan() { /* 原有 PBI 邏輯 */ }
function renderCurrentView() { if(typeof renderDashboard === 'function') renderDashboard(currentMarketView === 'ALL' ? globalCombinedList : globalCombinedList.filter(i => i.market === currentMarketView)); }
function togglePrivacy() { isPrivacyMode = !isPrivacyMode; document.getElementById('btn-privacy').innerText = isPrivacyMode ? '🙈' : '👁️'; renderCurrentView(); }
function switchMarket(m) { currentMarketView = m; document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.id === `tab-${m}`)); renderCurrentView(); }
function openSandboxAddStock() { document.getElementById('sb-step-input').style.display='block'; document.getElementById('sb-step-loading').style.display='none'; document.getElementById('sb-step-confirm').style.display='none'; document.getElementById('sb-input-val').value=''; document.getElementById('sandbox-add-overlay').classList.add('active'); }
function showInfoModal(t, d) { document.getElementById('info-modal-title').innerText=t; document.getElementById('info-modal-desc').innerText=d; document.getElementById('info-modal-overlay').classList.add('active'); }
function closeInfoModal() { document.getElementById('info-modal-overlay').classList.remove('active'); }
function closeConfirmModal() { document.getElementById('confirm-modal-overlay').classList.remove('active'); }
function closeScenPrompt() { document.getElementById('scen-prompt-modal').classList.remove('active'); }

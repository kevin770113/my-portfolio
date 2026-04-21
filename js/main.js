// ==========================================
// 全域狀態
// ==========================================
let isPrivacyMode = false; let currentRate = 32.5; let prevRate = 32.5; let latestDataTime = 0; 
let realPortfolio = { tw: [], us: [] }; let sandboxScenarios = []; let activeScenarioId = 'real'; 
let stockMapCache = {}; let globalCombinedList = []; let currentMarketView = 'ALL';
let pbiResults = []; let isPbiRunning = false;

// ==========================================
// 基礎工具
// ==========================================
function openDrawer() { document.getElementById('drawer-overlay').classList.add('show'); }
function closeDrawer() { document.getElementById('drawer-overlay').classList.remove('show'); }
function navigateTo(url) { closeDrawer(); setTimeout(() => { document.body.classList.add('fade-out'); setTimeout(() => { window.location.href = url; }, 400); }, 250); }
const fmtMoney = (n) => isPrivacyMode ? '****' : Math.round(n).toLocaleString();
const parseNum = (str) => { if (!str) return 0; const val = parseFloat(str.toString().replace(/,/g, '').replace('%', '')); return isNaN(val) ? 0 : val; };
const setLoading = (show, msg="數據處理中...") => { document.getElementById('loading-text').innerText = msg; document.getElementById('loading-overlay').style.display = show ? 'flex' : 'none'; };
function showToast(msg) { const t = document.getElementById('toast-container'); t.innerText = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2500); }

// ==========================================
// 初始化與生命週期
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('upload-tw').addEventListener('change', (e) => handleFileUpload(e, 'tw'));
    document.getElementById('upload-us').addEventListener('change', (e) => handleFileUpload(e, 'us'));

    const savedTW = localStorage.getItem('portfolio_tw'); 
    const savedUS = localStorage.getItem('portfolio_us'); 
    const savedScen = localStorage.getItem('invest_scenarios_v1');
    if (savedTW) realPortfolio.tw = JSON.parse(savedTW);
    if (savedUS) realPortfolio.us = JSON.parse(savedUS);
    if (savedScen) sandboxScenarios = JSON.parse(savedScen);

    updateScenarioUI();
    if (realPortfolio.tw.length || realPortfolio.us.length) { 
        setLoading(true); try { await updateFinanceData(); } finally { setLoading(false); } 
    } else { renderCurrentView(); }
    setTimeout(startPbiScan, 1000);
});

// ==========================================
// 核心數據處理
// ==========================================
async function updateFinanceData() {
    let symbols = new Set();
    [realPortfolio, ...sandboxScenarios.map(s => s.portfolio)].forEach(p => {
        p.tw.forEach(i => symbols.add(i.symbol)); p.us.forEach(i => symbols.add(i.symbol));
    });
    symbols.delete(null); symbols.delete('');
    
    if (symbols.size > 0) {
        try {
            const res = await fetch('/api/finance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbols: Array.from(symbols) }) });
            const json = await res.json();
            if (json.status === 'success') { stockMapCache = Object.assign(stockMapCache, json.data); currentRate = json.exchangeRate; prevRate = json.prevExchangeRate; }
        } catch(e) { showToast("報價連線異常"); }
    }
    
    latestDataTime = 0;
    const mapToCombined = (p) => [...p.tw, ...p.us].filter(i => i.symbol && i.symbol !== 'SKIP').map(item => {
        const m = stockMapCache[item.symbol]; if (!m) return null;
        if (m.regularMarketTime > latestDataTime) latestDataTime = m.regularMarketTime;
        const ex = item.market === 'US' ? currentRate : 1;
        const mv = m.price * item.shares * ex;
        return { ...item, currentPrice: m.price, marketValueTWD: mv, costTWD: item.cost * ex, dayChangeTWD: mv - ((m.price - m.change) * item.shares * (item.market === 'US' ? prevRate : 1)), cagr: m.cagr, stdev: m.stdev };
    }).filter(i => i);

    globalCombinedList = activeScenarioId === 'real' ? mapToCombined(realPortfolio) : mapToCombined(sandboxScenarios.find(s => s.id === activeScenarioId).portfolio);
    
    const dateEl = document.getElementById('data-date');
    if (latestDataTime > 0) {
        let d = new Date(latestDataTime * 1000);
        dateEl.innerText = `📅 ${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    }
    renderCurrentView();
}

// ==========================================
// UI 渲染與導航函式 (補回被刪除部分)
// ==========================================
function renderCurrentView() {
    let filtered = currentMarketView === 'ALL' ? globalCombinedList : globalCombinedList.filter(i => i.market === currentMarketView);
    
    let totalVal = filtered.reduce((s, i) => s + i.marketValueTWD, 0);
    let totalCost = filtered.reduce((s, i) => s + i.costTWD, 0);
    let dayChange = filtered.reduce((s, i) => s + i.dayChangeTWD, 0);
    
    document.getElementById('total-wealth').innerText = fmtMoney(totalVal);
    document.getElementById('total-roi').innerText = totalCost > 0 ? ((totalVal - totalCost)/totalCost*100).toFixed(2) + '%' : '0.00%';
    document.getElementById('day-change').innerText = (dayChange >= 0 ? '+' : '') + fmtMoney(dayChange);
    document.getElementById('day-change').className = 'card-value ' + (dayChange >= 0 ? 'profit' : 'loss');

    const grid = document.getElementById('stock-grid');
    grid.innerHTML = filtered.map(i => `
        <div class="stock-card">
            <div class="stock-name">${i.name}</div>
            <div class="stock-symbol">${i.symbol.split('.')[0]}</div>
            <div class="stock-price">$${i.currentPrice}</div>
            <div class="stock-roi ${i.marketValueTWD >= i.costTWD ? 'profit' : 'loss'}">${((i.marketValueTWD - i.costTWD)/i.costTWD*100).toFixed(2)}%</div>
        </div>
    `).join('');
}

function updateScenarioUI() {
    const list = document.getElementById('scenario-list');
    let html = `<div class="scenario-item ${activeScenarioId === 'real' ? 'active' : ''}" onclick="switchScenario('real')">📊 真實庫存</div>`;
    sandboxScenarios.forEach(sc => {
        html += `<div class="scenario-item ${activeScenarioId === sc.id ? 'active' : ''}" onclick="switchScenario('${sc.id}')">🧪 ${sc.name} <span onclick="deleteScenario(event, '${sc.id}')">×</span></div>`;
    });
    list.innerHTML = html;
}

function switchScenario(id) { activeScenarioId = id; updateScenarioUI(); updateFinanceData(); }
function togglePrivacy() { isPrivacyMode = !isPrivacyMode; document.getElementById('btn-privacy').innerText = isPrivacyMode ? '🙈' : '👁️'; renderCurrentView(); }
function switchMarket(m) { currentMarketView = m; document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.id === `tab-${m}`)); renderCurrentView(); }

// ==========================================
// 檔案與垃圾桶功能
// ==========================================
function askClearAllData() {
    if(confirm("確定要清空所有庫存資料嗎？")) {
        realPortfolio = { tw: [], us: [] };
        localStorage.removeItem('portfolio_tw'); localStorage.removeItem('portfolio_us');
        updateFinanceData();
    }
}

async function handleFileUpload(e, market) {
    const file = e.target.files[0]; if (!file) return; setLoading(true);
    Papa.parse(file, { header: true, skipEmptyLines: true, complete: async (res) => {
        try {
            const forbidden = ['合計', '總計', '小計', '預估', '損益'];
            const valid = res.data.filter(row => {
                const n = row['股票名稱'] || row['股名'] || '';
                return parseNum(row['股數'] || row['目前庫存']) > 0 && !forbidden.some(k => n.includes(k));
            });
            realPortfolio[market] = valid.map(r => ({ market: market.toUpperCase(), name: r['股票名稱'] || r['股名'], symbol: r['代號'] || null, shares: parseNum(r['股數'] || r['目前庫存']), cost: parseNum(r['成本'] || r['付出成本']) }));
            localStorage.setItem(`portfolio_${market}`, JSON.stringify(realPortfolio[market]));
            if(market === 'tw') await processDictionary(realPortfolio.tw);
            updateFinanceData();
        } catch(err) { showToast("處理失敗"); } finally { setLoading(false); }
    }});
}

// 彈窗關閉函式
function closeInfoModal() { document.getElementById('info-modal-overlay').classList.remove('active'); }
function closeConfirmModal() { document.getElementById('confirm-modal-overlay').classList.remove('active'); }

// PBI 模擬
async function startPbiScan() {
    const btn = document.getElementById('btn-pbi-signal');
    btn.innerText = "⚖️ 建議觀望"; btn.className = "btn-pbi wait";
}

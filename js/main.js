// ==========================================
// 全域變數宣告 (Global State)
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

// 全域歷史資料快取
window.historicalDataCache = {};

// PBI 恐慌抄底雷達專屬狀態
let pbiResults = [];
let isPbiRunning = false;

// ==========================================
// 基礎工具與導航 (Utilities & Navigation)
// ==========================================
function openDrawer() { document.getElementById('drawer-overlay').classList.add('show'); }
function closeDrawer() { document.getElementById('drawer-overlay').classList.remove('show'); }
function navigateTo(url) { 
    if (window.location.href.includes(url) || (url === 'index.html' && window.location.pathname.endsWith('/'))) { closeDrawer(); return; } 
    closeDrawer(); 
    setTimeout(() => { document.body.classList.add('fade-out'); setTimeout(() => { window.location.href = url; }, 400); }, 250); 
}

const fmtMoney = (n) => isPrivacyMode ? '****' : Math.round(n).toLocaleString();
const parseNum = (str) => { if (!str) return 0; const val = parseFloat(str.toString().replace(/,/g, '').replace('%', '')); return isNaN(val) ? 0 : val; };
const setLoading = (show, msg="正在分析金融數據...") => { 
    const textEl = document.getElementById('loading-text');
    const overlayEl = document.getElementById('loading-overlay');
    if (textEl) textEl.innerText = msg; 
    if (overlayEl) overlayEl.style.display = show ? 'flex' : 'none'; 
};
const generateId = () => Math.random().toString(36).substr(2, 9);

let toastTimeout;
function showToast(msg) { 
    const toast = document.getElementById('toast-container'); 
    if (!toast) return;
    toast.innerText = msg; 
    toast.classList.add('show'); 
    clearTimeout(toastTimeout); 
    toastTimeout = setTimeout(() => toast.classList.remove('show'), 2500); 
}

// ==========================================
// 系統初始化 (Initialization)
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
    const uploadTW = document.getElementById('upload-tw');
    const uploadUS = document.getElementById('upload-us');
    if (uploadTW) uploadTW.addEventListener('change', (e) => handleFileUpload(e, 'tw'));
    if (uploadUS) uploadUS.addEventListener('change', (e) => handleFileUpload(e, 'us'));

    window.addEventListener('resize', () => { 
        if (charts.corr) charts.corr.resize(); 
        if (charts.historyPnL) charts.historyPnL.resize(); 
    });

    const reportOverlay = document.getElementById('report-overlay');
    if (reportOverlay) {
        const observer = new ResizeObserver(entries => {
            for (let entry of entries) {
                if (entry.contentRect.width > 0 && reportOverlay.style.display === 'block') {
                    if (!isReportRendered) { 
                        if(typeof renderScatterChart === 'function') renderScatterChart(); 
                        if(typeof renderMCCompareChart === 'function') renderMCCompareChart(); 
                        isReportRendered = true; 
                    } else { 
                        if(charts.scatter) charts.scatter.resize(); 
                        if(charts.mcCompare) charts.mcCompare.resize(); 
                    }
                }
            }
        });
        observer.observe(reportOverlay);
    }

    const savedTW = localStorage.getItem('portfolio_tw'); 
    const savedUS = localStorage.getItem('portfolio_us'); 
    const savedScen = localStorage.getItem('invest_scenarios_v1');
    if (savedTW) try { realPortfolio.tw = JSON.parse(savedTW); } catch(e) {}
    if (savedUS) try { realPortfolio.us = JSON.parse(savedUS); } catch(e) {}
    if (savedScen) try { sandboxScenarios = JSON.parse(savedScen); } catch(e) {}

    const btnConfirmDanger = document.getElementById('btn-confirm-danger');
    if (btnConfirmDanger) btnConfirmDanger.onclick = () => { closeConfirmModal(); if(confirmCallback) confirmCallback(); };
    
    const btnScenConfirm = document.getElementById('scen-prompt-confirm');
    if (btnScenConfirm) btnScenConfirm.onclick = () => { closeScenPrompt(); if(promptCallback) promptCallback(document.getElementById('scen-prompt-input').value); };
    
    const btnSbCheck = document.getElementById('btn-sb-check');
    if (btnSbCheck) {
        btnSbCheck.onclick = async () => {
            const val = document.getElementById('sb-input-val').value.trim().toUpperCase(); if (!val) return;
            document.getElementById('sb-step-input').style.display = 'none'; document.getElementById('sb-step-loading').style.display = 'block';
            try {
                const res = await fetch('/api/finance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbols: [val] }) }); 
                if(!res.ok) throw new Error('API Error'); const json = await res.json();
                if (json.status === 'success' && json.data[val] && !json.data[val].error) { 
                    const data = json.data[val]; stockMapCache[val] = data; currentPromptPrice = data.price; 
                    document.getElementById('sb-yahoo-name').innerText = data.yahooName || val; 
                    document.getElementById('sb-yahoo-price').innerText = data.price; 
                    document.getElementById('sb-shares').value = ''; document.getElementById('sb-cost').value = ''; 
                    document.getElementById('sb-step-loading').style.display = 'none'; document.getElementById('sb-step-confirm').style.display = 'block'; 
                } else { 
                    showInfoModal('搜尋失敗', '查無此代號。', true); 
                    document.getElementById('sb-step-loading').style.display = 'none'; document.getElementById('sb-step-input').style.display = 'block'; 
                }
            } catch (e) { 
                showInfoModal('連線異常', '伺服器無回應。', true); 
                document.getElementById('sb-step-loading').style.display = 'none'; document.getElementById('sb-step-input').style.display = 'block'; 
            }
        };
    }

    const btnSbSave = document.getElementById('btn-sb-save');
    if (btnSbSave) {
        btnSbSave.onclick = () => {
            let shares = parseFloat(document.getElementById('sb-shares').value) || 0; 
            let finalCost = parseFloat(document.getElementById('sb-cost').value) || 0; 
            let symbol = document.getElementById('sb-input-val').value.trim().toUpperCase(); 
            let name = document.getElementById('sb-yahoo-name').innerText;
            if(shares <= 0) { showInfoModal('輸入錯誤', '請輸入正確股數。', true); return; }
            let sc = sandboxScenarios.find(s => s.id === activeScenarioId); 
            let market = symbol.includes('.TW') || symbol.includes('.TWO') ? 'tw' : 'us'; 
            sc.portfolio[market].push({ market: market.toUpperCase(), name: name, symbol: symbol, shares: shares, cost: finalCost });
            document.getElementById('sandbox-add-overlay').classList.remove('active'); 
            saveInventoryChanges(); 
        };
    }

    updateScenarioUI();
    
    if (realPortfolio.tw.length > 0 || realPortfolio.us.length > 0) { 
        setLoading(true); 
        try { await updateFinanceData(); } catch(e) { console.error(e); renderCurrentView(); } finally { setLoading(false); } 
    } else { renderCurrentView(); }

    setTimeout(() => { startPbiScan(); }, 1000);
});

// ==========================================
// 🚀 PBI 恐慌抄底雷達
// ==========================================
async function startPbiScan() {
    if (isPbiRunning) return;
    let symbolsToFetch = new Set();
    [realPortfolio.tw, realPortfolio.us].forEach(list => list.forEach(i => symbolsToFetch.add(i.symbol)));
    sandboxScenarios.forEach(sc => { 
        [sc.portfolio.tw, sc.portfolio.us].forEach(list => list.forEach(i => symbolsToFetch.add(i.symbol))); 
    });
    
    symbolsToFetch.delete(null); symbolsToFetch.delete(undefined); symbolsToFetch.delete('');
    let allSymbols = Array.from(symbolsToFetch);
    
    if (allSymbols.length === 0) {
        const chartEl = document.getElementById('historyPnLChart');
        if (chartEl) chartEl.innerHTML = '<div style="text-align: center; color: #999; padding-top: 160px; font-size: 12px;">無庫存資料，無法回測</div>';
        return;
    }

    isPbiRunning = true; pbiResults = [];
    const btn = document.getElementById('btn-pbi-signal');
    if (btn) { btn.className = 'btn-pbi loading'; btn.innerHTML = `⏳ 評估中 (0/${allSymbols.length})...`; btn.disabled = true; }

    for (let i = 0; i < allSymbols.length; i++) {
        const symbol = allSymbols[i];
        try {
            const res = await fetch(`/api/history?symbol=${symbol}`);
            if (res.ok) {
                const json = await res.json();
                if (json.data && Array.isArray(json.data)) {
                    window.historicalDataCache[symbol] = json.data;
                    if (window.pbiEngine) {
                        const result = window.pbiEngine.evaluate(json.data, symbol);
                        if (result) pbiResults.push(result);
                    }
                }
            }
        } catch (err) { console.error(`PBI Scan Error (${symbol}):`, err); }
        if (btn) btn.innerHTML = `⏳ 評估中 (${i + 1}/${allSymbols.length})...`;
        await new Promise(resolve => setTimeout(resolve, 400));
    }
    isPbiRunning = false; finishPbiScan();
}

function finishPbiScan() {
    const btn = document.getElementById('btn-pbi-signal');
    if (!btn) return;
    pbiResults.sort((a, b) => b.score - a.score);
    const hasBuySignal = pbiResults.some(r => r.score >= 60);
    if (hasBuySignal) { btn.className = 'btn-pbi trigger'; btn.innerHTML = '🚨 建議買入...'; btn.disabled = false; } 
    else { btn.className = 'btn-pbi wait'; btn.innerHTML = '⚖️ 建議觀望 (點擊看分數)'; btn.disabled = false; }
    renderPbiModalContent();
    if (typeof window.renderHistoryPnLChart === 'function') window.renderHistoryPnLChart();
}

function renderPbiModalContent() {
    const listEl = document.getElementById('pbi-signal-list');
    if (!listEl) return;
    let html = '';
    pbiResults.forEach((res, idx) => {
        let scoreColor = res.score >= 60 ? 'var(--red-profit)' : '#95A5A6';
        html += `
        <div class="pbi-item ${res.score >= 60 ? 'pbi-highlight' : 'pbi-dimmed'}">
            <div class="pbi-header" onclick="togglePbiAccordion(${idx})">
                <span class="pbi-symbol">${res.symbol.split('.')[0]} <span style="font-size: 11px; color: #999;">$${res.details.closePrice}</span></span>
                <div style="display:flex; align-items:center; gap:10px;">
                    <span style="font-size: 13px; font-weight: 800; color: ${scoreColor};">${res.score} 分</span>
                    <span class="pbi-badge ${res.colorClass}">${res.badge} ${res.action}</span>
                </div>
            </div>
            <div class="pbi-details" id="pbi-details-${idx}">
                <div class="pbi-factor"><span>⚡ KDJ 深度</span><span class="pbi-factor-val">+${res.details.kdj} 分</span></div>
                <div class="pbi-factor"><span>🔥 AMT 量能</span><span class="pbi-factor-val">+${res.details.amt} 分</span></div>
                <div class="pbi-factor"><span>📉 MACD 動能</span><span class="pbi-factor-val">+${res.details.macd} 分</span></div>
                <div class="pbi-factor"><span>🛡️ 240MA 乖離</span><span class="pbi-factor-val">${res.details.biasPct}%</span></div>
            </div>
        </div>`;
    });
    listEl.innerHTML = html;
}

window.openPbiModal = function() { 
    const el = document.getElementById('pbi-modal-overlay'); 
    el.style.display = 'flex'; 
    setTimeout(() => { el.classList.add('active'); }, 10); 
};
window.closePbiModal = function() { 
    const el = document.getElementById('pbi-modal-overlay'); 
    el.classList.remove('active'); 
    setTimeout(() => { el.style.display = 'none'; }, 300); 
};
window.togglePbiAccordion = function(idx) {
    const detailEl = document.getElementById(`pbi-details-${idx}`);
    const isOpen = detailEl.classList.contains('open');
    document.querySelectorAll('.pbi-details').forEach(el => el.classList.remove('open'));
    if (!isOpen) detailEl.classList.add('open');
};

// ==========================================
// 數據同步與更新 (Data Sync)
// ==========================================
async function updateFinanceData() {
    let symbolsToFetch = new Set();
    [realPortfolio.tw, realPortfolio.us].forEach(list => list.forEach(i => symbolsToFetch.add(i.symbol)));
    sandboxScenarios.forEach(sc => { 
        [sc.portfolio.tw, sc.portfolio.us].forEach(list => list.forEach(i => symbolsToFetch.add(i.symbol))); 
    });
    symbolsToFetch.delete(null); symbolsToFetch.delete(undefined); symbolsToFetch.delete('');
    
    let allSymbols = Array.from(symbolsToFetch);
    if (allSymbols.length > 0) {
        try {
            const res = await fetch('/api/finance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbols: allSymbols }) });
            if (!res.ok) throw new Error('API 連線失敗');
            const json = await res.json();
            if (json.status === 'success') { 
                stockMapCache = Object.assign(stockMapCache, json.data); 
                currentRate = json.exchangeRate || 32.5; 
                prevRate = json.prevExchangeRate || currentRate; 
            }
        } catch(e) { console.error('Fetch error:', e); showToast("⚠️ 報價伺服器連線異常"); }
    }
    
    const rateEl = document.getElementById('display-rate');
    if (rateEl) rateEl.innerText = currentRate.toFixed(2); 
    latestDataTime = 0; 

    const mapToCombined = (portfolio) => {
        let list = [...portfolio.tw, ...portfolio.us];
        return list.filter(item => item.symbol && item.symbol !== 'SKIP').map(item => {
            const m = stockMapCache[item.symbol]; 
            if (!m) return null; 
            
            if (m.regularMarketTime > latestDataTime) latestDataTime = m.regularMarketTime;
            
            const exRate = item.market === 'US' ? currentRate : 1; 
            const pastExRate = item.market === 'US' ? prevRate : 1;
            const marketValTWD = m.price * item.shares * exRate; 
            const costTWD = item.cost * exRate; 
            const prevPrice = m.price - m.change;
            const prevMarketValTWD = prevPrice * item.shares * pastExRate;

            return { 
                ...item, currentPrice: m.price, marketValueTWD: marketValTWD, costTWD: costTWD, 
                profitTWD: marketValTWD - costTWD, roi: costTWD > 0 ? (marketValTWD - costTWD) / costTWD : 0, 
                dayChangeTWD: marketValTWD - prevMarketValTWD, 
                ytd: m.ytd || 0, // ⭐️ 補回 YTD 數據通道
                cagr: m.cagr || 0, stdev: m.stdev || 0, 
                dividendYield: m.dividendYield || 0, 
                historicalDividends: m.historicalDividends || [],
                monthlyReturns: m.monthlyReturns || {}
            };
        }).filter(i => i !== null);
    };

    let realCombined = mapToCombined(realPortfolio);
    compareData.realGlobal = calcPortfolioMetrics(realCombined); 
    
    exportGlobalSyncData(realCombined);

    if(activeScenarioId === 'real') globalCombinedList = realCombined; 
    else { 
        let sc = sandboxScenarios.find(s => s.id === activeScenarioId); 
        globalCombinedList = mapToCombined(sc.portfolio); 
    }

    // ⭐️ 修正：防呆檢查 date-date 標籤是否存在
    const dateEl = document.getElementById('data-date');
    if (dateEl) {
        if (globalCombinedList.length > 0 && latestDataTime > 0) { 
            let d = new Date(latestDataTime * 1000); 
            let mm = (d.getMonth() + 1).toString().padStart(2, '0'); 
            let dd = d.getDate().toString().padStart(2, '0'); 
            dateEl.innerText = `📅 ${mm}/${dd}`; 
            dateEl.style.display = 'inline-block'; 
        } else { 
            dateEl.style.display = 'none'; 
        }
    }
    
    renderCurrentView();
}

function calcPortfolioMetrics(list) {
    let totalVal = list.reduce((s, i) => s + (i.marketValueTWD || 0), 0); 
    if (totalVal === 0) return { totalVal: 0, cagr: 0, stdev: 0 };
    let cagr = list.reduce((s, i) => s + ((i.cagr || 0) * (i.marketValueTWD || 0)), 0) / totalVal; 
    let stdev = typeof calculateMatrixRisk === 'function' ? calculateMatrixRisk(list, totalVal) : 0; 
    return { totalVal, cagr, stdev };
}

function exportGlobalSyncData(realList) {
    if (!realList || realList.length === 0) { localStorage.setItem('sync_invest_data', JSON.stringify({ totalValue: 0, cagr: 0, dividendYield: 0, timestamp: new Date().getTime() })); return; }
    let metrics = calcPortfolioMetrics(realList); let totalExpectedDividend = 0;
    realList.forEach(item => {
        const exRate = item.market === 'US' ? currentRate : 1;
        if (item.historicalDividends && item.historicalDividends.length > 0) {
            const now = new Date(); const startMonth = new Date(now.getFullYear(), now.getMonth() - 11, 1); const monthKeys = [];
            for (let i = 0; i < 24; i++) monthKeys.push(`${new Date(startMonth.getFullYear(), startMonth.getMonth() + i, 1).getFullYear()}-${(new Date(startMonth.getFullYear(), startMonth.getMonth() + i, 1).getMonth() + 1).toString().padStart(2, '0')}`);
            item.historicalDividends.forEach(div => { 
                const dDate = new Date(div.date * 1000); 
                const futureKey = `${dDate.getFullYear() + 1}-${(dDate.getMonth() + 1).toString().padStart(2, '0')}`; 
                if (monthKeys.indexOf(futureKey) >= 12) totalExpectedDividend += div.amount * item.shares * exRate; 
            });
        }
    });
    localStorage.setItem('sync_invest_data', JSON.stringify({ totalValue: metrics.totalVal, cagr: metrics.cagr, dividendYield: metrics.totalVal > 0 ? (totalExpectedDividend / metrics.totalVal) : 0, timestamp: new Date().getTime() }));
}

// ==========================================
// CSV 匯入與管理 (補回所有關鍵函式)
// ==========================================
async function handleFileUpload(event, market) {
    const file = event.target.files[0]; if (!file) return; setLoading(true);
    Papa.parse(file, {
        header: true, skipEmptyLines: true,
        complete: async function(results) {
            try {
                const rawData = results.data; 
                const forbidden = ['合計', '總計', '小計', '總預估', '預估', '損益', '總額', '帳戶'];
                const validData = rawData.filter(row => { 
                    const name = row['股票名稱'] || row['股名'] || ''; 
                    const parsedShares = parseNum(row['股數'] || row['目前庫存'] || '0'); 
                    return parsedShares > 0 && !forbidden.some(kw => name.includes(kw)) && name.trim() !== ''; 
                });
                
                let normalized = validData.map(row => ({
                    market: market.toUpperCase(),
                    name: row['股票名稱'] || row['股名'],
                    symbol: market === 'us' ? (row['代號'] || row['股票']) : null,
                    shares: parseNum(row['股數'] || row['目前庫存'] || row['餘股數']),
                    cost: parseNum(row['付出成本'] || row['成本'] || row['庫存成本'])
                }));
                
                realPortfolio[market] = normalized; 
                localStorage.setItem(`portfolio_${market}`, JSON.stringify(normalized)); 
                if (market === 'tw') await processDictionary(normalized); 
                await updateFinanceData();
                startPbiScan();
                showToast(`成功匯入 ${normalized.length} 筆資料`);
            } catch (err) { showInfoModal('處理失敗', err.message, true); } finally { setLoading(false); }
        }
    });
}

async function processDictionary(twList) {
    const names = twList.map(item => item.name); 
    try {
        const res = await fetch('/api/dictionary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ names }) }); 
        const dictMap = await res.json();
        for (let item of twList) { 
            if (dictMap[item.name]) item.symbol = dictMap[item.name]; 
            else { const input = await askForSymbol(item.name); item.symbol = input; } 
        }
    } catch(e) { console.error("Dictionary Sync Error"); }
    localStorage.setItem('portfolio_tw', JSON.stringify(twList));
}

function askForSymbol(stockName) {
    return new Promise((resolve) => {
        setLoading(false); const overlay = document.getElementById('csv-prompt-overlay'); 
        document.getElementById('csv-stock-name').innerText = stockName; 
        overlay.classList.add('active'); 
        document.getElementById('btn-csv-save').onclick = () => {
            const val = document.getElementById('csv-input-val').value.trim().toUpperCase();
            overlay.classList.remove('active'); setLoading(true); resolve(val || 'SKIP');
        };
    });
}

function askClearAllData() {
    openConfirmModal("清空資料", "確定要刪除所有本地庫存資料嗎？此操作無法還原。", "確認刪除", () => {
        realPortfolio = { tw: [], us: [] };
        localStorage.removeItem('portfolio_tw'); localStorage.removeItem('portfolio_us');
        updateFinanceData();
        showToast("資料已全數清空");
    });
}

// ==========================================
// 介面導覽與沙盒方案管理
// ==========================================
function togglePrivacy() { isPrivacyMode = !isPrivacyMode; document.getElementById('btn-privacy').innerText = isPrivacyMode ? '🙈' : '👁️'; renderCurrentView(); }

function switchMarket(market) { 
    currentMarketView = market; 
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.toggle('active', btn.id === `tab-${market}`)); 
    renderCurrentView(); 
}

function renderCurrentView() {
    if (typeof renderDashboard === 'function') {
        let filtered = currentMarketView === 'ALL' ? globalCombinedList : globalCombinedList.filter(i => i.market === currentMarketView);
        renderDashboard(filtered);
    }
}

function updateScenarioUI() {
    const listEl = document.getElementById('scenario-list'); if(!listEl) return;
    let html = `<div class="scenario-item ${activeScenarioId === 'real' ? 'active' : ''}" onclick="switchScenario('real')">📊 真實庫存</div>`;
    sandboxScenarios.forEach(sc => { 
        html += `<div class="scenario-item ${activeScenarioId === sc.id ? 'active' : ''}" onclick="switchScenario('${sc.id}')">🧪 ${sc.name} <span class="del-scen" onclick="deleteScenario(event, '${sc.id}')">×</span></div>`; 
    });
    listEl.innerHTML = html;
}

function switchScenario(id) { activeScenarioId = id; updateScenarioUI(); setLoading(true); updateFinanceData().finally(() => setLoading(false)); }

function deleteScenario(e, id) {
    e.stopPropagation();
    if(confirm("確定要刪除此沙盒方案嗎？")) {
        sandboxScenarios = sandboxScenarios.filter(s => s.id !== id);
        if(activeScenarioId === id) activeScenarioId = 'real';
        localStorage.setItem('invest_scenarios_v1', JSON.stringify(sandboxScenarios));
        updateScenarioUI(); updateFinanceData();
    }
}

function saveInventoryChanges() {
    if (activeScenarioId === 'real') {
        localStorage.setItem('portfolio_tw', JSON.stringify(realPortfolio.tw));
        localStorage.setItem('portfolio_us', JSON.stringify(realPortfolio.us));
    } else {
        localStorage.setItem('invest_scenarios_v1', JSON.stringify(sandboxScenarios));
    }
    updateFinanceData();
}

// ==========================================
// 彈窗與模式控制 (Modals)
// ==========================================
let confirmCallback = null;
function openConfirmModal(title, desc, btnText, callback) { 
    document.getElementById('confirm-modal-title').innerText = title; 
    document.getElementById('confirm-modal-desc').innerHTML = desc; 
    document.getElementById('btn-confirm-danger').innerText = btnText; 
    confirmCallback = callback; 
    document.getElementById('confirm-modal-overlay').classList.add('active'); 
}
function closeConfirmModal() { document.getElementById('confirm-modal-overlay').classList.remove('active'); }

let promptCallback = null;
function openScenPrompt(title, defaultText, callback) { 
    document.getElementById('scen-prompt-title').innerText = title; 
    document.getElementById('scen-prompt-input').value = defaultText || ''; 
    promptCallback = callback; 
    document.getElementById('scen-prompt-modal').classList.add('active'); 
}
function closeScenPrompt() { document.getElementById('scen-prompt-modal').classList.remove('active'); }

function showInfoModal(title, desc, isError = false) { 
    document.getElementById('info-modal-title').innerText = title; 
    document.getElementById('info-modal-desc').innerText = desc; 
    document.getElementById('info-modal-overlay').classList.add('active'); 
}
function closeInfoModal() { document.getElementById('info-modal-overlay').classList.remove('active'); }

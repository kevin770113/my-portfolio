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
let pendingAIWeights = null;
let nodeStatsMap = {}; 
let fullGalaxyNodes = []; 
let fullGalaxyLinks = []; 
let rawLinkData = []; 

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
    document.getElementById('loading-text').innerText = msg; 
    document.getElementById('loading-overlay').style.display = show ? 'flex' : 'none'; 
};
const generateId = () => Math.random().toString(36).substr(2, 9);

let toastTimeout;
function showToast(msg) { 
    const toast = document.getElementById('toast-container'); 
    toast.innerText = msg; 
    toast.classList.add('show'); 
    clearTimeout(toastTimeout); 
    toastTimeout = setTimeout(() => toast.classList.remove('show'), 2500); 
}

// ==========================================
// 系統初始化 (Initialization)
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('upload-tw').addEventListener('change', (e) => handleFileUpload(e, 'tw'));
    document.getElementById('upload-us').addEventListener('change', (e) => handleFileUpload(e, 'us'));

    window.addEventListener('resize', () => { 
        if (charts.corr) charts.corr.resize(); 
        if (charts.historyPnL) charts.historyPnL.resize(); 
    });

    const reportOverlay = document.getElementById('report-overlay');
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
            if(!res.ok) throw new Error('API Error'); const json = await res.json();
            if (json.status === 'success' && json.data[val] && !json.data[val].error) { 
                const data = json.data[val]; stockMapCache[val] = data; currentPromptPrice = data.price; 
                document.getElementById('sb-yahoo-name').innerText = data.yahooName || val; 
                document.getElementById('sb-yahoo-price').innerText = data.price; 
                document.getElementById('sb-shares').value = ''; document.getElementById('sb-cost').value = ''; 
                document.getElementById('sb-step-loading').style.display = 'none'; document.getElementById('sb-step-confirm').style.display = 'block'; 
            } else { 
                showInfoModal('搜尋失敗', 'Yahoo Finance 查無此代號。', true); 
                document.getElementById('sb-step-loading').style.display = 'none'; document.getElementById('sb-step-input').style.display = 'block'; 
            }
        } catch (e) { 
            showInfoModal('連線異常', '伺服器無回應。', true); 
            document.getElementById('sb-step-loading').style.display = 'none'; document.getElementById('sb-step-input').style.display = 'block'; 
        }
    };
    document.getElementById('btn-sb-retry').onclick = openSandboxAddStock;
    document.getElementById('btn-sb-save').onclick = () => {
        let shares = parseFloat(document.getElementById('sb-shares').value) || 0; 
        let finalCost = parseFloat(document.getElementById('sb-cost').value) || 0; 
        let symbol = document.getElementById('sb-input-val').value.trim().toUpperCase(); 
        let name = document.getElementById('sb-yahoo-name').innerText;
        if(shares <= 0 || finalCost < 0) { showInfoModal('輸入錯誤', '請輸入大於 0 的股數。', true); return; }
        let sc = sandboxScenarios.find(s => s.id === activeScenarioId); 
        let market = symbol.includes('.TW') || symbol.includes('.TWO') ? 'tw' : 'us'; 
        sc.portfolio[market].push({ market: market.toUpperCase(), name: name, symbol: symbol, shares: shares, cost: finalCost });
        document.getElementById('sandbox-add-overlay').classList.remove('active'); 
        saveInventoryChanges(); 
    };

    updateScenarioUI();
    
    if (realPortfolio.tw.length > 0 || realPortfolio.us.length > 0) { 
        setLoading(true); 
        try { await updateFinanceData(); } catch(e) { console.error(e); if(typeof renderCurrentView === 'function') renderCurrentView(); } finally { setLoading(false); } 
    } else { if(typeof renderCurrentView === 'function') renderCurrentView(); }

    setTimeout(() => { startPbiScan(); }, 1000);
});

// ==========================================
// 🚀 PBI 恐慌抄底雷達
// ==========================================
async function startPbiScan() {
    if (isPbiRunning) return;
    let symbolsToFetch = new Set();
    realPortfolio.tw.forEach(i => symbolsToFetch.add(i.symbol)); 
    realPortfolio.us.forEach(i => symbolsToFetch.add(i.symbol));
    sandboxScenarios.forEach(sc => { sc.portfolio.tw.forEach(i => symbolsToFetch.add(i.symbol)); sc.portfolio.us.forEach(i => symbolsToFetch.add(i.symbol)); });
    symbolsToFetch.delete(null); symbolsToFetch.delete(undefined); symbolsToFetch.delete('SKIP'); symbolsToFetch.delete('');
    let allSymbols = Array.from(symbolsToFetch);
    if (allSymbols.length === 0) {
        document.getElementById('historyPnLChart').innerHTML = '<div style="text-align: center; color: #999; padding-top: 160px; font-size: 12px;">無庫存資料，無法回測</div>';
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
                    json.data.symbol = symbol; 
                    if (window.pbiEngine) {
                        const result = window.pbiEngine.evaluate(json.data);
                        if (result) pbiResults.push(result);
                    }
                }
            }
        } catch (err) { console.error(`PBI Scan Error on ${symbol}:`, err); }
        if (btn) btn.innerHTML = `⏳ 評估中 (${i + 1}/${allSymbols.length})...`;
        await new Promise(resolve => setTimeout(resolve, 600));
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
        let badgeClass = res.badge === '🔴' ? 'red' : (res.badge === '🟡' ? 'yellow' : (res.badge === '🟢' ? 'green' : ''));
        let highlightClass = res.score >= 60 ? 'pbi-highlight' : 'pbi-dimmed';
        let detailsHtml = res.error ? `<div style="text-align:center; padding: 15px 0; color: #95A5A6;">⚠️ 此標的歷史資料不足。</div>` : `
                <div class="pbi-factor"><span>⚡ KDJ 深度</span><span class="pbi-factor-val">+${res.details.kdj} 分</span></div>
                <div class="pbi-factor"><span>🔥 AMT 量能</span><span class="pbi-factor-val">+${res.details.amt} 分</span></div>
                <div class="pbi-factor"><span>📉 MACD 動能</span><span class="pbi-factor-val">+${res.details.macd} 分</span></div>
                <div class="pbi-factor"><span>🛡️ 240MA 防護</span><span class="pbi-factor-val">乖離 ${res.details.biasPct}%</span></div>
                <div class="pbi-factor" style="margin-top: 8px; padding-top: 8px; border-top: 1px dashed #eee;"><span>🏆 總結算</span><span class="pbi-factor-val ${res.colorClass}" style="font-size: 14px;">${res.score} 分</span></div>
            `;
        let scoreDisplay = res.error ? '--' : res.score;
        let scoreColor = res.score >= 60 ? 'var(--red-profit)' : '#95A5A6';
        html += `
        <div class="pbi-item ${highlightClass}">
            <div class="pbi-header" onclick="togglePbiAccordion(${idx})">
                <span class="pbi-symbol">${res.symbol.replace('.TW', '')} <span style="font-size: 11px; color: #999;">今收: $${res.details.closePrice}</span></span>
                <div style="display:flex; align-items:center; gap:10px;">
                    <span style="font-size: 13px; font-weight: 800; color: ${scoreColor};">${scoreDisplay} 分</span>
                    <span class="pbi-badge ${badgeClass}">${res.badge} ${res.action}</span>
                </div>
            </div>
            <div class="pbi-details" id="pbi-details-${idx}">${detailsHtml}</div>
        </div>`;
    });
    listEl.innerHTML = html;
}

window.openPbiModal = function() { const el = document.getElementById('pbi-modal-overlay'); el.style.display = 'flex'; setTimeout(() => { el.classList.add('active'); }, 10); };
window.closePbiModal = function() { const el = document.getElementById('pbi-modal-overlay'); el.classList.remove('active'); setTimeout(() => { el.style.display = 'none'; }, 300); };
window.togglePbiAccordion = function(idx) {
    const detailEl = document.getElementById(`pbi-details-${idx}`);
    if (detailEl.classList.contains('open')) detailEl.classList.remove('open');
    else { document.querySelectorAll('.pbi-details').forEach(el => el.classList.remove('open')); detailEl.classList.add('open'); }
};

// ==========================================
// 數據同步與更新 (Data Sync)
// ==========================================
async function updateFinanceData() {
    let symbolsToFetch = new Set();
    realPortfolio.tw.forEach(i => symbolsToFetch.add(i.symbol)); 
    realPortfolio.us.forEach(i => symbolsToFetch.add(i.symbol));
    sandboxScenarios.forEach(sc => { sc.portfolio.tw.forEach(i => symbolsToFetch.add(i.symbol)); sc.portfolio.us.forEach(i => symbolsToFetch.add(i.symbol)); });
    symbolsToFetch.delete(null); symbolsToFetch.delete(undefined); symbolsToFetch.delete('SKIP'); symbolsToFetch.delete('');
    
    let allSymbols = Array.from(symbolsToFetch);
    if (allSymbols.length > 0) {
        try {
            const res = await fetch('/api/finance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbols: allSymbols }) });
            if (!res.ok) throw new Error('API 連線失敗');
            const json = await res.json();
            if (json.status === 'success') { 
                stockMapCache = Object.assign(stockMapCache, json.data); 
                if(json.exchangeRate) currentRate = json.exchangeRate; 
                if(json.prevExchangeRate) prevRate = json.prevExchangeRate; 
                else prevRate = currentRate; 
            }
        } catch(e) { console.error('Fetch error:', e); showToast("⚠️ 報價伺服器連線異常"); }
    }
    
    document.getElementById('display-rate').innerText = currentRate.toFixed(2); 
    latestDataTime = 0; // 重置最新數據時間戳

    const mapToCombined = (portfolio) => {
        let list = [...portfolio.tw, ...portfolio.us];
        return list.filter(item => item.symbol && item.symbol !== 'SKIP').map(item => {
            const m = stockMapCache[item.symbol]; 
            if (!m) return { ...item, marketValueTWD: 0, costTWD: 0, cagr: 0 }; 
            
            // ⭐️ 更新全域最新數據時間 (取所有持股中最晚的那筆)
            if (m.regularMarketTime && m.regularMarketTime > latestDataTime) latestDataTime = m.regularMarketTime;
            
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
                ytd: m.ytd || 0, cagr: m.cagr, stdev: m.stdev, 
                dividendTWD: (m.dividendYield * (m.price * item.shares)) * exRate, 
                yield: m.dividendYield, historicalDividends: m.historicalDividends || [], market: item.market 
            };
        }).filter(i => i.marketValueTWD > 0);
    };

    let realCombined = mapToCombined(realPortfolio);
    compareData.realGlobal = calcPortfolioMetrics(realCombined); 
    compareData.realTW = calcPortfolioMetrics(realCombined.filter(i => i.market === 'TW')); 
    compareData.realUS = calcPortfolioMetrics(realCombined.filter(i => i.market === 'US'));
    compareData.sandboxList = sandboxScenarios.map(sc => { return { id: sc.id, name: sc.name, metrics: calcPortfolioMetrics(mapToCombined(sc.portfolio)) }; });
    
    exportGlobalSyncData(realCombined);

    if(activeScenarioId === 'real') globalCombinedList = realCombined; 
    else { let sc = sandboxScenarios.find(s => s.id === activeScenarioId); globalCombinedList = mapToCombined(sc.portfolio); }

    // ⭐️ 核心修改：格式化並顯示真實資料時間 (月/日 時:分)
    const dateEl = document.getElementById('data-date');
    if (globalCombinedList.length > 0 && latestDataTime > 0) { 
        let d = new Date(latestDataTime * 1000); 
        let mm = (d.getMonth() + 1).toString().padStart(2, '0'); 
        let dd = d.getDate().toString().padStart(2, '0'); 
        let hh = d.getHours().toString().padStart(2, '0');
        let min = d.getMinutes().toString().padStart(2, '0');
        dateEl.innerText = `📅 ${mm}/${dd} ${hh}:${min}`; 
        dateEl.style.display = 'inline-block'; 
    } else { 
        dateEl.style.display = 'none'; 
    }
    
    if(typeof renderCurrentView === 'function') renderCurrentView();
}

// ==========================================
// 其餘功能函式 (計算、CSV、UI、AI)
// ==========================================
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

async function handleFileUpload(event, market) {
    const file = event.target.files[0]; if (!file) return; setLoading(true);
    Papa.parse(file, {
        header: true, skipEmptyLines: true,
        complete: async function(results) {
            try {
                const rawData = results.data; const invalidKeywords = ['合計', '總計', '小計'];
                const validData = rawData.filter(row => { 
                    const name = row['股票名稱'] || row['股名'] || ''; 
                    const parsedShares = parseNum(row['股數'] || row['目前庫存'] || '0'); 
                    return parsedShares > 0 && !invalidKeywords.some(kw => name.includes(kw)) && name.trim() !== ''; 
                });
                let normalized = market === 'tw' ? validData.map(row => ({ market: 'TW', name: row['股票名稱'] || row['股名'], symbol: null, shares: parseNum(row['股數'] || row['餘股數']), cost: parseNum(row['付出成本'] || row['成本']) })) : validData.map(row => ({ market: 'US', name: row['股票名稱'] || row['股名'], symbol: row['代號'] || row['股票'], shares: parseNum(row['目前庫存'] || row['股數']), cost: parseNum(row['庫存成本'] || row['成本']) }));
                realPortfolio[market] = normalized; localStorage.setItem(`portfolio_${market}`, JSON.stringify(normalized)); 
                document.getElementById(`label-${market}`).innerText = `✅ 匯入 (${normalized.length})`; 
                if (market === 'tw') await processDictionary(normalized); await updateFinanceData();
                startPbiScan();
            } catch (err) { showInfoModal('處理失敗', err.message, true); } finally { setLoading(false); }
        }
    });
}

async function processDictionary(twList) {
    const names = twList.map(item => item.name); const res = await fetch('/api/dictionary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ names }) }); const dictMap = await res.json();
    for (let item of twList) { 
        if (dictMap[item.name]) item.symbol = dictMap[item.name]; 
        else { const input = await askForSymbol(item.name); item.symbol = input; if (input !== 'SKIP') await fetch('/api/dictionary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ update: { name: item.name, symbol: input } }) }); } 
    }
    localStorage.setItem('portfolio_tw', JSON.stringify(twList));
}

function askForSymbol(stockName) {
    return new Promise((resolve) => {
        setLoading(false); const overlay = document.getElementById('csv-prompt-overlay'); 
        document.getElementById('csv-stock-name').innerText = stockName; document.getElementById('csv-input-val').value = ''; 
        overlay.classList.add('active'); let currentTestSymbol = ''; const cleanup = () => { overlay.classList.remove('active'); setLoading(true); };
        document.getElementById('btn-csv-skip').onclick = () => { cleanup(); resolve('SKIP'); };
        document.getElementById('btn-csv-check').onclick = async () => {
            const val = document.getElementById('csv-input-val').value.trim().toUpperCase(); if (!val) return;
            currentTestSymbol = val; document.getElementById('csv-step-input').style.display = 'none'; document.getElementById('csv-step-loading').style.display = 'block';
            try {
                const res = await fetch('/api/finance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbols: [val] }) }); 
                const json = await res.json();
                if (json.status === 'success' && json.data[val] && !json.data[val].error) { 
                    document.getElementById('csv-yahoo-name').innerText = json.data[val].yahooName || val; 
                    document.getElementById('csv-yahoo-price').innerText = json.data[val].price; 
                    document.getElementById('csv-step-loading').style.display = 'none'; document.getElementById('csv-step-confirm').style.display = 'block'; 
                } else { showInfoModal('搜尋失敗', 'Yahoo Finance 查無此代號。', true); document.getElementById('csv-step-loading').style.display = 'none'; document.getElementById('csv-step-input').style.display = 'block'; }
            } catch (e) { showInfoModal('連線異常', '伺服器無回應。', true); document.getElementById('csv-step-loading').style.display = 'none'; document.getElementById('csv-step-input').style.display = 'block'; }
        };
        document.getElementById('btn-csv-retry').onclick = () => { document.getElementById('csv-step-confirm').style.display = 'none'; document.getElementById('csv-step-input').style.display = 'block'; }; 
        document.getElementById('btn-csv-save').onclick = () => { cleanup(); resolve(currentTestSymbol); };
    });
}

function togglePrivacy() { isPrivacyMode = !isPrivacyMode; document.getElementById('btn-privacy').innerHTML = isPrivacyMode ? '🙈' : '👁️'; if(typeof renderCurrentView === 'function') renderCurrentView(); showToast(isPrivacyMode ? "隱私模式已開啟" : "隱私模式已關閉"); }

function switchMarket(market) { currentMarketView = market; document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active')); document.getElementById(`tab-${market}`).classList.add('active'); if(typeof renderCurrentView === 'function') renderCurrentView(); showToast(`已切換至 ${market === 'ALL' ? '全球總覽' : market}`); }

function renderCurrentView() {
    if (globalCombinedList.length === 0) { if(typeof renderDashboard === 'function') renderDashboard([]); return; }
    let filteredList = currentMarketView !== 'ALL' ? globalCombinedList.filter(item => item.market === currentMarketView) : globalCombinedList;
    if(typeof renderDashboard === 'function') renderDashboard(filteredList);
    if(typeof window.renderHistoryPnLChart === 'function') window.renderHistoryPnLChart();
}

// ==========================================
// 彈窗系統
// ==========================================
let confirmCallback = null;
function openConfirmModal(title, desc, btnText, callback) { document.getElementById('confirm-modal-title').innerText = title; document.getElementById('confirm-modal-desc').innerHTML = desc; document.getElementById('btn-confirm-danger').innerText = btnText; confirmCallback = callback; document.getElementById('confirm-modal-overlay').classList.add('active'); }
function closeConfirmModal() { document.getElementById('confirm-modal-overlay').classList.remove('active'); }

let promptCallback = null;
function openScenPrompt(title, defaultText, callback) { document.getElementById('scen-prompt-title').innerText = title; document.getElementById('scen-prompt-input').value = defaultText || ''; promptCallback = callback; document.getElementById('scen-prompt-modal').classList.add('active'); setTimeout(() => document.getElementById('scen-prompt-input').focus(), 100); }
function closeScenPrompt() { document.getElementById('scen-prompt-modal').classList.remove('active'); }

let infoCallback = null;
function showInfoModal(title, desc, isError = false, callback = null) { 
    document.getElementById('info-modal-title').innerText = title; 
    document.getElementById('info-modal-desc').innerHTML = desc; 
    let icon = document.getElementById('info-modal-icon');
    if(isError) { icon.innerText = '!'; icon.style.background = '#FDECEA'; icon.style.color = '#B25858'; } 
    else { icon.innerText = '✓'; icon.style.background = '#E8F5E9'; icon.style.color = '#4E8765'; }
    infoCallback = callback; 
    document.getElementById('info-modal-overlay').classList.add('active'); 
}
function closeInfoModal() { document.getElementById('info-modal-overlay').classList.remove('active'); if (infoCallback) { let cb = infoCallback; infoCallback = null; cb(); } }

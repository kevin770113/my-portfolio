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

// 微任務 A (匯入管線) 的全域暫存與對帳變數
let pendingImportFile = null;
let pendingImportMarket = '';
let pendingCSVChunk = '';
let pendingHeaders = [];
let pendingExpectedCount = 0;
let pendingSkippedCount = 0;

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
    document.getElementById('btn-sb-save').onclick = async () => {
        let shares = parseFloat(document.getElementById('sb-shares').value) || 0; 
        let finalCost = parseFloat(document.getElementById('sb-cost').value) || 0; 
        let symbol = document.getElementById('sb-input-val').value.trim().toUpperCase(); 
        let name = document.getElementById('sb-yahoo-name').innerText;
        if(shares <= 0 || finalCost < 0) { showInfoModal('輸入錯誤', '請輸入大於 0 的股數。', true); return; }
        let market = symbol.includes('.TW') || symbol.includes('.TWO') ? 'tw' : 'us'; 
        
        if (activeScenarioId === 'real') {
            realPortfolio[market].push({ market: market.toUpperCase(), name: name, symbol: symbol, shares: shares, cost: finalCost });
            localStorage.setItem(`portfolio_${market}`, JSON.stringify(realPortfolio[market]));
            document.getElementById('sandbox-add-overlay').classList.remove('active'); 
            openInventoryManager();
            setLoading(true);
            await updateFinanceData();
            setLoading(false);
            showToast("✅ 已新增至真實持股");
        } else {
            let sc = sandboxScenarios.find(s => s.id === activeScenarioId); 
            sc.portfolio[market].push({ market: market.toUpperCase(), name: name, symbol: symbol, shares: shares, cost: finalCost });
            document.getElementById('sandbox-add-overlay').classList.remove('active'); 
            saveInventoryChanges(); 
        }
    };

    // 方案 C：還原收合歷史狀態
    const savedAIState = localStorage.getItem('ai_briefing_collapsed_state');
    if (savedAIState === 'collapsed') {
        const content = document.getElementById('ai-briefing-content');
        const collapsed = document.getElementById('ai-briefing-collapsed');
        const icon = document.getElementById('ai-toggle-icon');
        if (content && collapsed && icon) {
            content.style.display = 'none';
            collapsed.style.display = 'block';
            icon.innerText = '＋';
        }
    }

    updateScenarioUI();
    
    if (realPortfolio.tw.length > 0 || realPortfolio.us.length > 0) { 
        setLoading(true); 
        try { 
            await updateFinanceData(); 
        } catch(e) { 
            console.error(e); 
            if(typeof renderCurrentView === 'function') renderCurrentView(); 
        } finally { 
            setLoading(false); 
        } 
    } else { 
        if(typeof renderCurrentView === 'function') renderCurrentView(); 
    }

    setTimeout(() => {
        startPbiScan();
    }, 1000);
});

// ==========================================
// 🚀 PBI 恐慌抄底雷達 (背景非同步佇列)
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
        let hChart = document.getElementById('historyPnLChart');
        if (hChart) hChart.innerHTML = '<div style="text-align: center; color: #999; padding-top: 160px; font-size: 12px;">無庫存資料，無法回測</div>';
        return;
    }

    isPbiRunning = true;
    pbiResults = [];
    
    const btn = document.getElementById('btn-pbi-signal');
    if (btn) {
        btn.className = 'btn-pbi loading';
        btn.innerHTML = `⏳ 評估中 (0/${allSymbols.length})...`;
        btn.disabled = true;
    }

    for (let i = 0; i < allSymbols.length; i++) {
        const symbol = allSymbols[i];
        try {
            const res = await fetch(`/api/history?symbol=${symbol}`);
            if (res.ok) {
                const json = await res.json();
                if (json.data && Array.isArray(json.data)) {
                    json.data.symbol = symbol; 
                    window.historicalDataCache[symbol] = json.data;
                    
                    if (window.pbiEngine) {
                        const result = window.pbiEngine.evaluate(json.data);
                        if (result) {
                            pbiResults.push(result);
                        }
                    }
                }
            }
        } catch (err) {
            console.error(`PBI Scan Error on ${symbol}:`, err);
        }

        if (btn) {
            btn.innerHTML = `⏳ 評估中 (${i + 1}/${allSymbols.length})...`;
        }
        await new Promise(resolve => setTimeout(resolve, 600));
    }

    isPbiRunning = false;
    finishPbiScan();
}

function finishPbiScan() {
    const btn = document.getElementById('btn-pbi-signal');
    if (!btn) return;

    pbiResults.sort((a, b) => b.score - a.score);
    const hasBuySignal = pbiResults.some(r => r.score >= 60);

    if (hasBuySignal) {
        btn.className = 'btn-pbi trigger';
        btn.innerHTML = '🚨 建議買入...';
        btn.disabled = false;
    } else {
        btn.className = 'btn-pbi wait';
        btn.innerHTML = '⚖️ 建議觀望 (點擊看分數)';
        btn.disabled = false; 
    }
    
    renderPbiModalContent();

    if (typeof window.renderHistoryPnLChart === 'function') {
        window.renderHistoryPnLChart();
    }
}

function renderPbiModalContent() {
    const listEl = document.getElementById('pbi-signal-list');
    if (!listEl) return;
    
    let html = '';
    pbiResults.forEach((res, idx) => {
        let badgeClass = res.badge === '🔴' ? 'red' : (res.badge === '🟡' ? 'yellow' : (res.badge === '🟢' ? 'green' : ''));
        let highlightClass = res.score >= 60 ? 'pbi-highlight' : 'pbi-dimmed';
        
        let detailsHtml = '';
        if (res.error) {
            detailsHtml = `<div style="text-align:center; padding: 15px 0; color: #95A5A6;">⚠️ 此標的歷史資料不足 (上市未滿 30 天)，暫無法進行運算。</div>`;
        } else {
            detailsHtml = `
                <div class="pbi-factor"><span>⚡ KDJ 深度</span><span class="pbi-factor-val">+${res.details.kdj} 分</span></div>
                <div class="pbi-factor"><span>🔥 AMT 量能</span><span class="pbi-factor-val">+${res.details.amt} 分</span></div>
                <div class="pbi-factor"><span>📉 MACD 動能</span><span class="pbi-factor-val">+${res.details.macd} 分</span></div>
                <div class="pbi-factor"><span>🛡️ 240MA 防護</span><span class="pbi-factor-val">乖離 ${res.details.biasPct}% (倍數 x${res.details.biasMultiplier})</span></div>
                <div class="pbi-factor" style="margin-top: 8px; padding-top: 8px; border-top: 1px dashed #eee;"><span>🏆 總結算</span><span class="pbi-factor-val ${res.colorClass}" style="font-size: 14px;">${res.score} 分</span></div>
            `;
        }

        let scoreDisplay = res.error ? '--' : res.score;
        let scoreColor = res.score >= 60 ? 'var(--red-profit)' : '#95A5A6';

        html += `
        <div class="pbi-item ${highlightClass}">
            <div class="pbi-header" onclick="togglePbiAccordion(${idx})">
                <span class="pbi-symbol">${res.symbol.replace('.TW', '')} <span style="font-size: 11px; color: #999; font-weight: normal; margin-left: 5px;">今收: $${res.details.closePrice}</span></span>
                <div style="display:flex; align-items:center; gap:10px;">
                    <span style="font-size: 13px; font-weight: 800; color: ${scoreColor};">${scoreDisplay} 分</span>
                    <span class="pbi-badge ${badgeClass}" style="${res.badge === '⚪' ? 'background:#AAB7B8;' : ''}">${res.badge} ${res.action}</span>
                </div>
            </div>
            <div class="pbi-details" id="pbi-details-${idx}">
                ${detailsHtml}
            </div>
        </div>
        `;
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
    if (detailEl.classList.contains('open')) {
        detailEl.classList.remove('open');
    } else {
        document.querySelectorAll('.pbi-details').forEach(el => el.classList.remove('open'));
        detailEl.classList.add('open');
    }
};

// ==========================================
// 彈窗系統 (Modals)
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
    setTimeout(() => document.getElementById('scen-prompt-input').focus(), 100); 
}
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
function closeInfoModal() { 
    document.getElementById('info-modal-overlay').classList.remove('active'); 
    if (infoCallback) { let cb = infoCallback; infoCallback = null; cb(); } 
}

// ==========================================
// 劇本切換系統 (Scenario Management)
// ==========================================
function openScenModal() {
    document.getElementById('scen-list').innerHTML = '';
    let html = `<div class="scen-item" style="${activeScenarioId === 'real' ? 'background:rgba(0,86,179,0.05); font-weight:bold;' : ''}"><div class="scen-name" onclick="switchScenario('real')">🌍 真實持股 (鎖定) ${activeScenarioId === 'real' ? '✅' : ''}</div></div>`;
    sandboxScenarios.forEach(sc => { 
        let isAct = activeScenarioId === sc.id; 
        html += `<div class="scen-item" style="${isAct ? 'background:rgba(245,166,35,0.05); font-weight:bold;' : ''}"><div class="scen-name" onclick="switchScenario('${sc.id}')">🧪 ${sc.name} ${isAct ? '✅' : ''}</div><div class="scen-actions"><button class="scen-btn" onclick="renameScenario('${sc.id}')">✏️</button><button class="scen-btn" onclick="deleteScenario('${sc.id}')">🗑️</button></div></div>`; 
    });
    document.getElementById('scen-list').innerHTML = html; 
    document.getElementById('scen-overlay').classList.add('active'); 
    setTimeout(() => document.getElementById('scen-sheet').classList.add('show'), 10);
}
function closeScenModal() { 
    document.getElementById('scen-sheet').classList.remove('show'); 
    setTimeout(() => document.getElementById('scen-overlay').classList.remove('active'), 300); 
}
function createNewScenario() { 
    closeScenModal(); 
    openScenPrompt("請輸入新試算劇本名稱：", "我的實驗組合", (name) => { 
        if(name && name.trim()){ 
            const newId = generateId(); 
            sandboxScenarios.push({ id: newId, name: name.trim(), portfolio: { tw: JSON.parse(JSON.stringify(realPortfolio.tw)), us: JSON.parse(JSON.stringify(realPortfolio.us)) } }); 
            saveScenarios(); 
            switchScenario(newId); 
            showToast("已建立新劇本！"); 
        } 
    }); 
}
function renameScenario(id) { 
    closeScenModal(); 
    let sc = sandboxScenarios.find(s => s.id === id); 
    openScenPrompt("重新命名劇本：", sc.name, (name) => { 
        if(name && name.trim()){ 
            sc.name = name.trim(); 
            saveScenarios(); 
            updateScenarioUI(); 
        } 
    }); 
}
function deleteScenario(id) { 
    openConfirmModal("刪除劇本", "確定要刪除這個試算劇本嗎？", "確定刪除", () => { 
        sandboxScenarios = sandboxScenarios.filter(s => s.id !== id); 
        saveScenarios(); 
        if(activeScenarioId === id) switchScenario('real'); 
        else closeScenModal(); 
    }); 
}
async function switchScenario(id) { 
    activeScenarioId = id; 
    updateScenarioUI(); 
    closeScenModal(); 
    setLoading(true); 
    await updateFinanceData(); 
    setLoading(false); 
    if(id !== 'real') showToast("進入試算模式"); 
}
function saveScenarios() { localStorage.setItem('invest_scenarios_v1', JSON.stringify(sandboxScenarios)); }
function updateScenarioUI() {
    const bar = document.getElementById('scenario-bar'); 
    const rowUpload = document.getElementById('row-upload'); 
    const btnInv = document.getElementById('btn-inventory');
    if(activeScenarioId === 'real') { 
        bar.innerHTML = "📂 目前模式：真實持股 (鎖定) ▾"; 
        bar.className = "scenario-bar"; 
        if (rowUpload) rowUpload.style.display = "flex"; 
        if (btnInv) btnInv.innerHTML = "⚙️ 庫存校正"; 
    } else { 
        let sc = sandboxScenarios.find(s => s.id === activeScenarioId); 
        bar.innerHTML = `🧪 試算中：${sc.name} ▾`; 
        bar.className = "scenario-bar sandbox"; 
        if (rowUpload) rowUpload.style.display = "none"; 
        if (btnInv) btnInv.innerHTML = "✏️ 調整持股"; 
    }
}

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
        } catch(e) { 
            console.error('Fetch error:', e); 
            showToast("⚠️ 報價伺服器連線異常，目前使用快取資料"); 
        }
    }
    
    const displayRateEl = document.getElementById('display-rate');
    if (displayRateEl) displayRateEl.innerText = currentRate.toFixed(2); 
    latestDataTime = 0;

    const mapToCombined = (portfolio) => {
        let list = [...portfolio.tw, ...portfolio.us];
        return list.filter(item => item.symbol && item.symbol !== 'SKIP').map(item => {
            const m = stockMapCache[item.symbol]; 
            if (!m) return { ...item, marketValueTWD: 0, costTWD: 0, cagr: 0 }; 
            if (m.regularMarketTime && m.regularMarketTime > latestDataTime) latestDataTime = m.regularMarketTime;
            
            const exRate = item.market === 'US' ? currentRate : 1; 
            const pastExRate = item.market === 'US' ? prevRate : 1;
            
            const marketValTWD = m.price * item.shares * exRate; 
            const costTWD = item.cost * exRate; 
            
            let safeChangePercent = m.changePercent !== undefined ? m.changePercent : 0;
            if (safeChangePercent > 0.3 || safeChangePercent < -0.3) {
                safeChangePercent = 0;
            }
            
            const prevPrice = m.price / (1 + safeChangePercent);
            const prevMarketValTWD = prevPrice * item.shares * pastExRate;
            const trueDayChangeTWD = marketValTWD - prevMarketValTWD;

            return { 
                ...item, 
                currentPrice: m.price, 
                marketValueTWD: marketValTWD, 
                costTWD: costTWD, 
                profitTWD: marketValTWD - costTWD, 
                roi: costTWD > 0 ? (marketValTWD - costTWD) / costTWD : 0, 
                dayChangeTWD: trueDayChangeTWD, 
                ytd: m.ytd || 0, 
                cagr: m.cagr, 
                stdev: m.stdev, 
                dividendTWD: (m.dividendYield * (m.price * item.shares)) * exRate, 
                yield: m.dividendYield, 
                historicalDividends: m.historicalDividends || [], 
                market: item.market 
            };
        }).filter(i => i.marketValueTWD > 0);
    };

    let realCombined = mapToCombined(realPortfolio);
    compareData.realGlobal = calcPortfolioMetrics(realCombined); 
    compareData.realTW = calcPortfolioMetrics(realCombined.filter(i => i.market === 'TW')); 
    compareData.realUS = calcPortfolioMetrics(realCombined.filter(i => i.market === 'US'));
    compareData.sandboxList = sandboxScenarios.map(sc => { return { id: sc.id, name: sc.name, metrics: calcPortfolioMetrics(mapToCombined(sc.portfolio)) }; });
    
    exportGlobalSyncData(realCombined);

    if(activeScenarioId === 'real') { globalCombinedList = realCombined; } 
    else { let sc = sandboxScenarios.find(s => s.id === activeScenarioId); globalCombinedList = mapToCombined(sc.portfolio); }

    const dateEl = document.getElementById('data-date');
    if (dateEl) {
        if (globalCombinedList.length > 0) { 
            let d = latestDataTime > 0 ? new Date(latestDataTime * 1000) : new Date(); 
            let mm = (d.getMonth() + 1).toString().padStart(2, '0'); 
            let dd = d.getDate().toString().padStart(2, '0'); 
            dateEl.innerText = `📅 ${mm}/${dd}`; 
            dateEl.style.display = 'inline-block'; 
        } else { 
            dateEl.style.display = 'none'; 
        }
    }
    
    if(typeof renderCurrentView === 'function') renderCurrentView();

    if (typeof fetchAIBriefing === 'function') {
        fetchAIBriefing();
    }
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
// 方案 C：混合渲染與冷卻快取邏輯 (修復崩潰問題)
// ==========================================
function getLocalMarketStatus() {
    const now = new Date();
    const hour = now.getHours();
    const min = now.getMinutes();
    const day = now.getDay(); 
    
    let greeting = "";
    if (hour >= 5 && hour < 11) greeting = "早安。";
    else if (hour >= 11 && hour < 14) greeting = "午安。";
    else if (hour >= 14 && hour < 18) greeting = "傍晚好。";
    else greeting = "晚上好。";

    let twStatus = (day >= 1 && day <= 5) ? ((hour * 100 + min >= 900 && hour * 100 + min <= 1330) ? "盤中交易中" : "已收盤") : "週末休市";
    let usStatus = (day >= 1 && day <= 6) ? (((hour * 100 + min >= 2130) || (hour * 100 + min <= 500)) ? "盤中交易中" : "盤前休市狀態") : "週末休市";

    return `${greeting}目前台北股市${twStatus}；美國股市為${usStatus}。`;
}

async function fetchAIBriefing(force = false) {
    const card = document.getElementById('ai-briefing-card');
    const localStatusEl = document.getElementById('ai-local-status');
    const remoteTextEl = document.getElementById('ai-remote-text');
    const previewEl = document.getElementById('ai-collapsed-preview');
    
    if (!card || globalCombinedList.length === 0) { 
        if (card) card.style.display = 'none'; 
        return; 
    }
    card.style.display = 'block';
    
    const localStatus = getLocalMarketStatus();
    if (localStatusEl) localStatusEl.innerText = localStatus;
    
    if (previewEl) previewEl.innerText = localStatus + " 量化模型簡報已更新完畢。";
    
    const cacheKey = 'ai_briefing_cache_v1';
    const cacheData = localStorage.getItem(cacheKey);
    const nowMs = Date.now();
    const nowDateObj = new Date(); // 修復：獨立 Date 物件用於時間提取
    const cooldown = 15 * 60 * 1000; 

    if (!force && cacheData) {
        try {
            const parsed = JSON.parse(cacheData);
            if (nowMs - parsed.timestamp < cooldown) {
                if (remoteTextEl) remoteTextEl.innerText = parsed.text;
                return;
            }
        } catch(e) {
            localStorage.removeItem(cacheKey);
        }
    }

    if (remoteTextEl) {
        remoteTextEl.innerHTML = '<span class="ai-loading-text">正在進行量化矩陣演算與生成...</span>';
    }
    
    const totalValue = globalCombinedList.reduce((a, b) => a + (b.marketValueTWD || 0), 0);
    const totalCost = globalCombinedList.reduce((a, b) => a + (b.costTWD || 0), 0);
    const dayChange = globalCombinedList.reduce((a, b) => a + (b.dayChangeTWD || 0), 0);
    const dayChangePct = totalValue > 0 ? (dayChange / totalValue) * 100 : 0;
    
    let weightedYTD = 0, weightedCAGR = 0;
    globalCombinedList.forEach(i => {
        let w = totalValue > 0 ? (i.marketValueTWD / totalValue) : 0;
        if (i.ytd) weightedYTD += i.ytd * w;
        if (i.cagr) weightedCAGR += i.cagr * w;
    });

    let matrixStdev = typeof calculateMatrixRisk === 'function' ? calculateMatrixRisk(globalCombinedList, totalValue) : 0;
    
    const startMonth = new Date(nowDateObj.getFullYear(), nowDateObj.getMonth() - 11, 1);
    const monthKeys = [];
    for (let i = 0; i < 24; i++) {
        const d = new Date(startMonth.getFullYear(), startMonth.getMonth() + i, 1);
        monthKeys.push(`${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,'0')}`);
    }
    
    let totalExpectedDividend = 0;
    globalCombinedList.forEach(stock => {
        if (stock.historicalDividends && stock.historicalDividends.length > 0) {
            stock.historicalDividends.forEach(div => {
                const dDate = new Date(div.date * 1000);
                const futureKey = `${dDate.getFullYear() + 1}-${(dDate.getMonth() + 1).toString().padStart(2, '0')}`;
                if (monthKeys.indexOf(futureKey) >= 12) {
                    totalExpectedDividend += div.amount * stock.shares * (stock.market === 'US' ? currentRate : 1);
                }
            });
        }
    });
    const dividendYield = totalValue > 0 ? (totalExpectedDividend / totalValue) * 100 : 0;

    try {
        const payload = {
            totalValueTWD: Math.round(totalValue),
            dayChangeTWD: Math.round(dayChange),
            dayChangePct: Number(dayChangePct.toFixed(2)),
            ytdPct: Number((weightedYTD * 100).toFixed(2)),
            cagr: Number((weightedCAGR * 100).toFixed(2)),
            stdev: Number((matrixStdev * 100).toFixed(2)),
            dividendYield: Number(dividendYield.toFixed(2))
        };

        const res = await fetch('/api/ai-summary', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!res.ok) throw new Error("後端 API 異常");
        const json = await res.json();
        
        if (json.status === 'success' && json.data && json.data.summary) {
            const aiText = json.data.summary;
            if (remoteTextEl) remoteTextEl.innerText = aiText;
            
            localStorage.setItem(cacheKey, JSON.stringify({
                text: aiText,
                timestamp: nowMs
            }));
        } else {
            throw new Error("解析失敗");
        }
    } catch(err) {
        console.error(err);
        if (remoteTextEl) remoteTextEl.innerText = "量化分析模組暫時無法連線，請稍後重試。";
    }
}

window.toggleAIBriefing = function() {
    const content = document.getElementById('ai-briefing-content');
    const collapsed = document.getElementById('ai-briefing-collapsed');
    const icon = document.getElementById('ai-toggle-icon');
    
    if (!content || !collapsed || !icon) return;

    if (content.style.display === 'none') {
        content.style.display = 'block';
        collapsed.style.display = 'none';
        icon.innerText = '✕';
        localStorage.setItem('ai_briefing_collapsed_state', 'expanded');
    } else {
        content.style.display = 'none';
        collapsed.style.display = 'block';
        icon.innerText = '＋';
        localStorage.setItem('ai_briefing_collapsed_state', 'collapsed');
    }
};

window.forceRefreshAIBriefing = function() {
    fetchAIBriefing(true);
    const content = document.getElementById('ai-briefing-content');
    const collapsed = document.getElementById('ai-briefing-collapsed');
    const icon = document.getElementById('ai-toggle-icon');
    if (content && collapsed && icon) {
        content.style.display = 'block';
        collapsed.style.display = 'none';
        icon.innerText = '✕';
        localStorage.setItem('ai_briefing_collapsed_state', 'expanded');
    }
};

// ==========================================
// CSV 匯入與字典解析 (AI 智慧解析引擎與防呆)
// ==========================================
async function handleFileUpload(event, market) {
    const file = event.target.files[0]; 
    if (!file) return; 
    
    pendingImportFile = file;
    pendingImportMarket = market;
    
    const reader = new FileReader();
    reader.onload = function(e) {
        const text = e.target.result;
        const lines = text.split('\n');
        pendingCSVChunk = lines.slice(0, 20).join('\n');
        
        Papa.parse(pendingCSVChunk, {
            header: true,
            preview: 1,
            skipEmptyLines: true,
            complete: function(res) {
                pendingHeaders = res.meta.fields || [];
                checkPrivacyAndParse();
            }
        });
    };
    reader.readAsText(file);
    
    event.target.value = ''; 
}

async function checkPrivacyAndParse() {
    const consented = localStorage.getItem('ai_privacy_consented');
    if (!consented) {
        const el = document.getElementById('privacy-consent-overlay');
        el.style.display = 'flex';
        setTimeout(() => { el.classList.add('active'); }, 10);
    } else {
        await startAIParsing();
    }
}

window.acceptPrivacyConsent = function() {
    localStorage.setItem('ai_privacy_consented', 'true');
    const el = document.getElementById('privacy-consent-overlay');
    el.classList.remove('active');
    setTimeout(() => { el.style.display = 'none'; }, 300);
    startAIParsing();
};

window.cancelPrivacyConsent = function() {
    const el = document.getElementById('privacy-consent-overlay');
    el.classList.remove('active');
    setTimeout(() => { el.style.display = 'none'; }, 300);
    pendingImportFile = null;
    showToast("已取消匯入");
};

async function startAIParsing() {
    setLoading(true, "AI 智慧解析表頭中...");
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);
    
    try {
        const res = await fetch('/api/parser', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ csvChunk: pendingCSVChunk }),
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        
        if (!res.ok) {
            throw new Error(res.status === 500 ? "API_ERROR" : "PARSE_FAILED");
        }
        
        const json = await res.json();
        
        if (json.status === 'success' && json.data && json.data.nameColumn && json.data.sharesColumn) {
            Papa.parse(pendingCSVChunk, {
                header: true,
                skipEmptyLines: true,
                complete: function(results) {
                    const sampleData = results.data;
                    let validSharesCount = 0;
                    
                    for (let i = 0; i < Math.min(5, sampleData.length); i++) {
                        let rawVal = sampleData[i][json.data.sharesColumn];
                        if (rawVal !== undefined) {
                            const testVal = parseNum(rawVal);
                            if (testVal > 0 && !isNaN(testVal)) {
                                validSharesCount++;
                            }
                        }
                    }
                    
                    if (validSharesCount === 0 && sampleData.length > 0) {
                        setLoading(false);
                        showManualMappingModal("AI 猜測的欄位無法通過數值驗證，請您親自確認。", json.data.nameColumn, json.data.sharesColumn);
                    } else {
                        showToast(`🤖 AI 已自動辨識：【${json.data.nameColumn}】/【${json.data.sharesColumn}】`);
                        executeCSVImport(json.data.nameColumn, json.data.sharesColumn);
                    }
                }
            });
        } else {
            throw new Error("PARSE_FAILED");
        }
    } catch (err) {
        clearTimeout(timeoutId);
        let reason = "AI 解析異常或格式無法辨識";
        if (err.name === 'AbortError') reason = "AI 伺服器回應逾時 (超過 12 秒)";
        else if (err.message === 'API_ERROR') reason = "伺服器內部錯誤";
        
        setLoading(false);
        showManualMappingModal(reason);
    }
}

function showManualMappingModal(reason, defaultNameCol = null, defaultSharesCol = null) {
    document.getElementById('manual-mapping-desc').innerText = `系統提示：${reason}\n請協助手動指定欄位，完成本次匯入。`;
    
    const nameSelect = document.getElementById('map-name-select');
    const sharesSelect = document.getElementById('map-shares-select');
    nameSelect.innerHTML = '';
    sharesSelect.innerHTML = '';
    
    pendingHeaders.forEach(h => {
        nameSelect.innerHTML += `<option value="${h}" ${h === defaultNameCol ? 'selected' : ''}>${h}</option>`;
        sharesSelect.innerHTML += `<option value="${h}" ${h === defaultSharesCol ? 'selected' : ''}>${h}</option>`;
    });
    
    const el = document.getElementById('manual-mapping-overlay');
    el.style.display = 'flex';
    setTimeout(() => { el.classList.add('active'); }, 10);
}

window.confirmManualMapping = function() {
    const nCol = document.getElementById('map-name-select').value;
    const sCol = document.getElementById('map-shares-select').value;
    
    const el = document.getElementById('manual-mapping-overlay');
    el.classList.remove('active');
    setTimeout(() => { el.style.display = 'none'; }, 300);
    
    setLoading(true, "資料處理中...");
    executeCSVImport(nCol, sCol);
};

window.cancelManualMapping = function() {
    const el = document.getElementById('manual-mapping-overlay');
    el.classList.remove('active');
    setTimeout(() => { el.style.display = 'none'; }, 300);
    pendingImportFile = null;
    showToast("已取消匯入");
};

function executeCSVImport(nameCol, sharesCol) {
    Papa.parse(pendingImportFile, {
        header: true, 
        skipEmptyLines: true,
        complete: async function(results) {
            try {
                const rawData = results.data; 
                const invalidKeywords = ['合計', '總計', '說明', '證券', '帳戶', '警語', '免責', '總預估', '現值', '損益', '小計'];
                
                const validData = rawData.filter(row => { 
                    const name = row[nameCol] || ''; 
                    const parsedShares = parseNum(row[sharesCol] || '0'); 
                    if (parsedShares <= 0) return false; 
                    if (invalidKeywords.some(kw => name.includes(kw))) return false; 
                    if (!name.trim()) return false; 
                    return true; 
                });
                
                pendingExpectedCount = validData.length;
                pendingSkippedCount = 0;
                
                let normalized = pendingImportMarket === 'tw' ? validData.map(row => ({ 
                    market: 'TW', 
                    name: row[nameCol], 
                    symbol: null, 
                    shares: parseNum(row[sharesCol]), 
                    cost: parseNum(row['付出成本'] || row['成本'] || row['投資本金'] || row['買進成本'] || row['買價'] || row['庫存成本'] || '0') 
                })) : validData.map(row => ({ 
                    market: 'US', 
                    name: row[nameCol], 
                    symbol: row['代號'] || row['股票'] || row['Ticker'] || row['Symbol'] || row['商品名稱'] || row['商品代碼'] || '', 
                    shares: parseNum(row[sharesCol]), 
                    cost: parseNum(row['庫存成本'] || row['成本'] || row['付出成本'] || row['投資本金'] || row['買進成本'] || '0') 
                }));
                
                realPortfolio[pendingImportMarket] = normalized; 
                localStorage.setItem(`portfolio_${pendingImportMarket}`, JSON.stringify(normalized)); 
                document.getElementById(`label-${pendingImportMarket}`).innerText = `✅ 匯入 (${normalized.length})`; 
                
                if (pendingImportMarket === 'tw') await processDictionary(normalized); 
                await updateFinanceData();
                
                const actualList = globalCombinedList.filter(item => item.market.toUpperCase() === pendingImportMarket.toUpperCase());
                const actualCount = actualList.length;
                const finalExpected = pendingExpectedCount - pendingSkippedCount;
                
                if (finalExpected === actualCount) {
                    let marketStr = pendingImportMarket === 'tw' ? '台股' : '美股';
                    let skipStr = pendingSkippedCount > 0 ? ` (${pendingSkippedCount} 筆已略過)` : '';
                    showToast(`✅ 成功匯入 ${actualCount} 筆${marketStr}${skipStr}，報價同步完成`);
                } else {
                    document.getElementById('reconciliation-desc').innerText = `本次匯入應有 ${finalExpected} 檔，但實際僅成功渲染 ${actualCount} 檔。可能有 ${finalExpected - actualCount} 檔標的 API 報價連線失敗或市值為 0。\n\n請前往『庫存校正中心』確認未顯示的標的。`;
                    const el = document.getElementById('reconciliation-modal-overlay');
                    el.style.display = 'flex';
                    setTimeout(() => { el.classList.add('active'); }, 10);
                }
                
                isPbiRunning = false;
                startPbiScan();

            } catch (err) { 
                showInfoModal('處理失敗', err.message, true); 
            } finally { 
                setLoading(false); 
                pendingImportFile = null;
            }
        }
    });
}

window.closeReconciliationModal = function() {
    const el = document.getElementById('reconciliation-modal-overlay');
    el.classList.remove('active');
    setTimeout(() => { el.style.display = 'none'; }, 300);
};

window.goToInventoryFromReconciliation = function() {
    closeReconciliationModal();
    openInventoryManager();
};

async function processDictionary(twList) {
    const names = twList.map(item => item.name); const res = await fetch('/api/dictionary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ names }) }); const dictMap = await res.json();
    for (let item of twList) { 
        if (dictMap[item.name]) { 
            item.symbol = dictMap[item.name]; 
        } else { 
            const input = await askForSymbol(item.name); 
            item.symbol = input; 
            if (input !== 'SKIP') {
                await fetch('/api/dictionary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ update: { name: item.name, symbol: input } }) }); 
            } else {
                pendingSkippedCount++;
            }
        } 
    }
    localStorage.setItem('portfolio_tw', JSON.stringify(twList));
}

function askForSymbol(stockName) {
    return new Promise((resolve) => {
        setLoading(false); const overlay = document.getElementById('csv-prompt-overlay'); 
        document.getElementById('csv-stock-name').innerText = stockName; document.getElementById('csv-input-val').value = ''; 
        document.getElementById('csv-step-input').style.display = 'block'; document.getElementById('csv-step-loading').style.display = 'none'; document.getElementById('csv-step-confirm').style.display = 'none';
        overlay.classList.add('active'); let currentTestSymbol = ''; const cleanup = () => { overlay.classList.remove('active'); setLoading(true); };
        document.getElementById('btn-csv-skip').onclick = () => { cleanup(); resolve('SKIP'); };
        document.getElementById('btn-csv-check').onclick = async () => {
            const val = document.getElementById('csv-input-val').value.trim().toUpperCase(); if (!val) return;
            currentTestSymbol = val; document.getElementById('csv-step-input').style.display = 'none'; document.getElementById('csv-step-loading').style.display = 'block';
            try {
                const res = await fetch('/api/finance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbols: [val] }) }); 
                if (!res.ok) throw new Error('HTTP ' + res.status); const json = await res.json();
                if (json.status === 'success' && json.data[val] && !json.data[val].error) { 
                    document.getElementById('csv-yahoo-name').innerText = json.data[val].yahooName || val; 
                    document.getElementById('csv-yahoo-price').innerText = json.data[val].price; 
                    document.getElementById('csv-step-loading').style.display = 'none'; document.getElementById('csv-step-confirm').style.display = 'block'; 
                } 
                else { showInfoModal('搜尋失敗', 'Yahoo Finance 查無此代號。', true); document.getElementById('csv-step-loading').style.display = 'none'; document.getElementById('csv-step-input').style.display = 'block'; }
            } catch (e) { showInfoModal('連線異常', '伺服器無回應。', true); document.getElementById('csv-step-loading').style.display = 'none'; document.getElementById('csv-step-input').style.display = 'block'; }
        };
        document.getElementById('btn-csv-retry').onclick = () => { document.getElementById('csv-step-confirm').style.display = 'none'; document.getElementById('csv-step-input').style.display = 'block'; }; 
        document.getElementById('btn-csv-save').onclick = () => { cleanup(); resolve(currentTestSymbol); };
    });
}

// ==========================================
// 庫存管理與沙盒操作 (Inventory & Sandbox)
// ==========================================
window.openInventoryManager = function() {
    const container = document.getElementById('inventory-list-container'); 
    if (!container) return;
    
    container.innerHTML = '';
    let portfolio = activeScenarioId === 'real' ? realPortfolio : sandboxScenarios.find(s => s.id === activeScenarioId).portfolio;
    
    document.getElementById('btn-inv-add-stock').style.display = 'inline-block'; 
    document.getElementById('btn-ai-entry').style.display = activeScenarioId === 'real' ? 'none' : 'flex';
    document.getElementById('inv-modal-title').innerText = activeScenarioId === 'real' ? '⚙️ 庫存校正中心 (真實持股)' : '✏️ 試算持股調整'; 
    document.getElementById('inv-modal-desc').innerText = activeScenarioId === 'real' ? '手動調整真實持股的股數或成本，或補齊短少標的。' : '自由新增或刪除股票，或啟動 AI 智能配置。';

    const renderList = (market, list) => {
        if(!list || list.length === 0) return; 
        let html = `<div style="font-weight:bold; margin: 15px 0 8px; color: var(--primary-dark); font-size: 15px; border-bottom: 2px solid #eaeaea; padding-bottom: 4px;">${market === 'tw' ? '🇹🇼 台股' : '🇺🇸 美股'}</div>`;
        list.forEach((item, index) => {
            html += `<div class="inv-item"><div class="inv-item-header"><span>${item.name} <span style="color:#999; font-weight:normal; font-size:12px;">(${item.symbol})</span></span></div><button class="btn-del-stock" onclick="removeStock('${market}', ${index})">✕</button><div class="inv-input-group"><div class="inv-input-box"><span class="inv-input-label">總持有成本 (原幣)</span><input type="number" class="inv-input-field num" id="inv-cost-${market}-${index}" value="${item.cost}" step="any"></div><div class="inv-input-box"><span class="inv-input-label">目前股數</span><input type="number" class="inv-input-field num" id="inv-shares-${market}-${index}" value="${item.shares}" step="any"></div></div></div>`;
        }); 
        container.innerHTML += html;
    };
    renderList('tw', portfolio.tw); 
    renderList('us', portfolio.us);
    
    if(portfolio.tw.length === 0 && portfolio.us.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding: 30px 20px; color:#999;">無資料。</div>';
    }
    document.getElementById('inventory-modal-overlay').classList.add('active');
}

window.closeInventoryManager = function() { 
    document.getElementById('inventory-modal-overlay').classList.remove('active'); 
}

window.saveInventoryChanges = async function() {
    const updateList = (market, list) => { 
        if(!list) return; 
        list.forEach((item, index) => { 
            const sInp = document.getElementById(`inv-shares-${market}-${index}`); 
            const cInp = document.getElementById(`inv-cost-${market}-${index}`); 
            if(sInp && cInp) { item.shares = parseFloat(sInp.value) || 0; item.cost = parseFloat(cInp.value) || 0; } 
        }); 
    };
    if(activeScenarioId === 'real') { 
        updateList('tw', realPortfolio.tw); updateList('us', realPortfolio.us); 
        localStorage.setItem('portfolio_tw', JSON.stringify(realPortfolio.tw)); localStorage.setItem('portfolio_us', JSON.stringify(realPortfolio.us)); 
    } else { 
        let sc = sandboxScenarios.find(s => s.id === activeScenarioId); 
        updateList('tw', sc.portfolio.tw); updateList('us', sc.portfolio.us); saveScenarios(); 
    }
    closeInventoryManager(); setLoading(true); try { await updateFinanceData(); showToast("✅ 組合已更新並重新計算"); } catch (err) {} finally { setLoading(false); }
}

window.removeStock = async function(market, index) { 
    if(activeScenarioId === 'real') {
        realPortfolio[market].splice(index, 1);
        localStorage.setItem(`portfolio_${market}`, JSON.stringify(realPortfolio[market]));
        openInventoryManager();
        setLoading(true);
        await updateFinanceData();
        setLoading(false);
        showToast("✅ 已刪除真實持股標的");
    } else {
        let sc = sandboxScenarios.find(s => s.id === activeScenarioId); 
        if(sc) { sc.portfolio[market].splice(index, 1); saveScenarios(); openInventoryManager(); } 
    }
}

window.openSandboxAddStock = function() { 
    closeInventoryManager(); const overlay = document.getElementById('sandbox-add-overlay'); 
    document.getElementById('sb-step-input').style.display = 'block'; document.getElementById('sb-step-confirm').style.display = 'none'; document.getElementById('sb-input-val').value = ''; overlay.classList.add('active'); 
}
window.closeSandboxAddStock = function() { 
    document.getElementById('sandbox-add-overlay').classList.remove('active'); openInventoryManager(); 
}

// ==========================================
// 主畫面控制 (UI Toggles)
// ==========================================
function askClearAllData() { 
    openConfirmModal("警告", "確定要清空所有真實持股資料嗎？<br><br>這將移除儀表板上的所有紀錄。", "確定清空", () => { 
        localStorage.removeItem('portfolio_tw'); localStorage.removeItem('portfolio_us'); 
        realPortfolio = { tw: [], us: [] }; globalCombinedList = []; 
        document.getElementById('label-tw').innerText = '📁 匯入台股'; document.getElementById('label-us').innerText = '📁 匯入美股'; 
        exportGlobalSyncData([]); 
        if(typeof renderCurrentView === 'function') renderCurrentView(); 
        showToast('已清空所有資料'); 
    }); 
}

function togglePrivacy() { 
    isPrivacyMode = !isPrivacyMode; 
    document.getElementById('btn-privacy').innerHTML = isPrivacyMode ? '🙈' : '👁️'; 
    if(typeof renderCurrentView === 'function') renderCurrentView(); 
    showToast(isPrivacyMode ? "隱私模式已開啟" : "隱私模式已關閉"); 
}

// ==========================================
// 市場切換與最佳化 UI (Market View & AI Opt)
// ==========================================
function switchMarket(market) { 
    currentMarketView = market; 
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active')); 
    document.getElementById(`tab-${market}`).classList.add('active'); 
    if(typeof renderCurrentView === 'function') renderCurrentView(); 
    let name = market === 'ALL' ? '全球總覽' : (market === 'TW' ? '台股' : '美股'); 
    showToast(`已切換至 ${name}`); 
}

function renderCurrentView() {
    if (globalCombinedList.length === 0) { 
        if(typeof renderDashboard === 'function') renderDashboard([]); 
        return; 
    }
    let filteredList = currentMarketView !== 'ALL' ? globalCombinedList.filter(item => item.market === currentMarketView) : globalCombinedList;
    if(typeof renderDashboard === 'function') renderDashboard(filteredList);
    
    if(typeof window.renderHistoryPnLChart === 'function') {
        window.renderHistoryPnLChart();
    }
}

window.selectAIOpt = function(el) { 
    document.querySelectorAll('.ai-opt-card').forEach(card => card.classList.remove('active')); 
    el.classList.add('active'); document.getElementById('ai-opt-objective').value = el.getAttribute('data-val'); 
}
window.openAIOptimizer = function() { 
    closeInventoryManager(); let sc = sandboxScenarios.find(s => s.id === activeScenarioId); 
    let totalStocks = sc.portfolio.tw.length + sc.portfolio.us.length; 
    if(totalStocks < 2) { 
        showInfoModal("⚠️ 資料不足", "至少需要 2 檔不同的股票才能啟動最佳化引擎！", true, () => { openInventoryManager(); }); 
        return; 
    } 
    document.getElementById('ai-opt-modal').classList.add('active'); 
}
window.closeAIOptimizer = function() { document.getElementById('ai-opt-modal').classList.remove('active'); openInventoryManager(); }
window.closeAIResult = function() { document.getElementById('ai-res-modal').classList.remove('active'); document.getElementById('ai-opt-modal').classList.add('active'); }

window.applyAIWeights = function() {
    if(!pendingAIWeights) return; 
    let sc = sandboxScenarios.find(s => s.id === activeScenarioId); 
    let totalVal = 0; 
    pendingAIWeights.stocks.forEach(s => { let exRate = s.market === 'US' ? currentRate : 1; totalVal += s.shares * stockMapCache[s.symbol].price * exRate; });
    
    pendingAIWeights.stocks.forEach((s, idx) => { 
        let targetValTWD = totalVal * pendingAIWeights.weights[idx]; 
        let exRate = s.market === 'US' ? currentRate : 1; 
        let targetShares = targetValTWD / (stockMapCache[s.symbol].price * exRate); 
        let targetCost = targetValTWD / exRate; 
        let item = sc.portfolio.tw.find(x => x.symbol === s.symbol) || sc.portfolio.us.find(x => x.symbol === s.symbol); 
        if(item) { item.shares = parseFloat(targetShares.toFixed(4)); item.cost = parseFloat(targetCost.toFixed(2)); } 
    });
    
    saveScenarios(); 
    document.getElementById('ai-res-modal').classList.remove('active'); 
    setLoading(true); 
    updateFinanceData().then(() => { setLoading(false); showToast("✅ 配置套用成功！"); });
}

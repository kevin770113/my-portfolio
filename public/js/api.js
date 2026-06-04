import { state } from './state.js';
import { showToast } from './utils.js';

// ==========================================
// 數據同步與更新 (Data Sync)
// ==========================================
export async function updateFinanceData() {
    let symbolsToFetch = new Set();
    state.realPortfolio.tw.forEach(i => symbolsToFetch.add(i.symbol)); 
    state.realPortfolio.us.forEach(i => symbolsToFetch.add(i.symbol));
    state.sandboxScenarios.forEach(sc => { 
        sc.portfolio.tw.forEach(i => symbolsToFetch.add(i.symbol)); 
        sc.portfolio.us.forEach(i => symbolsToFetch.add(i.symbol)); 
    });
    symbolsToFetch.delete(null); 
    symbolsToFetch.delete(undefined); 
    symbolsToFetch.delete('SKIP'); 
    symbolsToFetch.delete('');
    
    let allSymbols = Array.from(symbolsToFetch);
    if (allSymbols.length > 0) {
        try {
            const res = await fetch('/api/finance', { 
                method: 'POST', 
                headers: { 'Content-Type': 'application/json' }, 
                body: JSON.stringify({ symbols: allSymbols }) 
            });
            if (!res.ok) throw new Error('API 連線失敗');
            const json = await res.json();
            if (json.status === 'success') { 
                state.stockMapCache = Object.assign(state.stockMapCache, json.data); 
                if(json.exchangeRate) state.currentRate = json.exchangeRate; 
                if(json.prevExchangeRate) state.prevRate = json.prevExchangeRate; 
                else state.prevRate = state.currentRate; 
            }
        } catch(e) { 
            console.error('Fetch error:', e); 
            showToast("⚠️ 報價伺服器連線異常，目前使用快取資料"); 
        }
    }
    
    const displayRateEl = document.getElementById('display-rate');
    if (displayRateEl) displayRateEl.innerText = state.currentRate.toFixed(2); 
    state.latestDataTime = 0;

    const mapToCombined = (portfolio) => {
        let list = [...portfolio.tw, ...portfolio.us];
        return list.filter(item => item.symbol && item.symbol !== 'SKIP').map(item => {
            const m = state.stockMapCache[item.symbol]; 
            if (!m) return { ...item, marketValueTWD: 0, costTWD: 0, cagr: 0 }; 
            if (m.regularMarketTime && m.regularMarketTime > state.latestDataTime) state.latestDataTime = m.regularMarketTime;
            
            const exRate = item.market === 'US' ? state.currentRate : 1; 
            const pastExRate = item.market === 'US' ? state.prevRate : 1;
            
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

    let realCombined = mapToCombined(state.realPortfolio);
    state.compareData.realGlobal = calcPortfolioMetrics(realCombined); 
    state.compareData.realTW = calcPortfolioMetrics(realCombined.filter(i => i.market === 'TW')); 
    state.compareData.realUS = calcPortfolioMetrics(realCombined.filter(i => i.market === 'US'));
    state.compareData.sandboxList = state.sandboxScenarios.map(sc => { return { id: sc.id, name: sc.name, metrics: calcPortfolioMetrics(mapToCombined(sc.portfolio)) }; });
    
    exportGlobalSyncData(realCombined);

    if(state.activeScenarioId === 'real') { 
        state.globalCombinedList = realCombined; 
    } else { 
        let sc = state.sandboxScenarios.find(s => s.id === state.activeScenarioId); 
        state.globalCombinedList = mapToCombined(sc.portfolio); 
    }

    const dateEl = document.getElementById('data-date');
    if (dateEl) {
        if (state.globalCombinedList.length > 0) { 
            let d = state.latestDataTime > 0 ? new Date(state.latestDataTime * 1000) : new Date(); 
            let mm = (d.getMonth() + 1).toString().padStart(2, '0'); 
            let dd = d.getDate().toString().padStart(2, '0'); 
            dateEl.innerText = `📅 ${mm}/${dd}`; 
            dateEl.style.display = 'inline-block'; 
        } else { 
            dateEl.style.display = 'none'; 
        }
    }
    
    // 渲染觸發器：呼叫全域的 renderCurrentView (之後在 main.js 中掛載)
    if(typeof window.renderCurrentView === 'function') {
        window.renderCurrentView();
    }
}

export function calcPortfolioMetrics(list) {
    let totalVal = list.reduce((s, i) => s + (i.marketValueTWD || 0), 0); 
    if (totalVal === 0) return { totalVal: 0, cagr: 0, stdev: 0 };
    let cagr = list.reduce((s, i) => s + ((i.cagr || 0) * (i.marketValueTWD || 0)), 0) / totalVal; 
    let stdev = typeof window.calculateMatrixRisk === 'function' ? window.calculateMatrixRisk(list, totalVal) : 0; 
    return { totalVal, cagr, stdev };
}

export function exportGlobalSyncData(realList) {
    if (!realList || realList.length === 0) { 
        localStorage.setItem('sync_invest_data', JSON.stringify({ totalValue: 0, cagr: 0, dividendYield: 0, timestamp: new Date().getTime() })); 
        return; 
    }
    let metrics = calcPortfolioMetrics(realList); 
    let totalExpectedDividend = 0;
    
    realList.forEach(item => {
        const exRate = item.market === 'US' ? state.currentRate : 1;
        if (item.historicalDividends && item.historicalDividends.length > 0) {
            const now = new Date(); 
            const startMonth = new Date(now.getFullYear(), now.getMonth() - 11, 1); 
            const monthKeys = [];
            for (let i = 0; i < 24; i++) {
                monthKeys.push(`${new Date(startMonth.getFullYear(), startMonth.getMonth() + i, 1).getFullYear()}-${(new Date(startMonth.getFullYear(), startMonth.getMonth() + i, 1).getMonth() + 1).toString().padStart(2, '0')}`);
            }
            item.historicalDividends.forEach(div => { 
                const dDate = new Date(div.date * 1000); 
                const futureKey = `${dDate.getFullYear() + 1}-${(dDate.getMonth() + 1).toString().padStart(2, '0')}`; 
                if (monthKeys.indexOf(futureKey) >= 12) {
                    totalExpectedDividend += div.amount * item.shares * exRate; 
                }
            });
        }
    });
    
    localStorage.setItem('sync_invest_data', JSON.stringify({ 
        totalValue: metrics.totalVal, 
        cagr: metrics.cagr, 
        dividendYield: metrics.totalVal > 0 ? (totalExpectedDividend / metrics.totalVal) : 0, 
        timestamp: new Date().getTime() 
    }));
}

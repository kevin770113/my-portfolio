import { state } from './state.js';
import { pbiEngine } from './pbiEngine.js';

// ==========================================
// 🚀 PBI 恐慌抄底雷達 (背景非同步佇列)
// ==========================================
export async function startPbiScan() {
    if (state.isPbiRunning) return;
    
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
    if (allSymbols.length === 0) {
        let hChart = document.getElementById('historyPnLChart');
        if (hChart) hChart.innerHTML = '<div style="text-align: center; color: #999; padding-top: 160px; font-size: 12px;">無庫存資料，無法回測</div>';
        return;
    }

    state.isPbiRunning = true;
    state.pbiResults = [];
    
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
                    
                    state.historicalDataCache[symbol] = json.data;
                    
                    // 正確呼叫已模組化的 pbiEngine
                    const result = pbiEngine.evaluate(json.data);
                    if (result) {
                        state.pbiResults.push(result);
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

    state.isPbiRunning = false;
    finishPbiScan();
}

export function finishPbiScan() {
    const btn = document.getElementById('btn-pbi-signal');
    if (!btn) return;

    state.pbiResults.sort((a, b) => b.score - a.score);
    const hasBuySignal = state.pbiResults.some(r => r.score >= 60);

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

    // 觸發歷史軌跡圖表重繪
    if (typeof window.renderHistoryPnLChart === 'function') {
        window.renderHistoryPnLChart();
    }
}

function renderPbiModalContent() {
    const listEl = document.getElementById('pbi-signal-list');
    if (!listEl) return;
    
    let html = '';
    state.pbiResults.forEach((res, idx) => {
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

        // 綁定 window.togglePbiAccordion 確保 HTML 字串的 onclick 能作用
        html += `
        <div class="pbi-item ${highlightClass}">
            <div class="pbi-header" onclick="window.togglePbiAccordion(${idx})">
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

export function openPbiModal() { 
    const el = document.getElementById('pbi-modal-overlay');
    el.style.display = 'flex'; 
    setTimeout(() => { el.classList.add('active'); }, 10);
}

export function closePbiModal() { 
    const el = document.getElementById('pbi-modal-overlay');
    el.classList.remove('active'); 
    setTimeout(() => { el.style.display = 'none'; }, 300);
}

export function togglePbiAccordion(idx) {
    const detailEl = document.getElementById(`pbi-details-${idx}`);
    if (detailEl.classList.contains('open')) {
        detailEl.classList.remove('open');
    } else {
        document.querySelectorAll('.pbi-details').forEach(el => el.classList.remove('open'));
        detailEl.classList.add('open');
    }
}

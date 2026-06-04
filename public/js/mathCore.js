import { state } from './state.js';
import { setLoading, showInfoModal } from './utils.js';

// ==========================================
// 1. 共變異數矩陣與組合風險計算 (Markowitz)
// ==========================================
export function calculateMatrixRisk(list, totalValue) {
    if (!list || list.length === 0 || totalValue <= 0) return 0;
    
    // 提取每檔股票的權重與標準差
    const weights = list.map(item => {
        const exRate = item.market === 'US' ? state.currentRate : 1;
        return (item.currentPrice * item.shares * exRate) / totalValue;
    });
    
    const stdevs = list.map(item => (item.stdev || 0) / 100);
    
    // 計算共變異數矩陣與投資組合總變異數
    // 相關係數 (Correlation) 假設值：同市場 0.6，跨市場 0.3，自身 1.0
    let variance = 0;
    for (let i = 0; i < list.length; i++) {
        for (let j = 0; j < list.length; j++) {
            let corr = 1.0;
            if (i !== j) {
                corr = (list[i].market === list[j].market) ? 0.6 : 0.3;
            }
            let cov = corr * stdevs[i] * stdevs[j];
            variance += weights[i] * weights[j] * cov;
        }
    }
    
    return Math.sqrt(variance) * 100;
}

// ==========================================
// 2. 蒙地卡羅未來資產軌跡推算 (Monte Carlo)
// ==========================================
export function runMonteCarlo(list, totalValue, years = 10, simulations = 500) {
    if (!list || list.length === 0 || totalValue <= 0) return null;
    
    let weightedCagr = 0;
    list.forEach(item => {
        const exRate = item.market === 'US' ? state.currentRate : 1;
        const weight = (item.currentPrice * item.shares * exRate) / totalValue;
        weightedCagr += weight * (item.cagr || 0) / 100;
    });
    
    const risk = calculateMatrixRisk(list, totalValue) / 100;
    
    const dt = 1 / 12; // 步長：1 個月
    const steps = years * 12;
    let finalValues = [];
    let trajectories = []; // 只保留部分軌跡用於繪圖
    
    for (let i = 0; i < simulations; i++) {
        let currentVal = totalValue;
        let path = [currentVal];
        for (let j = 0; j < steps; j++) {
            // 幾何布朗運動 (Geometric Brownian Motion)
            let drift = (weightedCagr - 0.5 * risk * risk) * dt;
            let shock = risk * Math.sqrt(dt) * normalRandom();
            currentVal = currentVal * Math.exp(drift + shock);
            if (i < 5) path.push(currentVal);
        }
        finalValues.push(currentVal);
        if (i < 5) trajectories.push(path);
    }
    
    finalValues.sort((a, b) => a - b);
    
    return {
        p10: finalValues[Math.floor(simulations * 0.1)],
        p25: finalValues[Math.floor(simulations * 0.25)],
        p50: finalValues[Math.floor(simulations * 0.5)],
        p75: finalValues[Math.floor(simulations * 0.75)],
        p90: finalValues[Math.floor(simulations * 0.9)],
        trajectories
    };
}

// Box-Muller 轉換產生常態分佈隨機數
function normalRandom() {
    let u = 0, v = 0;
    while(u === 0) u = Math.random();
    while(v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

// ==========================================
// 3. 投資組合二次規劃 (QP) 權重最佳化
// ==========================================
export function executeAIOptimizer() {
    let sc = state.sandboxScenarios.find(s => s.id === state.activeScenarioId);
    if (!sc) return;
    
    let targetStocks = [...sc.portfolio.tw, ...sc.portfolio.us].filter(s => s.symbol && s.symbol !== 'SKIP');
    if (targetStocks.length < 2) {
        showInfoModal("⚠️ 標的不足", "至少需要 2 檔股票才能啟動演算。", true);
        return;
    }

    setLoading(true, "AI 矩陣演算中...");

    // 讀取限制條件
    const obj = document.getElementById('ai-opt-objective').value;
    const minCagr = parseFloat(document.getElementById('ai-const-cagr').value) || null;
    const maxRisk = parseFloat(document.getElementById('ai-const-risk').value) || null;
    const minYield = parseFloat(document.getElementById('ai-const-yield').value) || null;

    // 將龐大的運算推入下一個 Event Loop，避免 UI 卡死
    setTimeout(() => {
        try {
            let n = targetStocks.length;
            let returns = targetStocks.map(s => (state.stockMapCache[s.symbol]?.cagr || 0) / 100);
            let yields = targetStocks.map(s => (state.stockMapCache[s.symbol]?.dividendYield || 0) / 100);
            let stdevs = targetStocks.map(s => (state.stockMapCache[s.symbol]?.stdev || 0) / 100);
            
            // 共變異數矩陣
            let Q = [];
            for (let i = 0; i < n; i++) {
                Q[i] = [];
                for (let j = 0; j < n; j++) {
                    let corr = (i === j) ? 1.0 : (targetStocks[i].market === targetStocks[j].market ? 0.6 : 0.3);
                    Q[i][j] = corr * stdevs[i] * stdevs[j];
                }
            }

            // 蒙地卡羅窮舉搜尋近似最佳解 (替代前端厚重的 QP Solver)
            let bestWeights = null;
            let bestScore = -Infinity;
            
            for(let sim = 0; sim < 10000; sim++) {
                let w = [];
                let sum = 0;
                for(let i = 0; i < n; i++) {
                    let r = Math.random();
                    w.push(r);
                    sum += r;
                }
                w = w.map(x => x / sum);
                
                let portReturn = 0;
                let portYield = 0;
                let portVar = 0;
                
                for(let i = 0; i < n; i++) {
                    portReturn += w[i] * returns[i];
                    portYield += w[i] * yields[i];
                    for(let j = 0; j < n; j++) {
                        portVar += w[i] * w[j] * Q[i][j];
                    }
                }
                
                let portRisk = Math.sqrt(portVar);
                
                // 檢查是否符合硬性條件限制
                if (minCagr !== null && (portReturn * 100) < minCagr) continue;
                if (maxRisk !== null && (portRisk * 100) > maxRisk) continue;
                if (minYield !== null && (portYield * 100) < minYield) continue;
                
                let score = 0;
                if (obj === 'efficiency') score = portRisk === 0 ? 0 : portReturn / portRisk; // Sharpe Ratio
                else if (obj === 'max_cagr') score = portReturn;
                else if (obj === 'min_risk') score = -portRisk;
                else if (obj === 'max_yield') score = portYield;
                
                if (score > bestScore) {
                    bestScore = score;
                    bestWeights = w;
                }
            }

            if (!bestWeights) {
                setLoading(false);
                showInfoModal("⚠️ 無解", "在您設定的限制條件下，演算法無法找到合適的權重配比。請放寬限制條件後重試。", true);
                return;
            }

            state.pendingAIWeights = { stocks: targetStocks, weights: bestWeights };
            
            let totalVal = 0;
            targetStocks.forEach(s => {
                let exRate = s.market === 'US' ? state.currentRate : 1; 
                totalVal += s.shares * state.stockMapCache[s.symbol].price * exRate;
            });

            // 組合輸出介面
            let resultHtml = `
                <div class="prompt-title">✅ 最佳化完成</div>
                <div class="prompt-desc">演算法已為您計算出理論最佳配比。</div>
                <div style="text-align:left; max-height: 250px; overflow-y: auto; margin-bottom: 15px; border-top:1px solid #eee; border-bottom:1px solid #eee; padding: 10px 0;">
            `;

            bestWeights.forEach((w, i) => {
                let st = targetStocks[i];
                let pct = (w * 100).toFixed(1);
                let exRate = st.market === 'US' ? state.currentRate : 1; 
                let targetVal = totalVal * w;
                let targetShares = (targetVal / (state.stockMapCache[st.symbol].price * exRate)).toFixed(2);
                
                resultHtml += `
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 8px;">
                        <span style="font-weight:600; font-size:14px; width:120px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${st.name}</span>
                        <div style="flex:1; background:#e0e6ed; height:8px; border-radius:4px; margin:0 10px; position:relative; overflow:hidden;">
                            <div style="background:var(--primary-dark); height:100%; width:${pct}%;"></div>
                        </div>
                        <span style="font-weight:800; color:var(--primary-dark); font-size:14px;">${pct}%</span>
                    </div>
                    <div style="font-size:11px; color:#7f8c8d; text-align:right; margin-bottom:10px;">建議調整至: ${targetShares} 股</div>
                `;
            });

            resultHtml += `</div>
            <div class="prompt-actions">
                <button class="btn-skip" onclick="window.closeAIResult()">捨棄</button>
                <button class="btn-confirm" onclick="window.applyAIWeights()">套用配比</button>
            </div>`;

            document.getElementById('ai-res-content').innerHTML = resultHtml;
            document.getElementById('ai-opt-modal').classList.remove('active');
            document.getElementById('ai-res-modal').classList.add('active');

        } catch(e) {
            console.error(e);
            showInfoModal("⚠️ 演算錯誤", "最佳化過程發生例外狀況。", true);
        } finally {
            setLoading(false);
        }
    }, 100);
}

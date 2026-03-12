// ==========================================
// 量化運算與 AI 最佳化引擎 (Math Core & QP Solver)
// ==========================================

// 【修復】找回被遺漏的矩陣波動率計算 (讓蒙地卡羅的五條線重新展開)
function calculateMatrixRisk(list, totalVal) {
    if (!list || list.length === 0 || totalVal <= 0) return 0;
    let validStocks = list.filter(s => stockMapCache[s.symbol]);
    let N = validStocks.length;
    if (N === 0) return 0;
    if (N === 1) return stockMapCache[validStocks[0].symbol].stdev || 0;

    let commonMonths = null; let returnsMap = {};
    validStocks.forEach(s => {
        let m = stockMapCache[s.symbol];
        if(m && m.monthlyReturns && Object.keys(m.monthlyReturns).length > 0) {
            let months = Object.keys(m.monthlyReturns);
            if(commonMonths === null) commonMonths = months; else commonMonths = commonMonths.filter(x => months.includes(x));
        }
    });

    let Sigma = Array(N).fill(0).map(() => Array(N).fill(0));
    if (commonMonths && commonMonths.length >= 3) {
        validStocks.forEach((s) => { 
            let m = stockMapCache[s.symbol];
            returnsMap[s.symbol] = commonMonths.map(mStr => (m.monthlyReturns && m.monthlyReturns[mStr] !== undefined) ? m.monthlyReturns[mStr] : 0); 
        });
        for(let i=0; i<N; i++) {
            for(let j=0; j<N; j++) {
                let hasRetI = stockMapCache[validStocks[i].symbol].monthlyReturns;
                let hasRetJ = stockMapCache[validStocks[j].symbol].monthlyReturns;
                if(hasRetI && hasRetJ) {
                    let arrI = returnsMap[validStocks[i].symbol]; let arrJ = returnsMap[validStocks[j].symbol];
                    let meanI = arrI.reduce((a,b)=>a+b,0) / commonMonths.length; let meanJ = arrJ.reduce((a,b)=>a+b,0) / commonMonths.length;
                    let cov = 0;
                    for(let k=0; k<commonMonths.length; k++) { cov += (arrI[k] - meanI) * (arrJ[k] - meanJ); }
                    Sigma[i][j] = (cov / (commonMonths.length - 1)) * 12; 
                } else {
                    if (i === j) { let sd = stockMapCache[validStocks[i].symbol].stdev || 0; Sigma[i][j] = sd * sd; } else { Sigma[i][j] = 0; }
                }
            }
        }
    } else {
        for(let i=0; i<N; i++) { let sd = stockMapCache[validStocks[i].symbol].stdev || 0; Sigma[i][i] = sd * sd; }
    }

    let weights = validStocks.map(s => (s.marketValueTWD || 0) / totalVal); let portVar = 0;
    for(let i=0; i<N; i++) { for(let j=0; j<N; j++) { portVar += weights[i] * weights[j] * Sigma[i][j]; } }
    return Math.sqrt(Math.max(0, portVar));
}

function executeAIOptimizer() {
    if (typeof numeric === 'undefined') { 
        showInfoModal("系統錯誤", "載入矩陣運算引擎失敗。", true); 
        return; 
    }
    
    document.getElementById('ai-opt-modal').classList.remove('active'); 
    setLoading(true, "正在執行二次規劃矩陣求解...");

    setTimeout(() => {
        let sc = sandboxScenarios.find(s => s.id === activeScenarioId); 
        let validStocks = [...sc.portfolio.tw, ...sc.portfolio.us].filter(s => stockMapCache[s.symbol]); 
        let N = validStocks.length;
        
        let commonMonths = null; let returnsMap = {};
        validStocks.forEach(s => { 
            let m = stockMapCache[s.symbol]; 
            if(m && m.monthlyReturns && Object.keys(m.monthlyReturns).length > 0) { 
                let months = Object.keys(m.monthlyReturns); 
                if(commonMonths === null) commonMonths = months; 
                else commonMonths = commonMonths.filter(x => months.includes(x)); 
            } 
        });
        
        let Sigma = Array(N).fill(0).map(() => Array(N).fill(0)); 
        let expectedCAGR = validStocks.map(s => stockMapCache[s.symbol].cagr || 0); 
        let expectedYield = validStocks.map(s => stockMapCache[s.symbol].dividendYield || 0);
        
        if (commonMonths && commonMonths.length >= 3) {
            validStocks.forEach((s) => { 
                let m = stockMapCache[s.symbol]; 
                returnsMap[s.symbol] = commonMonths.map(mStr => (m.monthlyReturns && m.monthlyReturns[mStr] !== undefined) ? m.monthlyReturns[mStr] : 0); 
            });
            for(let i=0; i<N; i++) { 
                for(let j=0; j<N; j++) { 
                    let hasRetI = stockMapCache[validStocks[i].symbol].monthlyReturns; 
                    let hasRetJ = stockMapCache[validStocks[j].symbol].monthlyReturns; 
                    if(hasRetI && hasRetJ) { 
                        let arrI = returnsMap[validStocks[i].symbol]; let arrJ = returnsMap[validStocks[j].symbol]; 
                        let meanI = arrI.reduce((a,b)=>a+b,0) / commonMonths.length; let meanJ = arrJ.reduce((a,b)=>a+b,0) / commonMonths.length; 
                        let cov = 0; for(let k=0; k<commonMonths.length; k++) { cov += (arrI[k] - meanI) * (arrJ[k] - meanJ); } 
                        Sigma[i][j] = (cov / (commonMonths.length - 1)) * 12;
                    } else { 
                        if (i === j) { let sd = stockMapCache[validStocks[i].symbol].stdev || 0; Sigma[i][j] = sd * sd; } else { Sigma[i][j] = 0; } 
                    } 
                } 
            }
        } else { 
            for(let i=0; i<N; i++) { let sd = stockMapCache[validStocks[i].symbol].stdev || 0; Sigma[i][i] = sd * sd; } 
        }
        
        let origTotalVal = 0; validStocks.forEach(s => { let exRate = s.market === 'US' ? currentRate : 1; origTotalVal += s.shares * stockMapCache[s.symbol].price * exRate; });
        let origWeights = validStocks.map(s => { if(origTotalVal === 0) return 1/N; let exRate = s.market === 'US' ? currentRate : 1; return (s.shares * stockMapCache[s.symbol].price * exRate) / origTotalVal; });
        let origCAGR = 0; let origYield = 0; for(let i=0; i<N; i++) { origCAGR += origWeights[i] * expectedCAGR[i]; origYield += origWeights[i] * expectedYield[i]; }
        let origVar = 0; for(let i=0; i<N; i++) { for(let j=0; j<N; j++) { origVar += origWeights[i] * origWeights[j] * Sigma[i][j]; } } let origRisk = Math.sqrt(Math.max(0, origVar));
        
        let objType = document.getElementById('ai-opt-objective').value; 
        let userMinCagr = parseFloat(document.getElementById('ai-const-cagr').value) / 100; if(isNaN(userMinCagr)) userMinCagr = -Infinity; 
        let userMaxRisk = parseFloat(document.getElementById('ai-const-risk').value) / 100; if(isNaN(userMaxRisk)) userMaxRisk = Infinity; 
        let userMinYield = parseFloat(document.getElementById('ai-const-yield').value) / 100; if(isNaN(userMinYield)) userMinYield = -Infinity;
        
        let maxPossibleCagr = Math.max(...expectedCAGR); let maxPossibleYield = Math.max(...expectedYield);
        
        if (userMinCagr > maxPossibleCagr + 1e-4 || userMinYield > maxPossibleYield + 1e-4) { 
            setLoading(false); showInfoModal("⚠️ 無法找到最佳解", "條件過於嚴苛，已經超越了資產極限，請放寬限制。", true, () => { document.getElementById('ai-opt-modal').classList.add('active'); }); 
            return; 
        }
        
        const solveQP = (targetC, targetY) => {
            let D = []; let d = []; for(let i=0; i<N; i++){ D[i] = []; for(let j=0; j<N; j++){ D[i][j] = Sigma[i][j] + (i===j ? 1e-8 : 0); } d.push(0); }
            let A = []; for(let i=0; i<N; i++) A.push([]); let b = [];
            for(let i=0; i<N; i++) A[i].push(1); b.push(1);
            for(let j=0; j<N; j++){ for(let i=0; i<N; i++){ A[i].push(i===j ? 1 : 0); } b.push(0); }
            if(targetC > -Infinity){ for(let i=0; i<N; i++) A[i].push(expectedCAGR[i]); b.push(targetC); }
            if(targetY > -Infinity){ for(let i=0; i<N; i++) A[i].push(expectedYield[i]); b.push(targetY); }
            
            try { 
                let qp = numeric.solveQP(D, d, A, b, 1); if (qp.message) return { feasible: false }; 
                let sol = qp.solution.map(v => Math.max(0, v)); let sum = sol.reduce((acc, val) => acc + val, 0); if (sum === 0) return { feasible: false }; 
                let w = sol.map(v => v / sum); 
                let c = 0, y = 0, v = 0; for(let i=0; i<N; i++){ c += w[i]*expectedCAGR[i]; y += w[i]*expectedYield[i]; } 
                for(let i=0; i<N; i++){ for(let j=0; j<N; j++){ v += w[i]*w[j]*Sigma[i][j]; } } let rsk = Math.sqrt(Math.max(0, v)); 
                if (c < userMinCagr - 1e-4 || y < userMinYield - 1e-4 || rsk > userMaxRisk + 1e-4) { return { feasible: false }; } 
                return { feasible: true, weights: w, cagr: c, yield: y, risk: rsk }; 
            } catch(e) { return { feasible: false }; }
        };
        
        let bestRes = null;
        if (objType === 'min_risk') { let r = solveQP(userMinCagr, userMinYield); if (r.feasible) bestRes = r; } 
        else if (objType === 'max_cagr') { let low = userMinCagr === -Infinity ? Math.min(...expectedCAGR) : userMinCagr; let high = maxPossibleCagr; for (let step=0; step<30; step++) { let mid = (low + high) / 2; let r = solveQP(mid, userMinYield); if (r.feasible) { bestRes = r; low = mid; } else { high = mid; } } if (!bestRes) { let r = solveQP(userMinCagr, userMinYield); if(r.feasible) bestRes = r; } } 
        else if (objType === 'max_yield') { let low = userMinYield === -Infinity ? Math.max(0, Math.min(...expectedYield)) : userMinYield; let high = maxPossibleYield; for (let step=0; step<30; step++) { let mid = (low + high) / 2; let r = solveQP(userMinCagr, mid); if (r.feasible) { bestRes = r; low = mid; } else { high = mid; } } if (!bestRes) { let r = solveQP(userMinCagr, userMinYield); if(r.feasible) bestRes = r; } } 
        else if (objType === 'efficiency') { let minR = userMinCagr === -Infinity ? Math.min(...expectedCAGR) : userMinCagr; let maxR = maxPossibleCagr; let steps = 50; let bestScore = -Infinity; for (let i=0; i<=steps; i++) { let targetC = minR + (maxR - minR) * (i / steps); let r = solveQP(targetC, userMinYield); if (r.feasible) { let score = r.risk > 0 ? (r.cagr / r.risk) : (r.cagr > 0 ? Infinity : -Infinity); if (score > bestScore) { bestScore = score; bestRes = r; } } } }
        
        setLoading(false);
        if(!bestRes) { 
            showInfoModal("⚠️ 無解", "在您設定的條件下，數學矩陣運算結果為無解。<br><br>請嘗試調降最低報酬或放寬風險限制。", true, () => { document.getElementById('ai-opt-modal').classList.add('active'); }); 
        } else {
            pendingAIWeights = { weights: bestRes.weights, stocks: validStocks };
            let html = `
                <div class="prompt-title">📊 演算報告</div>
                <table style="width:100%; font-size:13px; margin-bottom:15px; text-align:center; border-collapse:collapse; background:#f8f9fa; border-radius:8px;"> 
                    <tr style="background:#e0e6ed; color:#2c3e50;"><th style="padding:8px;">指標</th><th style="padding:8px;">原組合</th><th style="padding:8px;">建議</th></tr>
                    <tr style="border-bottom:1px solid #eee;"><td style="padding:8px;">CAGR</td><td>${(origCAGR*100).toFixed(1)}%</td><td style="color:var(--red-profit); font-weight:bold;">${(bestRes.cagr*100).toFixed(1)}%</td></tr>
                    <tr style="border-bottom:1px solid #eee;"><td style="padding:8px;">風險</td><td>${(origRisk*100).toFixed(1)}%</td><td style="color:var(--primary-dark); font-weight:bold;">${(bestRes.risk*100).toFixed(1)}%</td></tr>
                    <tr><td style="padding:8px;">殖利率</td><td>${(origYield*100).toFixed(1)}%</td><td style="color:var(--primary-dark); font-weight:bold;">${(bestRes.yield*100).toFixed(1)}%</td></tr>
                </table>
                <div style="text-align:left; font-size:12px; font-weight:bold; margin-bottom:8px; color:var(--primary-dark);">💡 最佳權重：</div>
                <div style="max-height:180px; overflow-y:auto; text-align:left; font-size:12px; padding-right:5px; margin-bottom:15px;">
            `;
            validStocks.forEach((s, i) => { 
                let oldW = origWeights[i]*100; let newW = bestRes.weights[i]*100; 
                html += `<div style="display:flex; justify-content:space-between; margin-bottom:8px; border-bottom:1px dashed #eee; padding-bottom:6px;"><span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:120px; font-weight:bold;">${s.name}</span><span><span style="color:#999">${oldW.toFixed(1)}%</span> ➔ <strong style="color:var(--primary-dark); font-size:14px;">${newW.toFixed(1)}%</strong></span></div>`; 
            });
            html += `</div><div class="prompt-actions"><button class="btn-skip" onclick="closeAIResult()">返回</button><button class="btn-success" onclick="applyAIWeights()">✅ 套用並重算</button></div>`;
            document.getElementById('ai-res-content').innerHTML = html; 
            document.getElementById('ai-res-modal').classList.add('active');
        }
    }, 100); 
}

// ==========================================
// 視覺渲染引擎 (Chart Engine & Visuals)
// 負責所有 ECharts 與 Chart.js 的繪圖邏輯
// ==========================================

// ==========================================
// 現金流明細面板 (Bottom Sheet) 控制函數
// ==========================================
window.showDivDetail = function(monthData) {
    if (!monthData || monthData.total === 0) return;
    
    let titleEl = document.getElementById('div-detail-title');
    let listEl = document.getElementById('div-detail-list');
    
    // 標題顯示總金額
    let totalStr = isPrivacyMode ? '****' : '$' + Math.round(monthData.total).toLocaleString();
    titleEl.innerText = `${monthData.label.replace(' (預估)', '')} 配息明細 (共 ${totalStr})`;
    
    // 排序：金額由高到低
    let sortedDetails = [...monthData.details].sort((a, b) => b.amount - a.amount);
    
    let html = '';
    sortedDetails.forEach(item => {
        let amtStr = isPrivacyMode ? '****' : '$' + Math.round(item.amount).toLocaleString();
        html += `
            <div style="display:flex; justify-content:space-between; padding: 12px 0; border-bottom: 1px dashed #eee; font-size: 14px;">
                <span style="font-weight: bold; color: #2c3e50; max-width: 65%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${item.name}</span>
                <span style="font-weight: bold; color: #20C997;">${amtStr}</span>
            </div>
        `;
    });
    listEl.innerHTML = html;
    
    // 滑出面板
    document.getElementById('div-detail-overlay').style.display = 'flex';
    setTimeout(() => document.getElementById('div-detail-sheet').classList.add('show'), 10);
};

window.closeDivDetail = function() {
    document.getElementById('div-detail-sheet').classList.remove('show');
    setTimeout(() => document.getElementById('div-detail-overlay').style.display = 'none', 300);
};

// ------------------------------------------
// 1. 星系拓樸圖 (ECharts - 極光視覺升級版)
// ------------------------------------------
function renderCorrelationGraph(list, totalVal) {
    let container = document.getElementById('correlationGraph');
    let hud = document.getElementById('galaxy-hud');
    if (hud) hud.classList.remove('show'); 
    
    if (typeof echarts === 'undefined') {
        container.innerHTML = '<div style="color: #8b949e; text-align: center; padding-top: 180px; font-size:13px;">⚠️ 視覺化引擎載入失敗<br><span style="font-size:11px;">請檢查網路環境或關閉廣告阻擋器 (AdBlocker)</span></div>';
        return;
    }

    if (list.length < 2 || totalVal <= 0) {
        if (charts.corr) { charts.corr.dispose(); charts.corr = null; }
        container.innerHTML = '<div style="color: #666; text-align: center; padding-top: 200px; font-size:12px;">🪐 至少需要 2 檔以上標的才能運算引力</div>';
        return;
    }

    if (charts.corr) {
        charts.corr.dispose();
    }
    charts.corr = echarts.init(container);

    let validStocks = list.filter(s => stockMapCache[s.symbol]);
    let N = validStocks.length;
    if (N < 2) return;

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
                    Sigma[i][j] = cov; 
                } else {
                    if (i === j) { let sd = (stockMapCache[validStocks[i].symbol].stdev || 0)/Math.sqrt(12); Sigma[i][j] = sd * sd; } else { Sigma[i][j] = 0; }
                }
            }
        }
    } else {
        for(let i=0; i<N; i++) { let sd = (stockMapCache[validStocks[i].symbol].stdev || 0)/Math.sqrt(12); Sigma[i][i] = sd * sd; }
    }

    let SD = [];
    for(let i=0; i<N; i++) SD[i] = Math.sqrt(Math.max(0, Sigma[i][i]));

    let weights = validStocks.map(s => (s.marketValueTWD || 0) / totalVal);
    nodeStatsMap = {};
    fullGalaxyLinks = []; 
    rawLinkData = [];
    let posCount = Array(N).fill(0);
    let negCount = Array(N).fill(0);

    for(let i=0; i<N; i++) {
        let weightedCorrSum = 0;
        let weightSumOthers = 0;
        
        for(let j=0; j<N; j++) {
            if (SD[i] === 0 || SD[j] === 0) continue;
            let r = Sigma[i][j] / (SD[i] * SD[j]);
            
            if(i !== j) {
                weightedCorrSum += r * weights[j];
                weightSumOthers += weights[j];
                
                if (j > i && (r > 0.6 || r < -0.15)) {
                    let isNegative = r < 0;
                    if(isNegative) { negCount[i]++; negCount[j]++; } else { posCount[i]++; posCount[j]++; }
                    
                    rawLinkData.push({ source: validStocks[i].symbol, target: validStocks[j].symbol, r: r, isNegative: isNegative });

                    fullGalaxyLinks.push({
                        id: validStocks[i].symbol + '-' + validStocks[j].symbol,
                        source: validStocks[i].symbol,
                        target: validStocks[j].symbol,
                        lineStyle: {
                            color: isNegative ? '#00e676' : '#ff4757', 
                            width: 1, 
                            type: isNegative ? 'dashed' : 'solid',
                            curveness: 0.1,
                            opacity: 0.15 
                        },
                        silent: true, 
                        tooltip: { show: false } 
                    });
                }
            }
        }
        
        nodeStatsMap[validStocks[i].symbol] = {
            weight: weights[i],
            avgCorr: weightSumOthers > 0 ? (weightedCorrSum / weightSumOthers) : 0
        };
    }

    let maxPosIdx = posCount.indexOf(Math.max(...posCount));
    let maxNegIdx = negCount.indexOf(Math.max(...negCount));

    fullGalaxyNodes = [];
    validStocks.forEach((s, i) => {
        let weight = weights[i];
        let size = Math.max(18, Math.min(65, weight * 100)); 
        let isProfit = (s.marketValueTWD - s.costTWD) >= 0;
        
        let isHub = (i === maxPosIdx && posCount[i] > 0);
        let isHedge = (i === maxNegIdx && negCount[i] > 0);

        let baseColor = isProfit ? '#d93025' : '#188038';
        let glowColor = isProfit ? 'rgba(217, 48, 37, 0.8)' : 'rgba(24, 128, 56, 0.8)';
        let glowBlur = 15;

        if (isHub) {
            baseColor = '#ff3b2f'; 
            glowColor = 'rgba(255, 59, 47, 1)';
            glowBlur = 45; 
        } else if (isHedge) {
            baseColor = '#00e676'; 
            glowColor = 'rgba(0, 230, 118, 1)';
            glowBlur = 45; 
        }

        fullGalaxyNodes.push({
            id: s.symbol,
            name: s.symbol.replace('.TW', ''), 
            value: (weight * 100).toFixed(1) + '%',
            symbolSize: size, 
            baseNodeSize: size, 
            itemStyle: { 
                color: baseColor, 
                shadowBlur: glowBlur, 
                shadowColor: glowColor,
                borderWidth: 0 
            },
            label: { 
                show: size >= 35, 
                position: 'inside', 
                color: '#fff', 
                fontSize: 10, 
                fontWeight: 'bold',
                textBorderColor: 'rgba(0, 0, 0, 0.8)', 
                textBorderWidth: 2
            }
        });
    });

    const baseOption = {
        animationDurationUpdate: 800, 
        animationEasingUpdate: 'quinticInOut',
        tooltip: { show: false }
    };

    charts.corr.setOption({
        ...baseOption,
        series: [{
            id: 'galaxy-series',
            type: 'graph',
            layout: 'force',
            roam: false, 
            draggable: false, 
            data: fullGalaxyNodes,
            links: fullGalaxyLinks, 
            force: { repulsion: 150, edgeLength: [50, 120], gravity: 0.1 },
            emphasis: { focus: 'none' } 
        }]
    });

    charts.corr.on('click', function(params) {
        try {
            if(params.dataType === 'edge') return; 

            if(params.dataType === 'node') {
                let clickedId = params.data.id;
                let clickedName = params.data.name;
                
                if (!clickedId || !nodeStatsMap[clickedId]) return;
                
                let relatedIds = new Set([clickedId]);
                rawLinkData.forEach(l => {
                    if(l.source === clickedId) relatedIds.add(l.target);
                    if(l.target === clickedId) relatedIds.add(l.source);
                });

                let subsetNodes = fullGalaxyNodes.filter(n => relatedIds.has(n.id)).map(n => {
                    let isMain = (n.id === clickedId);
                    return { 
                        ...n, 
                        symbolSize: isMain ? n.baseNodeSize * 1.5 : n.baseNodeSize * 1.1,
                        itemStyle: { 
                            ...n.itemStyle, 
                            shadowColor: isMain ? '#ffffff' : n.itemStyle.shadowColor, 
                            shadowBlur: isMain ? 50 : n.itemStyle.shadowBlur,
                            borderWidth: 0
                        },
                        label: { 
                            ...n.label, 
                            show: true, 
                            fontSize: isMain ? 14 : 11,
                            textBorderWidth: isMain ? 3 : 2 
                        } 
                    };
                });

                let subsetLinks = rawLinkData.filter(l => l.source === clickedId || l.target === clickedId).map(l => {
                    let w = l.isNegative ? 3 : Math.min(8, Math.abs(l.r) * 6);
                    return {
                        id: l.source + '-' + l.target,
                        source: l.source, target: l.target,
                        lineStyle: {
                            color: l.isNegative ? '#00e676' : '#ff4757', width: w + 2,
                            type: l.isNegative ? 'dashed' : 'solid', curveness: 0.1,
                            opacity: 1, shadowBlur: 15, shadowColor: l.isNegative ? '#00e676' : '#ff4757'
                        },
                        silent: true, tooltip: { show: false }
                    };
                });

                charts.corr.setOption({ 
                    series: [{ 
                        id: 'galaxy-series',
                        data: subsetNodes, 
                        links: subsetLinks,
                        force: { repulsion: 400, edgeLength: [80, 150], gravity: 0.1 } 
                    }] 
                }, { replaceMerge: ['series'] });

                let stats = nodeStatsMap[clickedId];
                let wStr = (stats.weight * 100).toFixed(1) + '%';
                let cStr = stats.avgCorr > 0 ? '+' + stats.avgCorr.toFixed(2) : stats.avgCorr.toFixed(2);
                let cColor = stats.avgCorr > 0.4 ? '#ff4757' : (stats.avgCorr < -0.15 ? '#00e676' : '#8b949e');
                
                if (hud) {
                    hud.innerHTML = `聚焦：<b>${clickedName}</b> ｜ 資金佔比：<b>${wStr}</b> ｜ 組合連動度：<b style="color:${cColor};">${cStr}</b>`;
                    hud.classList.add('show');
                }
            }
        } catch (err) {
            console.error("Galaxy Click Error:", err);
        }
    });

    charts.corr.getZr().on('click', function(e) {
        try {
            if (!e.target) { 
                if(charts.corr && !charts.corr.isDisposed()) {
                    charts.corr.setOption({ 
                        series: [{ 
                            id: 'galaxy-series',
                            data: fullGalaxyNodes, 
                            links: fullGalaxyLinks,
                            force: { repulsion: 150, edgeLength: [50, 120], gravity: 0.1 }
                        }] 
                    }, { replaceMerge: ['series'] }); 
                    
                    if(hud) hud.classList.remove('show');
                }
            }
        } catch (err) {
            console.error("Galaxy Background Click Error:", err);
        }
    });
}

// ==========================================
// 全球持股現值排行 (動態抽離模組)
// ==========================================
window.currentPerfMode = 'value';
window.currentPerfList = [];
window.currentPerfTotalVal = 0;

window.switchPerfMode = function(mode, btnElement) {
    window.currentPerfMode = mode;
    
    // UI 切換
    if (btnElement) {
        const siblings = btnElement.parentElement.querySelectorAll('.mc-btn');
        siblings.forEach(b => b.classList.remove('active'));
        btnElement.classList.add('active');
    }

    // 重新渲染長條圖
    if (window.currentPerfList.length > 0) {
        window.renderPerformanceChart(window.currentPerfList, window.currentPerfTotalVal);
    }
};

window.renderPerformanceChart = function(list, totalVal) {
    if (!list || list.length === 0) return;
    
    // 快取資料供切換按鈕使用
    window.currentPerfList = list;
    window.currentPerfTotalVal = totalVal;

    let sortedList;
    let labels = [];
    let datasets = [];

    if (window.currentPerfMode === 'value') {
        // 模式 A: 總現值佔比 (依現值由大到小排序)
        sortedList = [...list].sort((a,b) => (b.marketValueTWD || 0) - (a.marketValueTWD || 0));
        labels = sortedList.map(i => `${i.name} (${totalVal > 0 ? ((i.marketValueTWD / totalVal) * 100).toFixed(1) : 0}%)`);
        datasets = [
            { label: '成本', data: sortedList.map(i => i.costTWD), backgroundColor: '#e0e0e0', barPercentage: 0.7, categoryPercentage: 0.6 },
            { label: '現值', data: sortedList.map(i => i.marketValueTWD), backgroundColor: sortedList.map(i => i.marketValueTWD >= i.costTWD ? '#d93025' : '#188038'), barPercentage: 0.7, categoryPercentage: 0.6 }
        ];
    } else {
        // 模式 B: 當日損益 (依當日損益由大到小排序)
        sortedList = [...list].sort((a,b) => (b.dayChangeTWD || 0) - (a.dayChangeTWD || 0));
        labels = sortedList.map(i => `${i.name} (${totalVal > 0 ? ((i.marketValueTWD / totalVal) * 100).toFixed(1) : 0}%)`);
        datasets = [
            { 
                label: '當日損益', 
                data: sortedList.map(i => i.dayChangeTWD || 0), 
                backgroundColor: sortedList.map(i => (i.dayChangeTWD || 0) >= 0 ? '#d93025' : '#188038'), 
                barPercentage: 0.7, 
                categoryPercentage: 0.6 
            }
        ];
    }

    if (charts.perf) charts.perf.destroy();
    charts.perf = new Chart(document.getElementById('performanceChart'), { 
        type: 'bar', 
        data: { labels, datasets }, 
        options: { 
            indexAxis: 'y', 
            responsive: true, 
            maintainAspectRatio: false, 
            scales: { 
                // Chart.js 預設不寫死 min/max 時，會自動進行 Auto-Bounding 自適應延伸
                x: { display: false }, 
                y: { grid: { display: false }, ticks: { font: { size: 10 } } } 
            }, 
            plugins: { 
                legend: { display: false }, 
                tooltip: { 
                    callbacks: { 
                        label: function(c) { 
                            let prefix = c.raw >= 0 && window.currentPerfMode === 'dayChange' ? '+' : '';
                            return `${c.dataset.label}: ` + prefix + (isPrivacyMode ? '****' : '$' + Math.round(c.raw).toLocaleString()); 
                        } 
                    } 
                } 
            } 
        } 
    });
};

// ------------------------------------------
// 2. 儀表板與基礎圖表渲染
// ------------------------------------------
function renderDashboard(list) {
    if (list.length === 0) {
        document.getElementById('val-total').innerText = fmtMoney(0); document.getElementById('val-cost').innerText = fmtMoney(0); document.getElementById('val-profit').innerText = fmtMoney(0); document.getElementById('val-profit').className = 'stat-main num text-muted'; document.getElementById('val-profit-pct').innerText = '0.00%'; document.getElementById('val-profit-pct').className = 'stat-sub num text-muted'; document.getElementById('val-day-change').innerText = fmtMoney(0); document.getElementById('val-day-change').className = 'stat-main num text-muted'; document.getElementById('val-day-change-pct').innerText = '0.00%'; document.getElementById('val-day-change-pct').className = 'stat-sub num text-muted'; document.getElementById('val-ytd').innerText = fmtMoney(0); document.getElementById('val-ytd').className = 'stat-main num text-muted'; document.getElementById('val-ytd-pct').innerText = '0.00%'; document.getElementById('val-ytd-pct').className = 'stat-sub num text-muted'; document.getElementById('val-cagr').innerText = '0.0%'; document.getElementById('val-cagr').className = 'stat-main num text-muted'; document.getElementById('val-stdev').innerText = '--%'; document.getElementById('val-dividend').innerText = fmtMoney(0); document.getElementById('val-yield').innerText = '0.00%';
        if (charts.alloc) charts.alloc.destroy(); if (charts.perf) charts.perf.destroy(); if (charts.mc) charts.mc.destroy(); if (charts.cf) charts.cf.destroy();
        if (charts.corr) { charts.corr.dispose(); charts.corr = null; }
        document.getElementById('alloc-legend').innerHTML = '<div style="color: #999; text-align: center; margin-top: 50px;">此市場暫無資料</div>'; updateRiskList([]); return;
    }
    
    const totalVal = list.reduce((a, b) => a + (b.marketValueTWD || 0), 0); 
    const totalCost = list.reduce((a, b) => a + (b.costTWD || 0), 0); 
    const totalProfit = totalVal - totalCost; 
    const dayChange = list.reduce((a, b) => a + (b.dayChangeTWD || 0), 0);
    
    document.getElementById('val-total').innerText = fmtMoney(totalVal); 
    document.getElementById('val-cost').innerText = fmtMoney(totalCost);
    
    const profitEl = document.getElementById('val-profit'); 
    profitEl.innerText = (totalProfit > 0 ? '+' : '') + fmtMoney(totalProfit); 
    profitEl.className = `stat-main num ${totalProfit >= 0 ? 'text-red' : 'text-green'}`;
    
    const profitPctEl = document.getElementById('val-profit-pct'); 
    profitPctEl.innerText = (totalCost > 0 ? ((totalProfit/totalCost)*100).toFixed(2) : 0) + '%'; 
    profitPctEl.className = `stat-sub num ${totalProfit >= 0 ? 'text-red' : 'text-green'}`;
    
    const dayEl = document.getElementById('val-day-change'); 
    const dayPctEl = document.getElementById('val-day-change-pct'); 
    const dayPct = totalVal > 0 ? (dayChange / totalVal) : 0;
    
    if (Math.abs(dayPct) > 0.25) { 
        dayEl.innerText = '盤後/異常'; dayEl.className = 'stat-main num text-muted'; 
        dayPctEl.innerText = '--%'; dayPctEl.className = 'stat-sub num text-muted'; 
    } else { 
        dayEl.innerText = (dayChange > 0 ? '+' : '') + fmtMoney(dayChange); 
        dayEl.className = `stat-main num ${dayChange >= 0 ? 'text-red' : 'text-green'}`; 
        dayPctEl.innerText = (dayPct > 0 ? '+' : '') + (dayPct * 100).toFixed(2) + '%'; 
        dayPctEl.className = `stat-sub num ${dayChange >= 0 ? 'text-red' : 'text-green'}`; 
    }
    
    let weightedYTD = 0, weightedCAGR = 0;
    if (totalVal > 0) { list.forEach(i => { let w = (i.marketValueTWD / totalVal); if (i.ytd) weightedYTD += i.ytd * w; if (i.cagr) weightedCAGR += i.cagr * w; }); }
    
    const ytdAmount = totalVal - (totalVal / (1 + weightedYTD)); 
    document.getElementById('val-ytd').innerText = (ytdAmount > 0 ? '+' : '') + fmtMoney(ytdAmount); 
    document.getElementById('val-ytd').className = `stat-main num ${ytdAmount >= 0 ? 'text-red' : 'text-green'}`; 
    document.getElementById('val-ytd-pct').innerText = (weightedYTD > 0 ? '+' : '') + (weightedYTD * 100).toFixed(2) + '%'; 
    document.getElementById('val-ytd-pct').className = `stat-sub num ${ytdAmount >= 0 ? 'text-red' : 'text-green'}`;
    
    document.getElementById('val-cagr').innerText = (weightedCAGR * 100).toFixed(1) + '%'; 
    document.getElementById('val-cagr').className = weightedCAGR >= 0 ? 'stat-main num text-red' : 'stat-main num text-green'; 
    
    let matrixStdev = typeof calculateMatrixRisk === 'function' ? calculateMatrixRisk(list, totalVal) : 0;
    document.getElementById('val-stdev').innerText = (matrixStdev * 100).toFixed(1) + '%';
    
    renderCorrelationGraph(list, totalVal);
    updateCharts(list, totalVal, weightedCAGR, matrixStdev); 
    updateRiskList(list);
}

function updateRiskList(list) {
    const container = document.getElementById('risk-list'); container.innerHTML = '';
    if(list.length === 0) { container.innerHTML = '<div style="color: #999; text-align: center; padding: 20px;">請先匯入資料</div>'; return; }
    
    const sortedList = [...list].sort((a,b) => (b.marketValueTWD || 0) - (a.marketValueTWD || 0));
    
    sortedList.forEach(item => {
        const cagrStr = item.cagr !== undefined ? (item.cagr*100).toFixed(1)+'%' : '--%'; 
        const stdevStr = item.stdev !== undefined ? (item.stdev*100).toFixed(1)+'%' : '--%'; 
        const colorClass = (item.cagr !== undefined && item.cagr >= 0) ? 'text-red' : (item.cagr < 0 ? 'text-green' : 'text-muted');
        
        let corr = 0;
        if(nodeStatsMap[item.symbol]) corr = nodeStatsMap[item.symbol].avgCorr;
        let corrStr = corr > 0 ? '+' + corr.toFixed(2) : corr.toFixed(2);
        let cColor = corr > 0.4 ? '#ff4757' : (corr < -0.15 ? '#00e676' : '#8b949e');

        container.innerHTML += `<div class="list-row"><div class="col-left"><div class="item-name" title="${item.name}"><span class="badge-market">${item.market}</span> ${item.name}</div><div class="item-sub">YTD: ${(item.ytd*100).toFixed(1)}% | 波動: ${stdevStr} | 連動: <span style="color:${cColor}; font-weight:bold;">${corrStr}</span></div></div><div class="col-right"><div class="item-name ${colorClass} num">${cagrStr}</div><div class="item-sub">CAGR</div></div></div>`;
    });
}

function updateCharts(list, totalVal, portfolioCAGR, portfolioStdev) {
    // 圓餅圖
    const sortedByVal = [...list].sort((a,b) => b.marketValueTWD - a.marketValueTWD); 
    const top5 = sortedByVal.slice(0, 5); 
    const othersVal = sortedByVal.slice(5).reduce((a,b) => a + b.marketValueTWD, 0);
    
    const labels = top5.map(i => i.name); 
    const data = top5.map(i => i.marketValueTWD); 
    const colors = ['#d93025', '#e2584f', '#ea8079', '#f2a8a4', '#f9cfce', '#dadce0', '#b0bec5', '#90a4ae', '#78909c', '#607d8b']; 
    
    if (othersVal > 0) { 
        labels.push('其他'); 
        data.push(othersVal); 
    }
    
    const legendDiv = document.getElementById('alloc-legend'); legendDiv.innerHTML = '';
    labels.forEach((lb, idx) => { 
        legendDiv.innerHTML += `<div style="margin-bottom:6px;"><span style="color:${colors[idx%colors.length]};">■</span> ${lb} (${((data[idx] / totalVal) * 100).toFixed(1)}%)</div>`; 
    });

    if (charts.alloc) charts.alloc.destroy();
    charts.alloc = new Chart(document.getElementById('allocationChart'), { 
        type: 'doughnut', 
        data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 0 }] }, 
        options: { 
            responsive: true, maintainAspectRatio: false, cutout: '75%', 
            plugins: { 
                legend: { display: false }, 
                tooltip: { callbacks: { label: function(c) { return `${c.label}: ` + (isPrivacyMode ? '****' : '$' + Math.round(c.raw).toLocaleString()) + ` (${((c.raw/totalVal)*100).toFixed(1)}%)`; } } } 
            } 
        } 
    });

    // 績效條圖 (已抽離為獨立函式，支援切換模式與動態自適應)
    window.renderPerformanceChart(list, totalVal);

    // 蒙地卡羅
    if (charts.mc) charts.mc.destroy();
    let startVal = isPrivacyMode ? 0 : totalVal / 10000; 
    const years = [-1, 0, 1, 3, 5, 10]; 
    const p50=[], p90=[], p75=[], p25=[], p10=[], hist=[];
    let hist1YVal = isPrivacyMode ? ((1 / (1 + portfolioCAGR)) - 1) * 100 : startVal / (1 + portfolioCAGR); 
    
    years.forEach(y => { 
        if (y < 0) { 
            hist.push({x: y, y: hist1YVal}); 
        } else if (y === 0) { 
            [hist, p50, p90, p75, p25, p10].forEach(arr => arr.push({x: y, y: startVal})); 
        } else { 
            let multiplier = Math.pow(1 + portfolioCAGR, y); 
            let diffusion = portfolioStdev * Math.sqrt(y); 
            if(isPrivacyMode) { 
                p50.push({x: y, y: (multiplier - 1) * 100}); 
                p90.push({x: y, y: (multiplier * (1 + 1.28 * diffusion) - 1) * 100}); 
                p75.push({x: y, y: (multiplier * (1 + 0.67 * diffusion) - 1) * 100}); 
                p25.push({x: y, y: (multiplier * (1 - 0.67 * diffusion) - 1) * 100}); 
                p10.push({x: y, y: (multiplier * (1 - 1.28 * diffusion) - 1) * 100}); 
            } else { 
                let median = startVal * multiplier; 
                p50.push({x: y, y: median}); 
                p90.push({x: y, y: median * (1 + 1.28 * diffusion)}); 
                p75.push({x: y, y: median * (1 + 0.67 * diffusion)}); 
                p25.push({x: y, y: median * (1 - 0.67 * diffusion)}); 
                p10.push({x: y, y: median * (1 - 1.28 * diffusion)}); 
            } 
        } 
    });

    charts.mc = new Chart(document.getElementById('monteCarloChart'), { 
        type: 'line', 
        data: { 
            datasets: [ 
                { label: '極樂觀 P90', data: p90, borderColor: 'transparent', fill: 1, backgroundColor: 'rgba(217, 48, 37, 0.08)', pointRadius: 0, tension: 0.4 }, 
                { label: '極悲觀 P10', data: p10, borderColor: 'transparent', fill: false, pointRadius: 0, tension: 0.4 }, 
                { label: '樂觀 P75', data: p75, borderColor: 'transparent', fill: 3, backgroundColor: 'rgba(217, 48, 37, 0.2)', pointRadius: 0, tension: 0.4 }, 
                { label: '悲觀 P25', data: p25, borderColor: 'transparent', fill: false, pointRadius: 0, tension: 0.4 }, 
                { label: '未來中位數', data: p50, borderColor: '#d93025', borderWidth: 2, borderDash: [5,4], fill: false, pointRadius: 0, tension: 0.4 }, 
                { label: '過去1年走勢', data: hist, borderColor: '#1a1a1a', borderWidth: 2.5, fill: false, pointRadius: 3, pointBackgroundColor: '#1a1a1a', tension: 0.1 } 
            ] 
        }, 
        options: { 
            responsive: true, maintainAspectRatio: false, 
            plugins: { 
                legend: { display: false }, 
                tooltip: { callbacks: { 
                    title: function(c) { return {'-1': '過去 1 年', '0': '今天', '1': '未來 1 年', '3': '未來 3 年', '5': '未來 5 年', '10': '未來 10 年'}[c[0].parsed.x] || ''; }, 
                    label: function(c) { let l = c.dataset.label ? c.dataset.label+': ' : ''; return l + (isPrivacyMode ? (c.parsed.y>0?'+':'')+Math.round(c.parsed.y)+'%' : Math.round(c.parsed.y)+'w'); } 
                } } 
            }, 
            scales: { 
                x: { type: 'linear', grid: { display: false }, min: -1, max: 10, ticks: { stepSize: 1, callback: v => ({'-1':'-1年','0':'今天','1':'+1年','3':'+3年','5':'+5年','10':'+10年'})[v]||'' } }, 
                y: { position: 'right', border: { display: false }, ticks: { callback: v => isPrivacyMode ? Math.round(v)+'%' : Math.round(v)+'w' } } 
            } 
        } 
    });

    // ==========================================
    // 現金流圖表 (極簡聚合 + 下鑽明細)
    // ==========================================
    const now = new Date(); 
    const startMonth = new Date(now.getFullYear(), now.getMonth() - 11, 1); 
    const labelsCF = [], monthKeys = [];
    
    let cfDict = {};
    for (let i = 0; i < 24; i++) { 
        const d = new Date(startMonth.getFullYear(), startMonth.getMonth() + i, 1); 
        let isFuture = i >= 12;
        let labelStr = isFuture ? `${d.getFullYear().toString().slice(-2)}/${(d.getMonth()+1).toString().padStart(2,'0')} (預估)` : `${d.getFullYear().toString().slice(-2)}/${(d.getMonth()+1).toString().padStart(2,'0')}`;
        let key = `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,'0')}`;
        
        labelsCF.push(labelStr); 
        monthKeys.push(key); 
        cfDict[key] = { label: labelStr, total: 0, isFuture: isFuture, details: [] };
    }
    
    let totalExpectedDividend = 0; 
    
    list.forEach(stock => {
        if (stock.historicalDividends && stock.historicalDividends.length > 0) {
            stock.historicalDividends.forEach(div => {
                const dDate = new Date(div.date * 1000); 
                const pKey = `${dDate.getFullYear()}-${(dDate.getMonth()+1).toString().padStart(2,'0')}`;
                const fKey = `${dDate.getFullYear() + 1}-${(dDate.getMonth() + 1).toString().padStart(2, '0')}`;
                const totalDivTWD = div.amount * stock.shares * (stock.market === 'US' ? currentRate : 1);
                
                if (cfDict[pKey] && !cfDict[pKey].isFuture) {
                    cfDict[pKey].total += totalDivTWD;
                    let existing = cfDict[pKey].details.find(d => d.name === stock.name);
                    if (existing) existing.amount += totalDivTWD;
                    else cfDict[pKey].details.push({ name: stock.name, amount: totalDivTWD });
                }
                
                if (cfDict[fKey] && cfDict[fKey].isFuture) {
                    cfDict[fKey].total += totalDivTWD;
                    let existing = cfDict[fKey].details.find(d => d.name === stock.name);
                    if (existing) existing.amount += totalDivTWD;
                    else cfDict[fKey].details.push({ name: stock.name, amount: totalDivTWD });
                    totalExpectedDividend += totalDivTWD;
                }
            });
        }
    });

    const dataCF = monthKeys.map(k => cfDict[k].total);
    const bgColorsCF = monthKeys.map(k => cfDict[k].isFuture ? 'rgba(32, 201, 151, 0.25)' : 'rgba(32, 201, 151, 1)'); 
    const borderColorsCF = monthKeys.map(k => cfDict[k].isFuture ? 'rgba(32, 201, 151, 1)' : 'transparent');
    const borderWidthsCF = monthKeys.map(k => cfDict[k].isFuture ? {top: 2, right: 2, left: 2, bottom: 0} : 0);

    document.getElementById('val-dividend').innerText = fmtMoney(totalExpectedDividend); 
    document.getElementById('val-yield').innerText = (totalVal > 0 ? (totalExpectedDividend/totalVal*100).toFixed(2) : 0) + '%';
    
    window.currentCFDict = cfDict;
    window.currentCFKeys = monthKeys;

    if (charts.cf) charts.cf.destroy();
    charts.cf = new Chart(document.getElementById('cashflowChart'), { 
        type: 'bar', 
        data: { 
            labels: labelsCF, 
            datasets: [{ 
                label: '總配息', 
                data: dataCF, 
                backgroundColor: bgColorsCF, 
                borderColor: borderColorsCF,
                borderWidth: borderWidthsCF,
                borderDash: [4, 4], 
                barPercentage: 1.0, 
                categoryPercentage: 0.95 
            }] 
        }, 
        options: { 
            responsive: true, maintainAspectRatio: false, 
            onClick: (e, elements) => {
                if (elements.length > 0) {
                    const idx = elements[0].index;
                    const key = window.currentCFKeys[idx];
                    window.showDivDetail(window.currentCFDict[key]);
                }
            },
            plugins: { 
                legend: { display: false }, 
                tooltip: { 
                    callbacks: { 
                        label: c => (isPrivacyMode ? '****' : '$' + Math.round(c.raw).toLocaleString()),
                        footer: () => '\n👇 點擊長條柱查看配息明細'
                    } 
                } 
            }, 
            scales: { 
                x: { grid: { display: false }, ticks: { font: { size: 10 }, maxRotation: 45, minRotation: 45, autoSkip: true, maxTicksLimit: 12 } }, 
                y: { position: 'right', border: { display: false }, ticks: { callback: v => isPrivacyMode ? '***' : Math.round(v/1000)+'k' } } 
            } 
        } 
    });
}

// ------------------------------------------
// 3. 深度比較報告與蒙地卡羅 (Compare & MC)
// ------------------------------------------
function openReport() {
    if(compareData.realGlobal === null || compareData.realGlobal.totalVal === 0) { showToast("請先匯入資料"); return; }
    document.getElementById('report-overlay').style.display = 'block'; document.body.style.overflow = 'hidden';
    setTimeout(() => { renderScatterChart(); renderMCCompareChart(); }, 100);
}

function closeReport() { 
    document.getElementById('report-overlay').style.display = 'none'; 
    document.body.style.overflow = ''; 
}

function renderScatterChart() {
    if (charts.scatter) charts.scatter.destroy(); 
    let d = compareData; let datasets = [];
    
    if(d.realGlobal && d.realGlobal.totalVal > 0) datasets.push({ label: '全球總持仓', data: [{x: d.realGlobal.stdev*100, y: d.realGlobal.cagr*100, r: 8}], backgroundColor: '#3498db' });
    if(d.realTW && d.realTW.totalVal > 0) datasets.push({ label: '🇹🇼 台股部位', data: [{x: d.realTW.stdev*100, y: d.realTW.cagr*100, r: 6}], backgroundColor: '#2ecc71' });
    if(d.realUS && d.realUS.totalVal > 0) datasets.push({ label: '🇺🇸 美股部位', data: [{x: d.realUS.stdev*100, y: d.realUS.cagr*100, r: 6}], backgroundColor: '#e74c3c' });
    
    const scColors = ['#f1c40f', '#9b59b6', '#00cec9', '#e67e22', '#fd79a8'];
    if(d.sandboxList && d.sandboxList.length > 0) {
        d.sandboxList.forEach((sc, idx) => { 
            if(sc.metrics && sc.metrics.totalVal > 0) { 
                datasets.push({ label: `🧪 ${sc.name}`, data: [{x: sc.metrics.stdev*100, y: sc.metrics.cagr*100, r: 8}], backgroundColor: scColors[idx % scColors.length], borderColor: '#fff', borderWidth: 1 }); 
            } 
        });
    }

    let legendHtml = ''; datasets.forEach(ds => { legendHtml += `<div class="legend-item"><div class="dot" style="background:${ds.backgroundColor}"></div>${ds.label}</div>`; }); 
    document.getElementById('scatter-legend').innerHTML = legendHtml;
    
    let gX = datasets[0]?.data[0]?.x || 0; let gY = datasets[0]?.data[0]?.y || 0;

    charts.scatter = new Chart(document.getElementById('scatterChart'), { 
        type: 'bubble', 
        data: { datasets }, 
        options: { 
            responsive: true, maintainAspectRatio: false, layout: { padding: 10 }, 
            plugins: { 
                legend: { display: false }, 
                tooltip: { callbacks: { label: c => `${c.dataset.label} (CAGR: ${c.parsed.y.toFixed(1)}%, 風險: ${c.parsed.x.toFixed(1)}%)` } }, 
                annotation: { annotations: { line1: { type: 'line', yMin: gY, yMax: gY, borderColor: 'rgba(255,255,255,0.2)', borderDash: [5,5], borderWidth: 1 }, line2: { type: 'line', xMin: gX, xMax: gX, borderColor: 'rgba(255,255,255,0.2)', borderDash: [5,5], borderWidth: 1 } } } 
            }, 
            scales: { 
                x: { grid: { color: 'rgba(255,255,255,0.05)' }, title: { display: true, text: '風險 (標準差 %)', color: '#95A5A6' }, ticks: { color: '#95A5A6' } }, 
                y: { grid: { color: 'rgba(255,255,255,0.05)' }, title: { display: true, text: '報酬 (CAGR %)', color: '#95A5A6' }, ticks: { color: '#95A5A6' } } 
            } 
        } 
    });
}

function switchMCDim(dim) {
    document.querySelectorAll('.mc-btn').forEach(b => b.classList.remove('active')); 
    document.getElementById('mc-' + dim).classList.add('active'); 
    currentMCDim = dim; 
    renderMCCompareChart();
    let descMap = { 'P10':'極度悲觀 (抗跌防禦力測試)','P25':'悲觀市況','P50':'最有可能的中位數軌跡','P75':'樂觀市況','P90':'極度樂觀 (牛市爆發力測試)','FULL':'所選組合的完整未來分佈'}; 
    document.getElementById('mc-desc-text').innerText = `目前顯示各組合的【${descMap[dim]}】。`;
}

function renderMCCompareChart() {
    if (charts.mcCompare) charts.mcCompare.destroy(); 
    let d = compareData; 
    const years = [0, 1, 3, 5, 10];
    
    const genTraj = (metrics) => { 
        let p10=[], p25=[], p50=[], p75=[], p90=[]; 
        if(!metrics || metrics.totalVal === 0) return {p10, p25, p50, p75, p90}; 
        
        let sv = metrics.totalVal / 10000; 
        years.forEach(y => { 
            if(y===0) { 
                [p10,p25,p50,p75,p90].forEach(a => a.push({x:y, y:sv})); 
            } else { 
                let m = sv * Math.pow(1 + metrics.cagr, y); 
                let diff = metrics.stdev * Math.sqrt(y); 
                p50.push({x:y, y:m}); 
                p90.push({x:y, y:m*(1+1.28*diff)}); 
                p75.push({x:y, y:m*(1+0.67*diff)}); 
                p25.push({x:y, y:m*(1-0.67*diff)}); 
                p10.push({x:y, y:m*(1-1.28*diff)}); 
            } 
        }); 
        return {p10, p25, p50, p75, p90}; 
    };
    
    let gData = genTraj(d.realGlobal); 
    let twData = genTraj(d.realTW); 
    let usData = genTraj(d.realUS); 
    let datasets = [];
    
    if(currentMCDim === 'FULL') {
        let target = gData;
        if (activeScenarioId !== 'real') { 
            let sc = d.sandboxList.find(s => s.id === activeScenarioId); 
            if (sc && sc.metrics) target = genTraj(sc.metrics); 
        }
        let labelPrefix = activeScenarioId === 'real' ? `🌍 全球:` : `🧪 試算:`;
        datasets = [ 
            { label: labelPrefix+' P90', data: target.p90, borderColor: 'transparent', fill: 1, backgroundColor: 'rgba(207, 146, 54, 0.05)', pointRadius: 0, tension: 0.4 }, 
            { label: labelPrefix+' P10', data: target.p10, borderColor: 'transparent', fill: false, pointRadius: 0, tension: 0.4 }, 
            { label: labelPrefix+' P75', data: target.p75, borderColor: 'transparent', fill: 3, backgroundColor: 'rgba(207, 146, 54, 0.15)', pointRadius: 0, tension: 0.4 }, 
            { label: labelPrefix+' P25', data: target.p25, borderColor: 'transparent', fill: false, pointRadius: 0, tension: 0.4 }, 
            { label: labelPrefix+' P50', data: target.p50, borderColor: '#CF9236', borderWidth: 2, fill: false, pointRadius: 0, tension: 0.4 } 
        ];
    } else {
        let dimKey = currentMCDim.toLowerCase();
        if(gData[dimKey].length>0) datasets.push({ label: '全球總持仓', data: gData[dimKey], borderColor: '#3498db', borderWidth: 2, fill: false, pointRadius: 3, tension: 0.4 });
        if(twData[dimKey].length>0) datasets.push({ label: '🇹🇼 台股部位', data: twData[dimKey], borderColor: '#2ecc71', borderWidth: 2, fill: false, pointRadius: 3, tension: 0.4 });
        if(usData[dimKey].length>0) datasets.push({ label: '🇺🇸 美股部位', data: usData[dimKey], borderColor: '#e74c3c', borderWidth: 2, fill: false, pointRadius: 3, tension: 0.4 });
        
        const scColors = ['#f1c40f', '#9b59b6', '#00cec9', '#e67e22', '#fd79a8'];
        d.sandboxList.forEach((sc, idx) => { 
            if(sc.metrics){ 
                let scData = genTraj(sc.metrics); 
                if(scData[dimKey].length>0) datasets.push({ label: `🧪 ${sc.name}`, data: scData[dimKey], borderColor: scColors[idx % scColors.length], borderWidth: 3, fill: false, pointRadius: 4, tension: 0.4 }); 
            } 
        });
    }
    
    charts.mcCompare = new Chart(document.getElementById('mcCompareChart'), { 
        type: 'line', 
        data: { datasets }, 
        options: { 
            responsive: true, maintainAspectRatio: false, 
            plugins: { 
                legend: { display: currentMCDim !== 'FULL', labels: { color: '#E0E6ED', boxWidth: 12, font: {size: 11} }, position: 'bottom' }, 
                tooltip: { callbacks: { title: c => ({'0':'今天','1':'未來 1 年','3':'未來 3 年','5':'未來 5 年','10':'未來 10 年'})[c[0].parsed.x]||'', label: c => c.dataset.label + ': ' + Math.round(c.parsed.y) + 'w' } } 
            }, 
            scales: { 
                x: { type: 'linear', grid: { color: 'rgba(255,255,255,0.05)' }, min: 0, max: 10, ticks: { color: '#95A5A6', stepSize: 1, callback: v => ({'0':'今天','1':'+1年','3':'+3年','5':'+5年','10':'+10年'})[v]||'' } }, 
                y: { position: 'right', border: { display: false }, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#95A5A6', callback: v => Math.round(v)+'w' } } 
            } 
        } 
    });
}

// ------------------------------------------
// 4. 【全新】歷史資產波動回測圖 (ECharts)
// ------------------------------------------
window.renderHistoryPnLChart = function() {
    let container = document.getElementById('historyPnLChart');
    if (!container) return;

    if (typeof echarts === 'undefined') {
        container.innerHTML = '<div style="color: #999; text-align: center; padding-top: 160px; font-size:12px;">⚠️ 視覺化引擎載入失敗</div>';
        return;
    }

    // 1. 過濾出有歷史資料快取的持股
    let validHoldings = globalCombinedList.filter(item => window.historicalDataCache && window.historicalDataCache[item.symbol]);
    
    if (validHoldings.length === 0) {
        if (charts.historyPnL) { charts.historyPnL.dispose(); charts.historyPnL = null; }
        container.innerHTML = '<div style="color: #999; text-align: center; padding-top: 160px; font-size:12px;">歷史資料準備中... (請確保 PBI 雷達掃描完畢)</div>';
        return;
    }

    // 清空載入提示
    container.innerHTML = '';
    
    if (charts.historyPnL) {
        charts.historyPnL.dispose();
    }
    charts.historyPnL = echarts.init(container);

    // 2. 萃取所有交易日期並排序 (解決各國休市不同的聯集對齊問題)
    let dateSet = new Set();
    validHoldings.forEach(item => {
        window.historicalDataCache[item.symbol].forEach(d => {
            // 取 YYYY-MM-DD
            dateSet.add(d.date.split('T')[0]);
        });
    });
    let sortedDates = Array.from(dateSet).sort();

    // 3. 建立各股票的快速查表 (Date -> ClosePrice)
    let stockPrices = {};
    validHoldings.forEach(item => {
        stockPrices[item.symbol] = {};
        window.historicalDataCache[item.symbol].forEach(d => {
            stockPrices[item.symbol][d.date.split('T')[0]] = d.close;
        });
    });

    // 4. 計算每日總市值與盈虧
    let dailyTotalValues = [];
    let totalCost = validHoldings.reduce((sum, item) => sum + (item.costTWD || 0), 0);
    let lastKnownPrice = {};

    sortedDates.forEach(date => {
        let dailySum = 0;
        validHoldings.forEach(item => {
            let price = stockPrices[item.symbol][date];
            if (price !== undefined) {
                lastKnownPrice[item.symbol] = price; // 更新最後已知價格
            } else {
                price = lastKnownPrice[item.symbol] || 0; // 若遇休市，沿用前一天價格
            }
            let exRate = item.market === 'US' ? currentRate : 1;
            dailySum += price * item.shares * exRate;
        });
        dailyTotalValues.push(dailySum);
    });

    let lineData = []; // 累積總盈虧
    let barData = [];  // 單日漲跌
    let barColors = [];

    for (let i = 0; i < sortedDates.length; i++) {
        let currentVal = dailyTotalValues[i];
        let cumPnL = currentVal - totalCost; // 當天總市值減去原始總成本
        lineData.push(cumPnL);

        if (i === 0) {
            barData.push(0);
            barColors.push('#999');
        } else {
            let prevVal = dailyTotalValues[i - 1];
            let diff = currentVal - prevVal;
            barData.push(diff);
            // 台灣習慣：大於等於 0 為紅，小於 0 為綠
            barColors.push(diff >= 0 ? '#d93025' : '#188038'); 
        }
    }

    // 5. 設定 ECharts 參數
    let option = {
        animationDuration: 800,
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'cross', label: { backgroundColor: '#2c3e50' } },
            formatter: function (params) {
                let date = params[0].axisValue;
                let html = `<div style="font-size:12px; border-bottom:1px solid #eee; padding-bottom:4px; margin-bottom:6px; font-weight:bold; color:#333;">📅 ${date}</div>`;
                params.forEach(p => {
                    let valStr = isPrivacyMode ? '****' : '$' + Math.round(p.value).toLocaleString();
                    let color = p.seriesType === 'bar' ? (p.value >= 0 ? '#d93025' : '#188038') : p.color;
                    let marker = `<span style="display:inline-block;margin-right:6px;border-radius:50%;width:10px;height:10px;background-color:${color};"></span>`;
                    html += `<div style="display:flex; justify-content:space-between; width:160px; font-size:13px; margin-bottom:4px;">
                                <span style="color:#666">${marker} ${p.seriesName}</span>
                                <span style="font-weight:bold; color:${color};">${valStr}</span>
                             </div>`;
                });
                return html;
            }
        },
        grid: { left: '2%', right: '2%', top: '10%', bottom: '15%', containLabel: true },
        xAxis: {
            type: 'category',
            data: sortedDates,
            axisLine: { lineStyle: { color: '#ccc' } },
            axisTick: { alignWithLabel: true },
            axisLabel: { 
                formatter: function (value) {
                    // 只顯示 MM-DD
                    return value.substring(5);
                },
                color: '#999'
            }
        },
        yAxis: [
            {
                type: 'value',
                name: '累積盈虧 (TWD)',
                nameTextStyle: { color: '#999', fontSize: 10, padding: [0, 0, 0, 20] },
                position: 'left',
                splitLine: { lineStyle: { type: 'dashed', color: '#eee' } },
                axisLabel: { 
                    formatter: (value) => isPrivacyMode ? '***' : Math.round(value/1000) + 'k',
                    color: '#999'
                }
            },
            {
                type: 'value',
                name: '單日漲跌',
                nameTextStyle: { color: '#999', fontSize: 10, padding: [0, 20, 0, 0] },
                position: 'right',
                splitLine: { show: false }, // 避免格線混亂
                axisLabel: { 
                    formatter: (value) => isPrivacyMode ? '***' : Math.round(value/1000) + 'k',
                    color: '#999'
                }
            }
        ],
        dataZoom: [
            {
                type: 'slider',
                show: true,
                bottom: 0,
                height: 20,
                start: 0,
                end: 100,
                borderColor: '#eee',
                fillerColor: 'rgba(44, 62, 80, 0.1)',
                handleStyle: { color: '#2c3e50' },
                textStyle: { color: '#999', fontSize: 10 }
            }
        ],
        series: [
            {
                name: '單日漲跌',
                type: 'bar',
                yAxisIndex: 1,
                data: barData,
                itemStyle: {
                    color: function(params) {
                        return barColors[params.dataIndex];
                    },
                    borderRadius: [2, 2, 0, 0]
                }
            },
            {
                name: '累積總盈虧',
                type: 'line',
                yAxisIndex: 0,
                data: lineData,
                smooth: true,
                showSymbol: false,
                lineStyle: { width: 2.5, color: '#2c3e50' },
                areaStyle: {
                    color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                        { offset: 0, color: 'rgba(44, 62, 80, 0.3)' },
                        { offset: 1, color: 'rgba(44, 62, 80, 0.0)' }
                    ])
                },
                itemStyle: { color: '#2c3e50' }
            }
        ]
    };

    charts.historyPnL.setOption(option);
};

// 控制回測圖表的快速縮放 (1週/1個月/3個月/1年)
window.setHistoryZoom = function(days, btnElement) {
    if (!charts.historyPnL) return;

    // UI 切換
    if (btnElement) {
        // 找到同層的所有按鈕並移除 active
        const siblings = btnElement.parentElement.querySelectorAll('.mc-btn');
        siblings.forEach(b => b.classList.remove('active'));
        btnElement.classList.add('active');
    }

    let option = charts.historyPnL.getOption();
    let totalLen = option.xAxis[0].data.length;
    
    // 計算百分比
    let startPct = 0;
    if (totalLen > days) {
        startPct = 100 - (days / totalLen * 100);
    }

    // 觸發 ECharts 行為
    charts.historyPnL.dispatchAction({
        type: 'dataZoom',
        start: startPct,
        end: 100
    });
};


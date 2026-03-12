// ==========================================
// 視覺渲染引擎 (Chart Engine & Visuals)
// 負責所有 ECharts 與 Chart.js 的繪圖邏輯
// ==========================================

// ------------------------------------------
// 1. 星系拓樸圖 (ECharts - 電影級運鏡版)
// ------------------------------------------
function renderCorrelationGraph(list, totalVal) {
    let container = document.getElementById('correlationGraph');
    let hud = document.getElementById('galaxy-hud');
    hud.classList.remove('show'); 
    
    if (typeof echarts === 'undefined') {
        container.innerHTML = '<div style="color: #8b949e; text-align: center; padding-top: 180px; font-size:13px;">⚠️ 視覺化引擎載入失敗<br><span style="font-size:11px;">請檢查網路環境或關閉廣告阻擋器 (AdBlocker)</span></div>';
        return;
    }

    if (list.length < 2 || totalVal <= 0) {
        container.innerHTML = '<div style="color: #666; text-align: center; padding-top: 200px; font-size:12px;">🪐 至少需要 2 檔以上標的才能運算引力</div>';
        if (charts.corr) { charts.corr.dispose(); charts.corr = null; }
        return;
    }
    container.innerHTML = '';

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

                    // 微光星座骨架 (極淡、無干擾)
                    fullGalaxyLinks.push({
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
                        tooltip: { show: false } // 【情報靜默】絕對禁止彈出黑框
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

        let borderColor = (isHub || isHedge) ? '#CF9236' : '#ffffff';
        let borderWidth = (isHub || isHedge) ? 4 : 0;

        fullGalaxyNodes.push({
            id: s.symbol,
            name: s.symbol.replace('.TW', ''), 
            value: (weight * 100).toFixed(1) + '%',
            symbolSize: size, 
            _baseSize: size, 
            itemStyle: { 
                color: isProfit ? '#d93025' : '#188038', 
                shadowBlur: (isHub || isHedge) ? 30 : 15, 
                shadowColor: isProfit ? 'rgba(217, 48, 37, 0.8)' : 'rgba(24, 128, 56, 0.8)',
                borderColor: borderColor,
                borderWidth: borderWidth
            },
            label: { show: size >= 35, position: 'inside', color: '#fff', fontSize: 10, fontWeight: 'bold' }
        });
    });

    if (!charts.corr) { charts.corr = echarts.init(container); }
    
    // 【斬除幽靈監聽器】防止切換模式時狀態疊加崩潰
    charts.corr.off('click');
    charts.corr.getZr().off('click');

    let option = {
        animationDurationUpdate: 800, // 電影級平滑推進
        animationEasingUpdate: 'quinticInOut',
        tooltip: { show: false }, // 全域靜默
        series: [{
            type: 'graph',
            layout: 'force',
            roam: false, 
            draggable: false, 
            data: fullGalaxyNodes,
            links: fullGalaxyLinks, 
            force: { repulsion: 150, edgeLength: [50, 120], gravity: 0.1 },
            emphasis: { focus: 'none' } 
        }]
    };
    charts.corr.setOption(option, true); 

    // 【光學迷彩與大爆炸擴張】
    charts.corr.on('click', function(params) {
        if(params.dataType === 'edge') return; // 防誤觸線條

        if(params.dataType === 'node') {
            let clickedId = params.data.id;
            let clickedName = params.data.name;
            
            // 絕對星狀拓樸 (只抓直屬關係)
            let relatedIds = new Set([clickedId]);
            rawLinkData.forEach(l => {
                if(l.source === clickedId) relatedIds.add(l.target);
                if(l.target === clickedId) relatedIds.add(l.source);
            });

            // 1. 光學迷彩 ＆ 主星加冕 (1.5倍 ＋ 白框)
            let subsetNodes = fullGalaxyNodes.filter(n => relatedIds.has(n.id)).map(n => {
                let isMain = (n.id === clickedId);
                return { 
                    ...n, 
                    symbolSize: isMain ? n._baseSize * 1.5 : n._baseSize * 1.1,
                    itemStyle: { 
                        ...n.itemStyle, 
                        borderColor: isMain ? '#ffffff' : n.itemStyle.borderColor,
                        borderWidth: isMain ? 4 : n.itemStyle.borderWidth,
                        shadowBlur: isMain ? 35 : n.itemStyle.shadowBlur
                    },
                    label: { ...n.label, show: true, fontSize: isMain ? 14 : 11 } 
                };
            });

            // 2. 濾除私下連線，留下專屬射線並 100% 爆亮
            let subsetLinks = rawLinkData.filter(l => l.source === clickedId || l.target === clickedId).map(l => {
                let w = l.isNegative ? 3 : Math.min(8, Math.abs(l.r) * 6);
                return {
                    source: l.source, target: l.target,
                    lineStyle: {
                        color: l.isNegative ? '#00e676' : '#ff4757', width: w + 2,
                        type: l.isNegative ? 'dashed' : 'solid', curveness: 0.1,
                        opacity: 1, shadowBlur: 15, shadowColor: l.isNegative ? '#00e676' : '#ff4757'
                    },
                    silent: true, tooltip: { show: false }
                };
            });

            // 3. 大爆炸：斥力翻倍 (150 -> 400)
            charts.corr.setOption({ 
                series: [{ 
                    data: subsetNodes, 
                    links: subsetLinks,
                    force: { repulsion: 400, edgeLength: [80, 150], gravity: 0.1 } 
                }] 
            });

            // 4. 極簡 HUD 量化顯示
            let stats = nodeStatsMap[clickedId];
            let wStr = (stats.weight * 100).toFixed(1) + '%';
            let cStr = stats.avgCorr > 0 ? '+' + stats.avgCorr.toFixed(2) : stats.avgCorr.toFixed(2);
            let cColor = stats.avgCorr > 0.4 ? '#ff4757' : (stats.avgCorr < -0.15 ? '#00e676' : '#8b949e');
            
            hud.innerHTML = `聚焦：<b>${clickedName}</b> ｜ 資金佔比：<b>${wStr}</b> ｜ 組合連動度：<b style="color:${cColor};">${cStr}</b>`;
            hud.classList.add('show');
        }
    });

    // 點擊空白復原
    charts.corr.getZr().on('click', function(e) {
        if (!e.target) { 
            if(charts.corr && !charts.corr.isDisposed()) {
                charts.corr.setOption({ 
                    series: [{ 
                        data: fullGalaxyNodes, 
                        links: fullGalaxyLinks,
                        force: { repulsion: 150, edgeLength: [50, 120], gravity: 0.1 }
                    }] 
                });
                hud.classList.remove('show');
            }
        }
    });
}

// ------------------------------------------
// 2. 主畫面與基礎圖表渲染
// ------------------------------------------
function renderDashboard(list) {
    if (list.length === 0) {
        document.getElementById('val-total').innerText = fmtMoney(0); document.getElementById('val-cost').innerText = fmtMoney(0); document.getElementById('val-profit').innerText = fmtMoney(0); document.getElementById('val-profit').className = 'stat-main num text-muted'; document.getElementById('val-profit-pct').innerText = '0.00%'; document.getElementById('val-profit-pct').className = 'stat-sub num text-muted'; document.getElementById('val-day-change').innerText = fmtMoney(0); document.getElementById('val-day-change').className = 'stat-main num text-muted'; document.getElementById('val-day-change-pct').innerText = '0.00%'; document.getElementById('val-day-change-pct').className = 'stat-sub num text-muted'; document.getElementById('val-ytd').innerText = fmtMoney(0); document.getElementById('val-ytd').className = 'stat-main num text-muted'; document.getElementById('val-ytd-pct').innerText = '0.00%'; document.getElementById('val-ytd-pct').className = 'stat-sub num text-muted'; document.getElementById('val-cagr').innerText = '0.0%'; document.getElementById('val-cagr').className = 'stat-main num text-muted'; document.getElementById('val-stdev').innerText = '--%'; document.getElementById('val-dividend').innerText = fmtMoney(0); document.getElementById('val-yield').innerText = '0.00%';
        if (charts.alloc) charts.alloc.destroy(); if (charts.perf) charts.perf.destroy(); if (charts.mc) charts.mc.destroy(); if (charts.cf) charts.cf.destroy();
        if (charts.corr) { charts.corr.dispose(); charts.corr = null; }
        document.getElementById('alloc-legend').innerHTML = '<div style="color: #999; text-align: center; margin-top: 50px;">此市場暫無資料</div>'; updateRiskList([]); return;
    }
    
    const totalVal = list.reduce((a, b) => a + (b.marketValueTWD || 0), 0); const totalCost = list.reduce((a, b) => a + (b.costTWD || 0), 0); const totalProfit = totalVal - totalCost; const dayChange = list.reduce((a, b) => a + (b.dayChangeTWD || 0), 0);
    document.getElementById('val-total').innerText = fmtMoney(totalVal); document.getElementById('val-cost').innerText = fmtMoney(totalCost);
    const profitEl = document.getElementById('val-profit'); profitEl.innerText = (totalProfit > 0 ? '+' : '') + fmtMoney(totalProfit); profitEl.className = `stat-main num ${totalProfit >= 0 ? 'text-red' : 'text-green'}`;
    const profitPctEl = document.getElementById('val-profit-pct'); profitPctEl.innerText = (totalCost > 0 ? ((totalProfit/totalCost)*100).toFixed(2) : 0) + '%'; profitPctEl.className = `stat-sub num ${totalProfit >= 0 ? 'text-red' : 'text-green'}`;
    const dayEl = document.getElementById('val-day-change'); const dayPctEl = document.getElementById('val-day-change-pct'); const dayPct = totalVal > 0 ? (dayChange / totalVal) : 0;
    if (Math.abs(dayPct) > 0.25) { dayEl.innerText = '盤後/異常'; dayEl.className = 'stat-main num text-muted'; dayPctEl.innerText = '--%'; dayPctEl.className = 'stat-sub num text-muted'; } else { dayEl.innerText = (dayChange > 0 ? '+' : '') + fmtMoney(dayChange); dayEl.className = `stat-main num ${dayChange >= 0 ? 'text-red' : 'text-green'}`; dayPctEl.innerText = (dayPct > 0 ? '+' : '') + (dayPct * 100).toFixed(2) + '%'; dayPctEl.className = `stat-sub num ${dayChange >= 0 ? 'text-red' : 'text-green'}`; }
    
    let weightedYTD = 0, weightedCAGR = 0;
    if (totalVal > 0) { list.forEach(i => { let w = (i.marketValueTWD / totalVal); if (i.ytd) weightedYTD += i.ytd * w; if (i.cagr) weightedCAGR += i.cagr * w; }); }
    
    const ytdAmount = totalVal - (totalVal / (1 + weightedYTD)); document.getElementById('val-ytd').innerText = (ytdAmount > 0 ? '+' : '') + fmtMoney(ytdAmount); document.getElementById('val-ytd').className = `stat-main num ${ytdAmount >= 0 ? 'text-red' : 'text-green'}`; document.getElementById('val-ytd-pct').innerText = (weightedYTD > 0 ? '+' : '') + (weightedYTD * 100).toFixed(2) + '%'; document.getElementById('val-ytd-pct').className = `stat-sub num ${ytdAmount >= 0 ? 'text-red' : 'text-green'}`;
    document.getElementById('val-cagr').innerText = (weightedCAGR * 100).toFixed(1) + '%'; document.getElementById('val-cagr').className = weightedCAGR >= 0 ? 'stat-main num text-red' : 'stat-main num text-green'; 
    
    let matrixStdev = typeof calculateMatrixRisk === 'function' ? calculateMatrixRisk(list, totalVal) : 0;
    document.getElementById('val-stdev').innerText = (matrixStdev * 100).toFixed(1) + '%';
    
    // 必須先畫星系圖 (產生 nodeStatsMap)，再畫風險列表
    renderCorrelationGraph(list, totalVal);
    updateCharts(list, totalVal, weightedCAGR, matrixStdev); 
    updateRiskList(list);
}

function updateRiskList(list) {
    const container = document.getElementById('risk-list'); container.innerHTML = '';
    if(list.length === 0) { container.innerHTML = '<div style="color: #999; text-align: center; padding: 20px;">請先匯入資料</div>'; return; }
    
    // 市值排序
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
    const sortedByVal = [...list].sort((a,b) => b.marketValueTWD - a.marketValueTWD); const top5 = sortedByVal.slice(0, 5); const othersVal = sortedByVal.slice(5).reduce((a,b) => a + b.marketValueTWD, 0);
    const labels = top5.map(i => i.name); const data = top5.map(i => i.marketValueTWD); const colors = ['#d93025', '#e2584f', '#ea8079', '#f2a8a4', '#f9cfce', '#dadce0', '#b0bec5', '#90a4ae', '#78909c', '#607d8b']; if (othersVal > 0) { labels.push('其他'); data.push(othersVal); }
    const legendDiv = document.getElementById('alloc-legend'); legendDiv.innerHTML = '';
    labels.forEach((lb, idx) => { legendDiv.innerHTML += `<div style="margin-bottom:6px;"><span style="color:${colors[idx%colors.length]};">■</span> ${lb} (${((data[idx] / totalVal) * 100).toFixed(1)}%)</div>`; });

    if (charts.alloc) charts.alloc.destroy();
    charts.alloc = new Chart(document.getElementById('allocationChart'), { type: 'doughnut', data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 0 }] }, options: { responsive: true, maintainAspectRatio: false, cutout: '75%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: function(c) { return `${c.label}: ` + (isPrivacyMode ? '****' : '$' + Math.round(c.raw).toLocaleString()) + ` (${((c.raw/totalVal)*100).toFixed(1)}%)`; } } } } } });

    if (charts.perf) charts.perf.destroy();
    charts.perf = new Chart(document.getElementById('performanceChart'), { type: 'bar', data: { labels: sortedByVal.map(i => `${i.name} (${totalVal > 0 ? ((i.marketValueTWD / totalVal) * 100).toFixed(1) : 0}%)`), datasets: [{ label: '成本', data: sortedByVal.map(i => i.costTWD), backgroundColor: '#e0e0e0', barPercentage: 0.7, categoryPercentage: 0.6 }, { label: '現值', data: sortedByVal.map(i => i.marketValueTWD), backgroundColor: sortedByVal.map(i => i.marketValueTWD >= i.costTWD ? '#d93025' : '#188038'), barPercentage: 0.7, categoryPercentage: 0.6 }] }, options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, scales: { x: { display: false }, y: { grid: { display: false }, ticks: { font: { size: 10 } } } }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: function(c) { return `${c.dataset.label}: ` + (isPrivacyMode ? '****' : '$' + Math.round(c.raw).toLocaleString()); } } } } } });

    if (charts.mc) charts.mc.destroy();
    let startVal = isPrivacyMode ? 0 : totalVal / 10000; const years = [-1, 0, 1, 3, 5, 10]; const p50=[], p90=[], p75=[], p25=[], p10=[], hist=[];
    let hist1YVal = isPrivacyMode ? ((1 / (1 + portfolioCAGR)) - 1) * 100 : startVal / (1 + portfolioCAGR); 
    years.forEach(y => { if (y < 0) { hist.push({x: y, y: hist1YVal}); } else if (y === 0) { [hist, p50, p90, p75, p25, p10].forEach(arr => arr.push({x: y, y: startVal})); } else { let multiplier = Math.pow(1 + portfolioCAGR, y); let diffusion = portfolioStdev * Math.sqrt(y); if(isPrivacyMode) { p50.push({x: y, y: (multiplier - 1) * 100}); p90.push({x: y, y: (multiplier * (1 + 1.28 * diffusion) - 1) * 100}); p75.push({x: y, y: (multiplier * (1 + 0.67 * diffusion) - 1) * 100}); p25.push({x: y, y: (multiplier * (1 - 0.67 * diffusion) - 1) * 100}); p10.push({x: y, y: (multiplier * (1 - 1.28 * diffusion) - 1) * 100}); } else { let median = startVal * multiplier; p50.push({x: y, y: median}); p90.push({x: y, y: median * (1 + 1.28 * diffusion)}); p75.push({x: y, y: median * (1 + 0.67 * diffusion)}); p25.push({x: y, y: median * (1 - 0.67 * diffusion)}); p10.push({x: y, y: median * (1 - 1.28 * diffusion)}); } } });

    charts.mc = new Chart(document.getElementById('monteCarloChart'), { type: 'line', data: { datasets: [ { label: '極樂觀 P90', data: p90, borderColor: 'transparent', fill: 1, backgroundColor: 'rgba(217, 48, 37, 0.08)', pointRadius: 0, tension: 0.4 }, { label: '極悲觀 P10', data: p10, borderColor: 'transparent', fill: false, pointRadius: 0, tension: 0.4 }, { label: '樂觀 P75', data: p75, borderColor: 'transparent', fill: 3, backgroundColor: 'rgba(217, 48, 37, 0.2)', pointRadius: 0, tension: 0.4 }, { label: '悲觀 P25', data: p25, borderColor: 'transparent', fill: false, pointRadius: 0, tension: 0.4 }, { label: '未來中位數', data: p50, borderColor: '#d93025', borderWidth: 2, borderDash: [5,4], fill: false, pointRadius: 0, tension: 0.4 }, { label: '過去1年走勢', data: hist, borderColor: '#1a1a1a', borderWidth: 2.5, fill: false, pointRadius: 3, pointBackgroundColor: '#1a1a1a', tension: 0.1 } ] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { title: function(c) { return {'-1': '過去 1 年', '0': '今天', '1': '未來 1 年', '3': '未來 3 年', '5': '未來 5 年', '10': '未來 10 年'}[c[0].parsed.x] || ''; }, label: function(c) { let l = c.dataset.label ? c.dataset.label+': ' : ''; return l + (isPrivacyMode ? (c.parsed.y>0?'+':'')+Math.round(c.parsed.y)+'%' : Math.round(c.parsed.y)+'w'); } } } }, scales: { x: { type: 'linear', grid: { display: false }, min: -1, max: 10, ticks: { stepSize: 1, callback: v => ({'-1':'-1年','0':'今天','1':'+1年','3':'+3年','5':'+5年','10':'+10年'})[v]||'' } }, y: { position: 'right', border: { display: false }, ticks: { callback: v => isPrivacyMode ? Math.round(v)+'%' : Math.round(v)+'w' } } } } });

    const now = new Date(); const startMonth = new Date(now.getFullYear(), now.getMonth() - 11, 1); const labelsCF = [], monthKeys = [];
    for (let i = 0; i < 24; i++) { const d = new Date(startMonth.getFullYear(), startMonth.getMonth() + i, 1); labelsCF.push(i < 12 ? `${d.getFullYear().toString().slice(-2)}/${(d.getMonth()+1).toString().padStart(2,'0')}` : `${d.getFullYear().toString().slice(-2)}/${(d.getMonth()+1).toString().padStart(2,'0')} (預估)`); monthKeys.push(`${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,'0')}`); }
    const datasetsCF = []; let totalExpectedDividend = 0; const cfColors = ['217,48,37', '24,128,56', '253,188,4', '26,115,232', '242,139,130', '129,201,149', '253,226,147', '138,180,248'];
    list.forEach((stock, sIdx) => {
        const dataArr = new Array(24).fill(0); const bgColors = []; const rgb = cfColors[sIdx % cfColors.length];
        for(let i=0; i<24; i++) bgColors.push(i < 12 ? `rgba(${rgb}, 0.9)` : `rgba(${rgb}, 0.35)`);
        if (stock.historicalDividends && stock.historicalDividends.length > 0) {
            stock.historicalDividends.forEach(div => {
                const dDate = new Date(div.date * 1000); const key = `${dDate.getFullYear()}-${(dDate.getMonth()+1).toString().padStart(2,'0')}`;
                const totalDivTWD = div.amount * stock.shares * (stock.market === 'US' ? currentRate : 1);
                let pIdx = monthKeys.indexOf(key); if (pIdx >= 0 && pIdx < 12) dataArr[pIdx] += totalDivTWD;
                let fKey = `${dDate.getFullYear() + 1}-${(dDate.getMonth() + 1).toString().padStart(2, '0')}`;
                let fIdx = monthKeys.indexOf(fKey); if (fIdx >= 12 && fIdx < 24) { dataArr[fIdx] += totalDivTWD; totalExpectedDividend += totalDivTWD; }
            });
        }
        if (dataArr.some(v => v > 0)) datasetsCF.push({ label: stock.name, data: dataArr, backgroundColor: bgColors, borderWidth: 0 });
    });
    document.getElementById('val-dividend').innerText = fmtMoney(totalExpectedDividend); document.getElementById('val-yield').innerText = (totalVal > 0 ? (totalExpectedDividend/totalVal*100).toFixed(2) : 0) + '%';
    if (charts.cf) charts.cf.destroy();
    charts.cf = new Chart(document.getElementById('cashflowChart'), { type: 'bar', data: { labels: labelsCF, datasets: datasetsCF }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false, filter: p => p.raw > 0, itemSort: (a,b) => b.raw - a.raw, callbacks: { label: c => (c.dataset.label ? c.dataset.label+': ' : '') + (isPrivacyMode ? '****' : '$' + Math.round(c.raw).toLocaleString()), footer: items => '\n當月總計: ' + (isPrivacyMode ? '****' : '$' + Math.round(items.reduce((s,i)=>s+i.parsed.y,0)).toLocaleString()) } } }, scales: { x: { stacked: true, grid: { display: false }, ticks: { font: { size: 10 }, maxRotation: 45, minRotation: 45, autoSkip: true, maxTicksLimit: 12 } }, y: { stacked: true, position: 'right', border: { display: false }, ticks: { callback: v => isPrivacyMode ? '***' : Math.round(v/1000)+'k' } } } } });
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
    if (charts.scatter) charts.scatter.destroy(); let d = compareData; let datasets = [];
    if(d.realGlobal && d.realGlobal.totalVal > 0) datasets.push({ label: '全球總持倉', data: [{x: d.realGlobal.stdev*100, y: d.realGlobal.cagr*100, r: 8}], backgroundColor: '#3498db' });
    if(d.realTW && d.realTW.totalVal > 0) datasets.push({ label: '🇹🇼 台股部位', data: [{x: d.realTW.stdev*100, y: d.realTW.cagr*100, r: 6}], backgroundColor: '#2ecc71' });
    if(d.realUS && d.realUS.totalVal > 0) datasets.push({ label: '🇺🇸 美股部位', data: [{x: d.realUS.stdev*100, y: d.realUS.cagr*100, r: 6}], backgroundColor: '#e74c3c' });
    
    const scColors = ['#f1c40f', '#9b59b6', '#00cec9', '#e67e22', '#fd79a8'];
    if(d.sandboxList && d.sandboxList.length > 0) {
        d.sandboxList.forEach((sc, idx) => { if(sc.metrics && sc.metrics.totalVal > 0) { datasets.push({ label: `🧪 ${sc.name}`, data: [{x: sc.metrics.stdev*100, y: sc.metrics.cagr*100, r: 8}], backgroundColor: scColors[idx % scColors.length], borderColor: '#fff', borderWidth: 1 }); } });
    }

    let legendHtml = ''; datasets.forEach(ds => { legendHtml += `<div class="legend-item"><div class="dot" style="background:${ds.backgroundColor}"></div>${ds.label}</div>`; }); document.getElementById('scatter-legend').innerHTML = legendHtml;
    let gX = datasets[0]?.data[0]?.x || 0; let gY = datasets[0]?.data[0]?.y || 0;

    charts.scatter = new Chart(document.getElementById('scatterChart'), { type: 'bubble', data: { datasets }, options: { responsive: true, maintainAspectRatio: false, layout: { padding: 10 }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${c.dataset.label} (CAGR: ${c.parsed.y.toFixed(1)}%, 風險: ${c.parsed.x.toFixed(1)}%)` } }, annotation: { annotations: { line1: { type: 'line', yMin: gY, yMax: gY, borderColor: 'rgba(255,255,255,0.2)', borderDash: [5,5], borderWidth: 1 }, line2: { type: 'line', xMin: gX, xMax: gX, borderColor: 'rgba(255,255,255,0.2)', borderDash: [5,5], borderWidth: 1 } } } }, scales: { x: { grid: { color: 'rgba(255,255,255,0.05)' }, title: { display: true, text: '風險 (標準差 %)', color: '#95A5A6' }, ticks: { color: '#95A5A6' } }, y: { grid: { color: 'rgba(255,255,255,0.05)' }, title: { display: true, text: '報酬 (CAGR %)', color: '#95A5A6' }, ticks: { color: '#95A5A6' } } } } });
}

function switchMCDim(dim) {
    document.querySelectorAll('.mc-btn').forEach(b => b.classList.remove('active')); document.getElementById('mc-' + dim).classList.add('active'); currentMCDim = dim; renderMCCompareChart();
    let descMap = { 'P10':'極度悲觀 (抗跌防禦力測試)','P25':'悲觀市況','P50':'最有可能的中位數軌跡','P75':'樂觀市況','P90':'極度樂觀 (牛市爆發力測試)','FULL':'所選組合的完整未來分佈'}; document.getElementById('mc-desc-text').innerText = `目前顯示各組合的【${descMap[dim]}】。`;
}

function renderMCCompareChart() {
    if (charts.mcCompare) charts.mcCompare.destroy(); let d = compareData; const years = [0, 1, 3, 5, 10];
    const genTraj = (metrics) => { let p10=[], p25=[], p50=[], p75=[], p90=[]; if(!metrics || metrics.totalVal === 0) return {p10, p25, p50, p75, p90}; let sv = metrics.totalVal / 10000; years.forEach(y => { if(y===0) { [p10,p25,p50,p75,p90].forEach(a => a.push({x:y, y:sv})); }  else { let m = sv * Math.pow(1 + metrics.cagr, y); let diff = metrics.stdev * Math.sqrt(y); p50.push({x:y, y:m}); p90.push({x:y, y:m*(1+1.28*diff)}); p75.push({x:y, y:m*(1+0.67*diff)}); p25.push({x:y, y:m*(1-0.67*diff)}); p10.push({x:y, y:m*(1-1.28*diff)}); } }); return {p10, p25, p50, p75, p90}; };
    let gData = genTraj(d.realGlobal); let twData = genTraj(d.realTW); let usData = genTraj(d.realUS); let datasets = [];
    
    if(currentMCDim === 'FULL') {
        let target = gData;
        if (activeScenarioId !== 'real') { let sc = d.sandboxList.find(s => s.id === activeScenarioId); if (sc && sc.metrics) target = genTraj(sc.metrics); }
        let labelPrefix = activeScenarioId === 'real' ? `🌍 全球:` : `🧪 試算:`;
        datasets = [ { label: labelPrefix+' P90', data: target.p90, borderColor: 'transparent', fill: 1, backgroundColor: 'rgba(207, 146, 54, 0.05)', pointRadius: 0, tension: 0.4 }, { label: labelPrefix+' P10', data: target.p10, borderColor: 'transparent', fill: false, pointRadius: 0, tension: 0.4 }, { label: labelPrefix+' P75', data: target.p75, borderColor: 'transparent', fill: 3, backgroundColor: 'rgba(207, 146, 54, 0.15)', pointRadius: 0, tension: 0.4 }, { label: labelPrefix+' P25', data: target.p25, borderColor: 'transparent', fill: false, pointRadius: 0, tension: 0.4 }, { label: labelPrefix+' P50', data: target.p50, borderColor: '#CF9236', borderWidth: 2, fill: false, pointRadius: 0, tension: 0.4 } ];
    } else {
        let dimKey = currentMCDim.toLowerCase();
        if(gData[dimKey].length>0) datasets.push({ label: '全球總持倉', data: gData[dimKey], borderColor: '#3498db', borderWidth: 2, fill: false, pointRadius: 3, tension: 0.4 });
        if(twData[dimKey].length>0) datasets.push({ label: '🇹🇼 台股部位', data: twData[dimKey], borderColor: '#2ecc71', borderWidth: 2, fill: false, pointRadius: 3, tension: 0.4 });
        if(usData[dimKey].length>0) datasets.push({ label: '🇺🇸 美股部位', data: usData[dimKey], borderColor: '#e74c3c', borderWidth: 2, fill: false, pointRadius: 3, tension: 0.4 });
        
        const scColors = ['#f1c40f', '#9b59b6', '#00cec9', '#e67e22', '#fd79a8'];
        d.sandboxList.forEach((sc, idx) => { if(sc.metrics){ let scData = genTraj(sc.metrics); if(scData[dimKey].length>0) datasets.push({ label: `🧪 ${sc.name}`, data: scData[dimKey], borderColor: scColors[idx % scColors.length], borderWidth: 3, fill: false, pointRadius: 4, tension: 0.4 }); } });
    }
    charts.mcCompare = new Chart(document.getElementById('mcCompareChart'), { type: 'line', data: { datasets }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: currentMCDim !== 'FULL', labels: { color: '#E0E6ED', boxWidth: 12, font: {size: 11} }, position: 'bottom' }, tooltip: { callbacks: { title: c => ({'0':'今天','1':'未來 1 年','3':'未來 3 年','5':'未來 5 年','10':'未來 10 年'})[c[0].parsed.x]||'', label: c => c.dataset.label + ': ' + Math.round(c.parsed.y) + 'w' } } }, scales: { x: { type: 'linear', grid: { color: 'rgba(255,255,255,0.05)' }, min: 0, max: 10, ticks: { color: '#95A5A6', stepSize: 1, callback: v => ({'0':'今天','1':'+1年','3':'+3年','5':'+5年','10':'+10年'})[v]||'' } }, y: { position: 'right', border: { display: false }, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#95A5A6', callback: v => Math.round(v)+'w' } } } } });
}

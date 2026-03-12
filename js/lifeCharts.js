// ==========================================
// 財務自由模擬 - 視覺渲染引擎 (Charts & Reports)
// 負責 Chart.js 繪製、熱力圖生成、橫向比較表渲染
// ==========================================

let assetChartInstance = null;

// ==========================================
// 1. 渲染生涯健康熱力圖 (Heatmap)
// ==========================================
function renderHeatmap(data) {
    const tbody = document.getElementById('heatmap-body');
    let html = '';
    data.forEach(d => {
        html += `
        <tr>
            <td class="hm-age">${d.age}</td>
            <td><span class="hm-cell ${d.i1_c}" onclick="showHmTooltip(this)" data-tip="${d.i1_t}"></span></td>
            <td><span class="hm-cell ${d.i2_c}" onclick="showHmTooltip(this)" data-tip="${d.i2_t}"></span></td>
            <td><span class="hm-cell ${d.i3_c}" onclick="showHmTooltip(this)" data-tip="${d.i3_t}"></span></td>
            <td><span class="hm-cell ${d.i4_c}" onclick="showHmTooltip(this)" data-tip="${d.i4_t}"></span></td>
            <td><span class="hm-cell ${d.i5_c}" onclick="showHmTooltip(this)" data-tip="${d.i5_t}"></span></td>
        </tr>`;
    });
    tbody.innerHTML = html;
}

// ==========================================
// 2. 渲染劇本橫向比較表 (Comparison Table)
// ==========================================
function renderComparisonTable() {
    const tbody = document.getElementById('comp-table');
    let html = `
        <tr>
            <th>劇本名稱</th>
            <th>月現金流</th>
            <th>耗盡年紀</th>
            <th>退休時總身價</th>
            <th>80歲流動資金</th>
            <th>80歲總身價</th>
        </tr>
    `;
    appData.scenarios.forEach(sc => {
        const r = sc.results || {};
        const cf = r.cashFlow || 0;
        const cfStr = (cf > 0 ? '+' : '') + fmt(cf);
        const dep = r.depletionAge ? r.depletionAge + ' 歲' : '♾️ 永續';
        const ret = r.retireNW !== undefined ? '$' + fmt(r.retireNW) : '-';
        const a80Liq = r.a80Liquid !== undefined ? '$' + fmt(r.a80Liquid) : '-';
        const a80 = r.a80NW !== undefined ? '$' + fmt(r.a80NW) : '-';
        
        const isActive = sc.id === appData.currentId;
        const rowStyle = isActive ? 'background-color: rgba(0, 86, 179, 0.05); font-weight: bold;' : '';
        
        html += `
            <tr style="${rowStyle}">
                <td style="text-align:left;">${sc.name} ${isActive ? '<span style="font-size:10px;">(目前)</span>' : ''}</td>
                <td style="color: ${cf>=0 ? 'var(--color-positive)' : 'var(--color-negative)'}">${cfStr}</td>
                <td style="color: ${r.depletionAge ? 'var(--color-negative)' : 'var(--color-positive)'}">${dep}</td>
                <td>${ret}</td>
                <td style="color: inherit">${a80Liq}</td>
                <td style="color: inherit">${a80}</td>
            </tr>
        `;
    });
    tbody.innerHTML = html;
}

// ==========================================
// 3. 繪製資產壽命預測長條圖 (Chart.js)
// ==========================================
function updateChart(chartData) {
    const ctx = document.getElementById('assetChart').getContext('2d');
    
    // 如果圖表已經存在，先銷毀避免重疊
    if (assetChartInstance) {
        assetChartInstance.destroy();
    }

    const labels = chartData.map(d => d.age);
    const liquidData = chartData.map(d => d.liquid);
    const equityData = chartData.map(d => d.equity);

    assetChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                { 
                    label: '流動資金與投資', 
                    data: liquidData, 
                    backgroundColor: 'rgba(32, 201, 151, 0.8)', 
                    stack: 'Stack 0' 
                },
                { 
                    label: '房產淨值', 
                    data: equityData, 
                    backgroundColor: 'rgba(245, 166, 35, 0.8)', 
                    stack: 'Stack 0' 
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { 
                    stacked: true, 
                    grid: { display: false } 
                },
                y: { 
                    stacked: true, 
                    min: 0, 
                    ticks: { 
                        callback: function(value) { 
                            if (value >= 10000) return (value / 10000) + '萬'; 
                            return value; 
                        } 
                    } 
                }
            },
            plugins: {
                legend: { 
                    position: 'bottom', 
                    labels: { boxWidth: 12, font: { size: 11 } } 
                },
                tooltip: { 
                    mode: 'index', 
                    intersect: false, 
                    callbacks: { 
                        label: function(context) { 
                            let label = context.dataset.label || ''; 
                            if (label) { label += ': '; } 
                            if (context.parsed.y !== null) { 
                                label += '$' + Math.round(context.parsed.y).toLocaleString(); 
                            } 
                            return label; 
                        } 
                    } 
                }
            }
        }
    });
}

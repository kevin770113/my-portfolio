import { state } from './state.js';
import { 
    showToast, openConfirmModal, closeConfirmModal, 
    openScenPrompt, closeScenPrompt, showInfoModal, 
    setLoading, generateId 
} from './utils.js';
import { updateFinanceData } from './api.js';

// ==========================================
// 劇本切換系統 (Scenario Management)
// ==========================================
export function openScenModal() {
    const listEl = document.getElementById('scen-list');
    if (!listEl) return;
    listEl.innerHTML = '';
    let html = `<div class="scen-item" style="${state.activeScenarioId === 'real' ? 'background:rgba(0,86,179,0.05); font-weight:bold;' : ''}"><div class="scen-name" onclick="window.switchScenario('real')">🌍 真實持股 (鎖定) ${state.activeScenarioId === 'real' ? '✅' : ''}</div></div>`;
    
    state.sandboxScenarios.forEach(sc => { 
        let isAct = state.activeScenarioId === sc.id; 
        html += `<div class="scen-item" style="${isAct ? 'background:rgba(245,166,35,0.05); font-weight:bold;' : ''}"><div class="scen-name" onclick="window.switchScenario('${sc.id}')">🧪 ${sc.name} ${isAct ? '✅' : ''}</div><div class="scen-actions"><button class="scen-btn" onclick="window.renameScenario('${sc.id}')">✏️</button><button class="scen-btn" onclick="window.deleteScenario('${sc.id}')">🗑️</button></div></div>`; 
    });
    
    listEl.innerHTML = html; 
    document.getElementById('scen-overlay').classList.add('active'); 
    setTimeout(() => document.getElementById('scen-sheet').classList.add('show'), 10);
}

export function closeScenModal() { 
    document.getElementById('scen-sheet').classList.remove('show'); 
    setTimeout(() => document.getElementById('scen-overlay').classList.remove('active'), 300); 
}

export function createNewScenario() { 
    closeScenModal(); 
    openScenPrompt("請輸入新試算劇本名稱：", "我的實驗組合", (name) => { 
        if(name && name.trim()){ 
            const newId = generateId(); 
            state.sandboxScenarios.push({ 
                id: newId, 
                name: name.trim(), 
                portfolio: { 
                    tw: JSON.parse(JSON.stringify(state.realPortfolio.tw)), 
                    us: JSON.parse(JSON.stringify(state.realPortfolio.us)) 
                } 
            }); 
            saveScenarios(); 
            switchScenario(newId); 
            showToast("已建立新劇本！"); 
        } 
    }); 
}

export function renameScenario(id) { 
    closeScenModal(); 
    let sc = state.sandboxScenarios.find(s => s.id === id); 
    openScenPrompt("重新命名劇本：", sc.name, (name) => { 
        if(name && name.trim()){ 
            sc.name = name.trim(); 
            saveScenarios(); 
            updateScenarioUI(); 
        } 
    }); 
}

export function deleteScenario(id) { 
    openConfirmModal("刪除劇本", "確定要刪除這個試算劇本嗎？", "確定刪除", () => { 
        state.sandboxScenarios = state.sandboxScenarios.filter(s => s.id !== id); 
        saveScenarios(); 
        if(state.activeScenarioId === id) switchScenario('real'); 
        else closeScenModal(); 
    }); 
}

export async function switchScenario(id) { 
    state.activeScenarioId = id; 
    updateScenarioUI(); 
    closeScenModal(); 
    setLoading(true); 
    await updateFinanceData(); 
    setLoading(false); 
    if(id !== 'real') showToast("進入試算模式"); 
}

export function saveScenarios() { 
    localStorage.setItem('invest_scenarios_v1', JSON.stringify(state.sandboxScenarios)); 
}

export function updateScenarioUI() {
    const bar = document.getElementById('scenario-bar'); 
    const rowUpload = document.getElementById('row-upload'); 
    const btnInv = document.getElementById('btn-inventory');
    if(state.activeScenarioId === 'real') { 
        if (bar) { bar.innerHTML = "📂 目前模式：真實持股 (鎖定) ▾"; bar.className = "scenario-bar"; }
        if (rowUpload) rowUpload.style.display = "flex"; 
        if (btnInv) btnInv.innerHTML = "⚙️ 庫存校正"; 
    } else { 
        let sc = state.sandboxScenarios.find(s => s.id === state.activeScenarioId); 
        if (bar) { bar.innerHTML = `🧪 試算中：${sc.name} ▾`; bar.className = "scenario-bar sandbox"; }
        if (rowUpload) rowUpload.style.display = "none"; 
        if (btnInv) btnInv.innerHTML = "✏️ 調整持股"; 
    }
}

// ==========================================
// 庫存管理與沙盒操作 (Inventory & Sandbox)
// ==========================================
export function openInventoryManager() {
    const container = document.getElementById('inventory-list-container'); 
    if (!container) return;
    
    container.innerHTML = '';
    let portfolio = state.activeScenarioId === 'real' ? state.realPortfolio : state.sandboxScenarios.find(s => s.id === state.activeScenarioId).portfolio;
    
    document.getElementById('btn-inv-add-stock').style.display = 'inline-block'; 
    document.getElementById('btn-ai-entry').style.display = state.activeScenarioId === 'real' ? 'none' : 'flex';
    document.getElementById('inv-modal-title').innerText = state.activeScenarioId === 'real' ? '⚙️ 庫存校正中心 (真實持股)' : '✏️ 試算持股調整'; 
    document.getElementById('inv-modal-desc').innerText = state.activeScenarioId === 'real' ? '手動調整真實持股的股數或成本，或補齊短少標的。' : '自由新增或刪除股票，或啟動 AI 智能配置。';

    const renderList = (market, list) => {
        if(!list || list.length === 0) return; 
        let html = `<div style="font-weight:bold; margin: 15px 0 8px; color: var(--primary-dark); font-size: 15px; border-bottom: 2px solid #eaeaea; padding-bottom: 4px;">${market === 'tw' ? '🇹🇼 台股' : '🇺🇸 美股'}</div>`;
        list.forEach((item, index) => {
            html += `<div class="inv-item"><div class="inv-item-header"><span>${item.name} <span style="color:#999; font-weight:normal; font-size:12px;">(${item.symbol})</span></span></div><button class="btn-del-stock" onclick="window.removeStock('${market}', ${index})">✕</button><div class="inv-input-group"><div class="inv-input-box"><span class="inv-input-label">總持有成本 (原幣)</span><input type="number" class="inv-input-field num" id="inv-cost-${market}-${index}" value="${item.cost}" step="any"></div><div class="inv-input-box"><span class="inv-input-label">目前股數</span><input type="number" class="inv-input-field num" id="inv-shares-${market}-${index}" value="${item.shares}" step="any"></div></div></div>`;
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

export function closeInventoryManager() { 
    document.getElementById('inventory-modal-overlay').classList.remove('active'); 
}

export async function saveInventoryChanges() {
    const updateList = (market, list) => { 
        if(!list) return; 
        list.forEach((item, index) => { 
            const sInp = document.getElementById(`inv-shares-${market}-${index}`); 
            const cInp = document.getElementById(`inv-cost-${market}-${index}`); 
            if(sInp && cInp) { 
                item.shares = parseFloat(sInp.value) || 0; 
                item.cost = parseFloat(cInp.value) || 0; 
            } 
        }); 
    };

    if(state.activeScenarioId === 'real') { 
        updateList('tw', state.realPortfolio.tw); 
        updateList('us', state.realPortfolio.us); 
        localStorage.setItem('portfolio_tw', JSON.stringify(state.realPortfolio.tw)); 
        localStorage.setItem('portfolio_us', JSON.stringify(state.realPortfolio.us)); 
    } else { 
        let sc = state.sandboxScenarios.find(s => s.id === state.activeScenarioId); 
        updateList('tw', sc.portfolio.tw); 
        updateList('us', sc.portfolio.us); 
        saveScenarios(); 
    }
    
    closeInventoryManager(); 
    setLoading(true); 
    try { 
        await updateFinanceData(); 
        showToast("✅ 組合已更新並重新計算"); 
    } catch (err) {
        console.error(err);
    } finally { 
        setLoading(false); 
    }
}

export async function removeStock(market, index) { 
    if(state.activeScenarioId === 'real') {
        state.realPortfolio[market].splice(index, 1);
        localStorage.setItem(`portfolio_${market}`, JSON.stringify(state.realPortfolio[market]));
        openInventoryManager();
        setLoading(true);
        await updateFinanceData();
        setLoading(false);
        showToast("✅ 已刪除真實持股標的");
    } else {
        let sc = state.sandboxScenarios.find(s => s.id === state.activeScenarioId); 
        if(sc) { 
            sc.portfolio[market].splice(index, 1); 
            saveScenarios(); 
            openInventoryManager(); 
        } 
    }
}

export function openSandboxAddStock() { 
    closeInventoryManager(); 
    const overlay = document.getElementById('sandbox-add-overlay'); 
    document.getElementById('sb-step-input').style.display = 'block'; 
    document.getElementById('sb-step-confirm').style.display = 'none'; 
    document.getElementById('sb-input-val').value = ''; 
    overlay.classList.add('active'); 
}

export function closeSandboxAddStock() { 
    document.getElementById('sandbox-add-overlay').classList.remove('active'); 
    openInventoryManager(); 
}

// ==========================================
// 最佳化 UI (AI Opt)
// ==========================================
export function selectAIOpt(el) { 
    document.querySelectorAll('.ai-opt-card').forEach(card => card.classList.remove('active')); 
    el.classList.add('active'); 
    document.getElementById('ai-opt-objective').value = el.getAttribute('data-val'); 
}

export function openAIOptimizer() { 
    closeInventoryManager(); 
    let sc = state.sandboxScenarios.find(s => s.id === state.activeScenarioId); 
    let totalStocks = sc.portfolio.tw.length + sc.portfolio.us.length; 
    if(totalStocks < 2) { 
        showInfoModal("⚠️ 資料不足", "至少需要 2 檔不同的股票才能啟動最佳化引擎！", true, () => { openInventoryManager(); }); 
        return; 
    } 
    document.getElementById('ai-opt-modal').classList.add('active'); 
}

export function closeAIOptimizer() { 
    document.getElementById('ai-opt-modal').classList.remove('active'); 
    openInventoryManager(); 
}

export function closeAIResult() { 
    document.getElementById('ai-res-modal').classList.remove('active'); 
    document.getElementById('ai-opt-modal').classList.add('active'); 
}

export function applyAIWeights() {
    if(!state.pendingAIWeights) return; 
    let sc = state.sandboxScenarios.find(s => s.id === state.activeScenarioId); 
    let totalVal = 0; 
    
    state.pendingAIWeights.stocks.forEach(s => { 
        let exRate = s.market === 'US' ? state.currentRate : 1; 
        totalVal += s.shares * state.stockMapCache[s.symbol].price * exRate; 
    });
    
    state.pendingAIWeights.stocks.forEach((s, idx) => { 
        let targetValTWD = totalVal * state.pendingAIWeights.weights[idx]; 
        let exRate = s.market === 'US' ? state.currentRate : 1; 
        let targetShares = targetValTWD / (state.stockMapCache[s.symbol].price * exRate); 
        let targetCost = targetValTWD / exRate; 
        
        let item = sc.portfolio.tw.find(x => x.symbol === s.symbol) || sc.portfolio.us.find(x => x.symbol === s.symbol); 
        if(item) { 
            item.shares = parseFloat(targetShares.toFixed(4)); 
            item.cost = parseFloat(targetCost.toFixed(2)); 
        } 
    });
    
    saveScenarios(); 
    document.getElementById('ai-res-modal').classList.remove('active'); 
    setLoading(true); 
    updateFinanceData().then(() => { 
        setLoading(false); 
        showToast("✅ 配置套用成功！"); 
    });
}

import { state } from './state.js';
import {
    openDrawer, closeDrawer, navigateTo, showToast,
    openConfirmModal, closeConfirmModal, openScenPrompt, closeScenPrompt,
    showInfoModal, closeInfoModal, setLoading, confirmCallback, promptCallback
} from './utils.js';
import { updateFinanceData, exportGlobalSyncData } from './api.js';
import {
    openScenModal, closeScenModal, createNewScenario, renameScenario,
    deleteScenario, switchScenario, openInventoryManager, closeInventoryManager,
    saveInventoryChanges, removeStock, openSandboxAddStock, closeSandboxAddStock,
    selectAIOpt, openAIOptimizer, closeAIOptimizer, closeAIResult, applyAIWeights,
    updateScenarioUI
} from './inventory.js';
import {
    handleFileUpload, acceptPrivacyConsent, cancelPrivacyConsent,
    confirmManualMapping, cancelManualMapping, closeReconciliationModal,
    goToInventoryFromReconciliation
} from './csvImporter.js';
import {
    startPbiScan, openPbiModal, closePbiModal, togglePbiAccordion
} from './pbiScanner.js';
import {
    renderDashboard, renderHistoryPnLChart, switchPerfMode, setHistoryZoom,
    renderScatterChart, renderMCCompareChart, switchMCDim,
    showDivDetail, closeDivDetail, openReport, closeReport
} from './chartEngine.js';

// ==========================================
// 1. 掛載全域函數 (Window Bindings)
// 確保 HTML 內的 onclick 屬性依然可以正確觸發
// ==========================================

// 工具與導航
window.openDrawer = openDrawer;
window.closeDrawer = closeDrawer;
window.navigateTo = navigateTo;
window.closeConfirmModal = closeConfirmModal;
window.closeScenPrompt = closeScenPrompt;
window.closeInfoModal = closeInfoModal;

// 庫存與試算劇本
window.openScenModal = openScenModal;
window.closeScenModal = closeScenModal;
window.createNewScenario = createNewScenario;
window.renameScenario = renameScenario;
window.deleteScenario = deleteScenario;
window.switchScenario = switchScenario;
window.openInventoryManager = openInventoryManager;
window.closeInventoryManager = closeInventoryManager;
window.saveInventoryChanges = saveInventoryChanges;
window.removeStock = removeStock;
window.openSandboxAddStock = openSandboxAddStock;
window.closeSandboxAddStock = closeSandboxAddStock;

// AI 權重最佳化
window.selectAIOpt = selectAIOpt;
window.openAIOptimizer = openAIOptimizer;
window.closeAIOptimizer = closeAIOptimizer;
window.closeAIResult = closeAIResult;
window.applyAIWeights = applyAIWeights;

// CSV 匯入管線
window.acceptPrivacyConsent = acceptPrivacyConsent;
window.cancelPrivacyConsent = cancelPrivacyConsent;
window.confirmManualMapping = confirmManualMapping;
window.cancelManualMapping = cancelManualMapping;
window.closeReconciliationModal = closeReconciliationModal;
window.goToInventoryFromReconciliation = goToInventoryFromReconciliation;

// PBI 雷達
window.openPbiModal = openPbiModal;
window.closePbiModal = closePbiModal;
window.togglePbiAccordion = togglePbiAccordion;

// 圖表與渲染引擎 (完整還原版)
window.renderDashboard = renderDashboard;
window.renderHistoryPnLChart = renderHistoryPnLChart;
window.switchPerfMode = switchPerfMode;
window.setHistoryZoom = setHistoryZoom;
window.renderScatterChart = renderScatterChart;
window.renderMCCompareChart = renderMCCompareChart;
window.switchMCDim = switchMCDim;
window.showDivDetail = showDivDetail;
window.closeDivDetail = closeDivDetail;
window.openReport = openReport;
window.closeReport = closeReport;

// 定義主畫面專屬邏輯並掛載
window.renderCurrentView = function() {
    if (state.globalCombinedList.length === 0) { 
        window.renderDashboard([]); 
        return; 
    }
    let filteredList = state.currentMarketView !== 'ALL' ? state.globalCombinedList.filter(item => item.market === state.currentMarketView) : state.globalCombinedList;
    window.renderDashboard(filteredList);
    window.renderHistoryPnLChart();
};

window.togglePrivacy = function() {
    state.isPrivacyMode = !state.isPrivacyMode;
    document.getElementById('btn-privacy').innerHTML = state.isPrivacyMode ? '🙈' : '👁️';
    window.renderCurrentView();
    showToast(state.isPrivacyMode ? "隱私模式已開啟" : "隱私模式已關閉");
};

window.askClearAllData = function() {
    openConfirmModal("警告", "確定要清空所有真實持股資料嗎？<br><br>這將移除儀表板上的所有紀錄。", "確定清空", () => {
        localStorage.removeItem('portfolio_tw');
        localStorage.removeItem('portfolio_us');
        state.realPortfolio = { tw: [], us: [] };
        state.globalCombinedList = [];
        document.getElementById('label-tw').innerText = '📁 匯入台股';
        document.getElementById('label-us').innerText = '📁 匯入美股';
        exportGlobalSyncData([]);
        window.renderCurrentView();
        showToast('已清空所有資料');
        closeConfirmModal();
    });
};

window.switchMarket = function(market) {
    state.currentMarketView = market;
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`tab-${market}`).classList.add('active');
    window.renderCurrentView();
    let name = market === 'ALL' ? '全球總覽' : (market === 'TW' ? '台股' : '美股');
    showToast(`已切換至 ${name}`);
};

// ==========================================
// 2. 系統初始化 (DOMContentLoaded)
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
    
    // 綁定檔案上傳事件
    document.getElementById('upload-tw').addEventListener('change', (e) => handleFileUpload(e, 'tw'));
    document.getElementById('upload-us').addEventListener('change', (e) => handleFileUpload(e, 'us'));

    // 綁定圖表 RWD 監聽
    window.addEventListener('resize', () => { 
        if (state.charts.alloc) state.charts.alloc.resize(); 
        if (state.charts.perf) state.charts.perf.resize();
        if (state.charts.cf) state.charts.cf.resize();
        if (state.charts.mc) state.charts.mc.resize();
        if (state.charts.historyPnL) state.charts.historyPnL.resize(); 
    });

    // 報告 Overlay Observer
    const reportOverlay = document.getElementById('report-overlay');
    const observer = new ResizeObserver(entries => {
        for (let entry of entries) {
            if (entry.contentRect.width > 0 && reportOverlay.style.display === 'block') {
                if (!state.isReportRendered) { 
                    window.renderScatterChart(); 
                    window.renderMCCompareChart(); 
                    state.isReportRendered = true; 
                } else { 
                    if(state.charts.scatter) state.charts.scatter.resize(); 
                    if(state.charts.mcCompare) state.charts.mcCompare.resize(); 
                }
            }
        }
    });
    if (reportOverlay) observer.observe(reportOverlay);

    // 載入本地庫存資料
    const savedTW = localStorage.getItem('portfolio_tw'); 
    const savedUS = localStorage.getItem('portfolio_us'); 
    const savedScen = localStorage.getItem('invest_scenarios_v1');
    if (savedTW) try { state.realPortfolio.tw = JSON.parse(savedTW); } catch(e) {}
    if (savedUS) try { state.realPortfolio.us = JSON.parse(savedUS); } catch(e) {}
    if (savedScen) try { state.sandboxScenarios = JSON.parse(savedScen); } catch(e) {}

    // 綁定通用確認與提示彈窗按鈕
    document.getElementById('btn-confirm-danger').onclick = () => { 
        closeConfirmModal(); 
        if(confirmCallback) confirmCallback(); 
    };
    document.getElementById('scen-prompt-confirm').onclick = () => { 
        closeScenPrompt(); 
        if(promptCallback) promptCallback(document.getElementById('scen-prompt-input').value); 
    };
    
    // 綁定手動新增標的沙盒邏輯
    document.getElementById('btn-sb-check').onclick = async () => {
        const val = document.getElementById('sb-input-val').value.trim().toUpperCase(); 
        if (!val) return;
        document.getElementById('sb-step-input').style.display = 'none'; 
        document.getElementById('sb-step-loading').style.display = 'block';
        try {
            const res = await fetch('/api/finance', { 
                method: 'POST', 
                headers: { 'Content-Type': 'application/json' }, 
                body: JSON.stringify({ symbols: [val] }) 
            }); 
            if(!res.ok) throw new Error('API Error'); 
            const json = await res.json();
            if (json.status === 'success' && json.data[val] && !json.data[val].error) { 
                const data = json.data[val]; 
                state.stockMapCache[val] = data; 
                state.currentPromptPrice = data.price; 
                document.getElementById('sb-yahoo-name').innerText = data.yahooName || val; 
                document.getElementById('sb-yahoo-price').innerText = data.price; 
                document.getElementById('sb-shares').value = ''; 
                document.getElementById('sb-cost').value = ''; 
                document.getElementById('sb-step-loading').style.display = 'none'; 
                document.getElementById('sb-step-confirm').style.display = 'block'; 
            } else { 
                showInfoModal('搜尋失敗', 'Yahoo Finance 查無此代號。', true); 
                document.getElementById('sb-step-loading').style.display = 'none'; 
                document.getElementById('sb-step-input').style.display = 'block'; 
            }
        } catch (e) { 
            showInfoModal('連線異常', '伺服器無回應。', true); 
            document.getElementById('sb-step-loading').style.display = 'none'; 
            document.getElementById('sb-step-input').style.display = 'block'; 
        }
    };
    
    document.getElementById('btn-sb-retry').onclick = openSandboxAddStock;
    
    document.getElementById('btn-sb-save').onclick = async () => {
        let shares = parseFloat(document.getElementById('sb-shares').value) || 0; 
        let finalCost = parseFloat(document.getElementById('sb-cost').value) || 0; 
        let symbol = document.getElementById('sb-input-val').value.trim().toUpperCase(); 
        let name = document.getElementById('sb-yahoo-name').innerText;
        if(shares <= 0 || finalCost < 0) { 
            showInfoModal('輸入錯誤', '請輸入大於 0 的股數。', true); 
            return; 
        }
        let market = symbol.includes('.TW') || symbol.includes('.TWO') ? 'tw' : 'us'; 
        
        if (state.activeScenarioId === 'real') {
            state.realPortfolio[market].push({ market: market.toUpperCase(), name: name, symbol: symbol, shares: shares, cost: finalCost });
            localStorage.setItem(`portfolio_${market}`, JSON.stringify(state.realPortfolio[market]));
            document.getElementById('sandbox-add-overlay').classList.remove('active'); 
            openInventoryManager();
            setLoading(true);
            await updateFinanceData();
            setLoading(false);
            showToast("✅ 已新增至真實持股");
        } else {
            let sc = state.sandboxScenarios.find(s => s.id === state.activeScenarioId); 
            sc.portfolio[market].push({ market: market.toUpperCase(), name: name, symbol: symbol, shares: shares, cost: finalCost });
            document.getElementById('sandbox-add-overlay').classList.remove('active'); 
            saveInventoryChanges(); 
        }
    };

    // 更新 UI 狀態
    updateScenarioUI();
    
    // 觸發報價更新與初始渲染
    if (state.realPortfolio.tw.length > 0 || state.realPortfolio.us.length > 0) { 
        setLoading(true); 
        try { 
            await updateFinanceData(); 
        } catch(e) { 
            console.error(e); 
            window.renderCurrentView(); 
        } finally { 
            setLoading(false); 
        } 
    } else { 
        window.renderCurrentView(); 
    }

    // 啟動 PBI 雷達掃描
    setTimeout(() => {
        startPbiScan();
    }, 1000);
});

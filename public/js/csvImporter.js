import { state } from './state.js';
import { showToast, setLoading, showInfoModal, parseNum } from './utils.js';
import { updateFinanceData } from './api.js';
import { openInventoryManager } from './inventory.js';
import { startPbiScan } from './pbiScanner.js';

// ==========================================
// CSV 匯入與字典解析 (AI 智慧解析引擎與防呆)
// ==========================================
export async function handleFileUpload(event, market) {
    const file = event.target.files[0]; 
    if (!file) return; 
    
    state.pendingImportFile = file;
    state.pendingImportMarket = market;
    
    const reader = new FileReader();
    reader.onload = function(e) {
        const text = e.target.result;
        const lines = text.split('\n');
        state.pendingCSVChunk = lines.slice(0, 20).join('\n');
        
        Papa.parse(state.pendingCSVChunk, {
            header: true,
            preview: 1,
            skipEmptyLines: true,
            complete: function(res) {
                state.pendingHeaders = res.meta.fields || [];
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

export function acceptPrivacyConsent() {
    localStorage.setItem('ai_privacy_consented', 'true');
    const el = document.getElementById('privacy-consent-overlay');
    el.classList.remove('active');
    setTimeout(() => { el.style.display = 'none'; }, 300);
    startAIParsing();
}

export function cancelPrivacyConsent() {
    const el = document.getElementById('privacy-consent-overlay');
    el.classList.remove('active');
    setTimeout(() => { el.style.display = 'none'; }, 300);
    state.pendingImportFile = null;
    showToast("已取消匯入");
}

async function startAIParsing() {
    setLoading(true, "AI 智慧解析表頭中...");
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);
    
    try {
        const res = await fetch('/api/parser', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ csvChunk: state.pendingCSVChunk }),
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        
        if (!res.ok) {
            throw new Error(res.status === 500 ? "API_ERROR" : "PARSE_FAILED");
        }
        
        const json = await res.json();
        
        if (json.status === 'success' && json.data && json.data.nameColumn && json.data.sharesColumn) {
            Papa.parse(state.pendingCSVChunk, {
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
    
    state.pendingHeaders.forEach(h => {
        nameSelect.innerHTML += `<option value="${h}" ${h === defaultNameCol ? 'selected' : ''}>${h}</option>`;
        sharesSelect.innerHTML += `<option value="${h}" ${h === defaultSharesCol ? 'selected' : ''}>${h}</option>`;
    });
    
    const el = document.getElementById('manual-mapping-overlay');
    el.style.display = 'flex';
    setTimeout(() => { el.classList.add('active'); }, 10);
}

export function confirmManualMapping() {
    const nCol = document.getElementById('map-name-select').value;
    const sCol = document.getElementById('map-shares-select').value;
    
    const el = document.getElementById('manual-mapping-overlay');
    el.classList.remove('active');
    setTimeout(() => { el.style.display = 'none'; }, 300);
    
    setLoading(true, "資料處理中...");
    executeCSVImport(nCol, sCol);
}

export function cancelManualMapping() {
    const el = document.getElementById('manual-mapping-overlay');
    el.classList.remove('active');
    setTimeout(() => { el.style.display = 'none'; }, 300);
    state.pendingImportFile = null;
    showToast("已取消匯入");
}

function executeCSVImport(nameCol, sharesCol) {
    Papa.parse(state.pendingImportFile, {
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
                
                state.pendingExpectedCount = validData.length;
                state.pendingSkippedCount = 0;
                
                let normalized = state.pendingImportMarket === 'tw' ? validData.map(row => ({ 
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
                
                state.realPortfolio[state.pendingImportMarket] = normalized; 
                localStorage.setItem(`portfolio_${state.pendingImportMarket}`, JSON.stringify(normalized)); 
                document.getElementById(`label-${state.pendingImportMarket}`).innerText = `✅ 匯入 (${normalized.length})`; 
                
                if (state.pendingImportMarket === 'tw') await processDictionary(normalized); 
                await updateFinanceData();
                
                const actualList = state.globalCombinedList.filter(item => item.market.toUpperCase() === state.pendingImportMarket.toUpperCase());
                const actualCount = actualList.length;
                const finalExpected = state.pendingExpectedCount - state.pendingSkippedCount;
                
                if (finalExpected === actualCount) {
                    let marketStr = state.pendingImportMarket === 'tw' ? '台股' : '美股';
                    let skipStr = state.pendingSkippedCount > 0 ? ` (${state.pendingSkippedCount} 筆已略過)` : '';
                    showToast(`✅ 成功匯入 ${actualCount} 筆${marketStr}${skipStr}，報價同步完成`);
                } else {
                    document.getElementById('reconciliation-desc').innerText = `本次匯入應有 ${finalExpected} 檔，但實際僅成功渲染 ${actualCount} 檔。可能有 ${finalExpected - actualCount} 檔標的 API 報價連線失敗或市值為 0。\n\n請前往『庫存校正中心』確認未顯示的標的。`;
                    const el = document.getElementById('reconciliation-modal-overlay');
                    el.style.display = 'flex';
                    setTimeout(() => { el.classList.add('active'); }, 10);
                }
                
                state.isPbiRunning = false;
                startPbiScan();

            } catch (err) { 
                showInfoModal('處理失敗', err.message, true); 
            } finally { 
                setLoading(false); 
                state.pendingImportFile = null;
            }
        }
    });
}

export function closeReconciliationModal() {
    const el = document.getElementById('reconciliation-modal-overlay');
    el.classList.remove('active');
    setTimeout(() => { el.style.display = 'none'; }, 300);
}

export function goToInventoryFromReconciliation() {
    closeReconciliationModal();
    openInventoryManager();
}

async function processDictionary(twList) {
    const names = twList.map(item => item.name); 
    const res = await fetch('/api/dictionary', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ names }) 
    }); 
    const dictMap = await res.json();
    
    for (let item of twList) { 
        if (dictMap[item.name]) { 
            item.symbol = dictMap[item.name]; 
        } else { 
            const input = await askForSymbol(item.name); 
            item.symbol = input; 
            if (input !== 'SKIP') {
                await fetch('/api/dictionary', { 
                    method: 'POST', 
                    headers: { 'Content-Type': 'application/json' }, 
                    body: JSON.stringify({ update: { name: item.name, symbol: input } }) 
                }); 
            } else {
                state.pendingSkippedCount++;
            }
        } 
    }
    localStorage.setItem('portfolio_tw', JSON.stringify(twList));
}

function askForSymbol(stockName) {
    return new Promise((resolve) => {
        setLoading(false); 
        const overlay = document.getElementById('csv-prompt-overlay'); 
        document.getElementById('csv-stock-name').innerText = stockName; 
        document.getElementById('csv-input-val').value = ''; 
        document.getElementById('csv-step-input').style.display = 'block'; 
        document.getElementById('csv-step-loading').style.display = 'none'; 
        document.getElementById('csv-step-confirm').style.display = 'none';
        overlay.classList.add('active'); 
        
        let currentTestSymbol = ''; 
        const cleanup = () => { 
            overlay.classList.remove('active'); 
            setLoading(true); 
        };
        
        document.getElementById('btn-csv-skip').onclick = () => { 
            cleanup(); 
            resolve('SKIP'); 
        };
        
        document.getElementById('btn-csv-check').onclick = async () => {
            const val = document.getElementById('csv-input-val').value.trim().toUpperCase(); 
            if (!val) return;
            currentTestSymbol = val; 
            document.getElementById('csv-step-input').style.display = 'none'; 
            document.getElementById('csv-step-loading').style.display = 'block';
            
            try {
                const res = await fetch('/api/finance', { 
                    method: 'POST', 
                    headers: { 'Content-Type': 'application/json' }, 
                    body: JSON.stringify({ symbols: [val] }) 
                }); 
                if (!res.ok) throw new Error('HTTP ' + res.status); 
                const json = await res.json();
                
                if (json.status === 'success' && json.data[val] && !json.data[val].error) { 
                    document.getElementById('csv-yahoo-name').innerText = json.data[val].yahooName || val; 
                    document.getElementById('csv-yahoo-price').innerText = json.data[val].price; 
                    document.getElementById('csv-step-loading').style.display = 'none'; 
                    document.getElementById('csv-step-confirm').style.display = 'block'; 
                } 
                else { 
                    showInfoModal('搜尋失敗', 'Yahoo Finance 查無此代號。', true); 
                    document.getElementById('csv-step-loading').style.display = 'none'; 
                    document.getElementById('csv-step-input').style.display = 'block'; 
                }
            } catch (e) { 
                showInfoModal('連線異常', '伺服器無回應。', true); 
                document.getElementById('csv-step-loading').style.display = 'none'; 
                document.getElementById('csv-step-input').style.display = 'block'; 
            }
        };
        
        document.getElementById('btn-csv-retry').onclick = () => { 
            document.getElementById('csv-step-confirm').style.display = 'none'; 
            document.getElementById('csv-step-input').style.display = 'block'; 
        }; 
        
        document.getElementById('btn-csv-save').onclick = () => { 
            cleanup(); 
            resolve(currentTestSymbol); 
        };
    });
}

import { state } from './state.js';
import { showToast, setLoading, showInfoModal, parseNum } from './utils.js';
import { updateFinanceData, searchSymbol } from './api.js';
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

// ⭐️ 【核心重構：CSV 智能搜尋與防呆配對狀態機】
function askForSymbol(stockName) {
    return new Promise((resolve) => {
        setLoading(false); 
        const overlay = document.getElementById('csv-prompt-overlay'); 
        document.getElementById('csv-stock-name').innerText = stockName; 
        document.getElementById('csv-input-val').value = ''; 
        
        // 初始狀態：顯示輸入框
        document.getElementById('csv-step-input').style.display = 'block'; 
        document.getElementById('csv-step-loading').style.display = 'none'; 
        document.getElementById('csv-step-select').style.display = 'none';
        document.getElementById('csv-step-confirm').style.display = 'none';
        overlay.classList.add('active'); 
        
        const cleanup = () => { 
            overlay.classList.remove('active'); 
            setLoading(true); 
        };
        
        // 動作：略過本筆
        document.getElementById('btn-csv-skip').onclick = () => { 
            cleanup(); 
            resolve('SKIP'); 
        };
        
        // 動作：執行模糊搜尋
        document.getElementById('btn-csv-check').onclick = async () => {
            const val = document.getElementById('csv-input-val').value.trim(); 
            if (!val) return;
            
            document.getElementById('csv-step-input').style.display = 'none'; 
            document.getElementById('csv-step-loading').style.display = 'block';
            
            try {
                const res = await searchSymbol(val);
                if (res.status === 'success' && res.data && res.data.length > 0) {
                    // 渲染選擇清單
                    const listEl = document.getElementById('csv-search-results');
                    listEl.innerHTML = '';
                    res.data.forEach(item => {
                        const marketFlag = item.market === 'TW' ? '🇹🇼' : (item.market === 'US' ? '🇺🇸' : '🌍');
                        const row = document.createElement('div');
                        row.style.cssText = 'padding: 12px; border-bottom: 1px solid #eee; cursor: pointer; display: flex; justify-content: space-between; align-items: center; transition: background 0.2s;';
                        row.onmouseover = () => row.style.background = '#e8f4fd';
                        row.onmouseout = () => row.style.background = 'transparent';
                        row.innerHTML = `
                            <div style="text-align: left;">
                                <div style="font-weight: bold; font-size: 14px; color: var(--primary-dark);">${item.name}</div>
                                <div style="font-size: 11px; color: #7f8c8d; margin-top: 2px;">${item.symbol} | ${item.exchange}</div>
                            </div>
                            <div style="font-size: 18px;">${marketFlag}</div>
                        `;
                        // 點選列表選項
                        row.onclick = () => selectCSVStock(item.symbol, item.name);
                        listEl.appendChild(row);
                    });
                    document.getElementById('csv-step-loading').style.display = 'none';
                    document.getElementById('csv-step-select').style.display = 'block';
                } else {
                    showInfoModal('搜尋失敗', '查無相關標的，請嘗試其他關鍵字。', true);
                    document.getElementById('csv-step-loading').style.display = 'none';
                    document.getElementById('csv-step-input').style.display = 'block';
                }
            } catch (e) {
                showInfoModal('連線異常', '搜尋伺服器無回應。', true);
                document.getElementById('csv-step-loading').style.display = 'none';
                document.getElementById('csv-step-input').style.display = 'block';
            }
        };

        // 動作：清單中選擇標的並精確驗證報價
        const selectCSVStock = async (symbol, name) => {
            document.getElementById('csv-step-select').style.display = 'none';
            document.getElementById('csv-step-loading').style.display = 'block';

            try {
                const res = await fetch('/api/finance', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ symbols: [symbol] })
                });
                if (!res.ok) throw new Error('API Error');
                const json = await res.json();

                if (json.status === 'success' && json.data[symbol] && !json.data[symbol].error) {
                    document.getElementById('csv-yahoo-name').innerText = name || json.data[symbol].yahooName || symbol;
                    document.getElementById('csv-yahoo-price').innerText = json.data[symbol].price;
                    document.getElementById('csv-yahoo-symbol').innerText = symbol; // 暫存精確代號
                    
                    document.getElementById('csv-step-loading').style.display = 'none';
                    document.getElementById('csv-step-confirm').style.display = 'block';
                } else {
                    showInfoModal('報價取得失敗', '無法取得該標的最新報價。', true);
                    document.getElementById('csv-step-loading').style.display = 'none';
                    document.getElementById('csv-step-select').style.display = 'block';
                }
            } catch (e) {
                showInfoModal('連線異常', '取得報價時發生錯誤。', true);
                document.getElementById('csv-step-loading').style.display = 'none';
                document.getElementById('csv-step-select').style.display = 'block';
            }
        };
        
        // 動作：返回重新搜尋
        document.getElementById('btn-csv-back-to-input').onclick = () => { 
            document.getElementById('csv-step-select').style.display = 'none'; 
            document.getElementById('csv-step-input').style.display = 'block'; 
            document.getElementById('csv-input-val').focus();
        }; 

        // 動作：取消登記並退回輸入
        document.getElementById('btn-csv-retry').onclick = () => { 
            document.getElementById('csv-step-confirm').style.display = 'none'; 
            document.getElementById('csv-step-input').style.display = 'block'; 
        }; 
        
        // 動作：確認儲存並完成配對
        document.getElementById('btn-csv-save').onclick = () => { 
            const finalSymbol = document.getElementById('csv-yahoo-symbol').innerText.trim().toUpperCase();
            cleanup(); 
            resolve(finalSymbol); 
        };
    });
}

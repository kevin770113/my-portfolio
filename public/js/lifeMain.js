// ==========================================
// 財務自由模擬 - 系統大腦 (UI & State Management)
// 負責資料同步、劇本切換、表單渲染與彈窗控制
// ==========================================

const LOCAL_STORAGE_KEY_V2 = 'life_financial_data_v2'; 

// 全域狀態宣告
let appData = { currentId: 'default', scenarios: [] };
let state = { assets: [], debts: [], preIncomes: [], preExpenses: [], postIncomes: [], postExpenses: [] };
let currentEqHTML = ""; 

// 工具函數
const deepCopy = (obj) => JSON.parse(JSON.stringify(obj));
const generateId = () => Math.random().toString(36).substr(2, 9);
const getNum = (id) => parseFloat(document.getElementById(id).value) || 0;
const fmt = (n) => Math.round(n).toLocaleString();

let toastTimeout;
function showToast(msg) {
    const toast = document.getElementById('toast-container');
    toast.innerText = msg; toast.classList.add('show');
    clearTimeout(toastTimeout); 
    toastTimeout = setTimeout(() => toast.classList.remove('show'), 2500);
}

// 導覽列與抽屜選單
function openDrawer() { document.getElementById('drawer-overlay').classList.add('show'); }
function closeDrawer() { document.getElementById('drawer-overlay').classList.remove('show'); }

function navigateTo(url) {
    if (window.location.href.includes(url) || (url === 'life.html' && window.location.pathname.endsWith('life.html'))) {
        closeDrawer();
        return;
    }
    closeDrawer();
    setTimeout(() => {
        document.body.classList.add('fade-out');
        setTimeout(() => { window.location.href = url; }, 400); 
    }, 250); 
}

// ==========================================
// 系統初始化與資料同步
// ==========================================
function loadDataAndInitialize() {
    const v2Json = localStorage.getItem(LOCAL_STORAGE_KEY_V2);
    if(v2Json) {
        try {
            appData = JSON.parse(v2Json);
            if(!appData.scenarios || appData.scenarios.length === 0) throw new Error("無效的 V2 格式");
            
            appData.scenarios.forEach(sc => {
                if (!sc.data.coreInvest) {
                    sc.data.coreInvest = { principal: "", annualAdd: "", preGrowth: "6.0", preYield: "2.0", stopAtRetire: true, postGrowth: "2.0", postYield: "5.0" };
                }
                if (!sc.data.syncedFields) sc.data.syncedFields = {};
            });
        } catch(e) { console.error(e); initDefaultApp(); }
    } else {
        initDefaultApp(); 
    }
    if(!appData.scenarios.find(s => s.id === appData.currentId)) {
        appData.currentId = appData.scenarios[0].id;
    }
    applyScenarioToDOM(appData.currentId);
}

function initDefaultApp() {
    appData = {
        currentId: 'default',
        scenarios: [{
            id: 'default',
            name: '現狀維持 (預設)',
            data: {
                env: { inflation: "2.5", curAge: "30", retAge: "60", medical: "" },
                invest: { active: false },
                coreInvest: { principal: "500000", annualAdd: "120000", preGrowth: "6.0", preYield: "2.0", stopAtRetire: true, postGrowth: "2.0", postYield: "5.0" },
                loan: { value: "", principal: "", rate: "", years: "", growth: "3.0" },
                salary: { val: "", growth: "3.0" },
                state: {
                    assets: [{ id: 'cash_default', name: '現金/活存', val: '', rate: '0.5', locked: true, isSynced: false }],
                    debts: [], preIncomes: [], preExpenses: [], postIncomes: [], postExpenses: []
                },
                syncedFields: {}
            },
            results: {}
        }]
    };
}

function applyScenarioToDOM(id) {
    appData.currentId = id;
    const sc = appData.scenarios.find(s => s.id === id);
    document.getElementById('scenario-bar').innerText = `📂 目前劇本：${sc.name} ▾`;
    
    const d = sc.data;
    document.getElementById('env-inflation').value = d.env.inflation;
    document.getElementById('env-curAge').value = d.env.curAge;
    document.getElementById('env-retAge').value = d.env.retAge;
    document.getElementById('env-medical').value = d.env.medical;

    document.getElementById('invest-switch').checked = d.invest.active;
    if (d.invest.active) { 
        document.getElementById('invest-hint-on').style.display = 'block'; 
        document.getElementById('invest-hint-off').style.display = 'none'; 
    } else {
        document.getElementById('invest-hint-on').style.display = 'none'; 
        document.getElementById('invest-hint-off').style.display = 'block'; 
    }

    const ci = d.coreInvest || { principal: "", annualAdd: "", preGrowth: "6.0", preYield: "2.0", stopAtRetire: true, postGrowth: "2.0", postYield: "5.0" };
    document.getElementById('core-principal').value = ci.principal;
    document.getElementById('core-annual-add').value = ci.annualAdd;
    document.getElementById('core-pre-growth').value = ci.preGrowth;
    document.getElementById('core-pre-yield').value = ci.preYield;
    document.getElementById('core-stop-retire').checked = ci.stopAtRetire;
    document.getElementById('core-post-growth').value = ci.postGrowth;
    document.getElementById('core-post-yield').value = ci.postYield;

    document.getElementById('loan-value').value = d.loan.value;
    document.getElementById('loan-principal').value = d.loan.principal;
    document.getElementById('loan-rate').value = d.loan.rate;
    document.getElementById('loan-years').value = d.loan.years;
    document.getElementById('loan-growth').value = d.loan.growth;

    document.getElementById('sys-salary-val').value = d.salary.val;
    document.getElementById('sys-salary-growth').value = d.salary.growth;

    state.assets = deepCopy(d.state.assets || []);
    state.debts = deepCopy(d.state.debts || []);
    state.preIncomes = deepCopy(d.state.preIncomes || []);
    state.preExpenses = deepCopy(d.state.preExpenses || []);
    state.postIncomes = deepCopy(d.state.postIncomes || []);
    state.postExpenses = deepCopy(d.state.postExpenses || []);

    const syncableStaticFields = ['core-principal', 'core-pre-growth', 'core-pre-yield', 'core-annual-add', 'sys-salary-val', 'sys-salary-growth'];
    syncableStaticFields.forEach(fieldId => {
        const el = document.getElementById(fieldId);
        if(d.syncedFields && d.syncedFields[fieldId]) {
            el.classList.add('synced-field');
        } else {
            el.classList.remove('synced-field');
        }
    });

    reRenderAll();
    if(typeof calculate === 'function') calculate(); 
}

function saveCurrentScenario(resultsObj) {
    const sc = appData.scenarios.find(s => s.id === appData.currentId);
    if(!sc) return;
    
    sc.data = {
        env: { inflation: document.getElementById('env-inflation').value, curAge: document.getElementById('env-curAge').value, retAge: document.getElementById('env-retAge').value, medical: document.getElementById('env-medical').value },
        invest: { active: document.getElementById('invest-switch').checked },
        coreInvest: {
            principal: document.getElementById('core-principal').value,
            annualAdd: document.getElementById('core-annual-add').value,
            preGrowth: document.getElementById('core-pre-growth').value,
            preYield: document.getElementById('core-pre-yield').value,
            stopAtRetire: document.getElementById('core-stop-retire').checked,
            postGrowth: document.getElementById('core-post-growth').value,
            postYield: document.getElementById('core-post-yield').value
        },
        loan: { value: document.getElementById('loan-value').value, principal: document.getElementById('loan-principal').value, rate: document.getElementById('loan-rate').value, years: document.getElementById('loan-years').value, growth: document.getElementById('loan-growth').value },
        salary: { val: document.getElementById('sys-salary-val').value, growth: document.getElementById('sys-salary-growth').value },
        state: deepCopy(state),
        syncedFields: sc.data.syncedFields || {} 
    };
    
    if(resultsObj) sc.results = resultsObj;
    localStorage.setItem(LOCAL_STORAGE_KEY_V2, JSON.stringify(appData));
}

function syncFromOtherPages() {
    let invData = JSON.parse(localStorage.getItem('sync_invest_data') || 'null');
    let accData = JSON.parse(localStorage.getItem('sync_account_data') || 'null');
    
    if(!invData && !accData) {
        alert('目前沒有找到投資或記帳的歷史打包紀錄。請先前往前兩頁瀏覽以建立快照！');
        return;
    }

    let sc = appData.scenarios.find(s => s.id === appData.currentId);
    if(!sc.data.syncedFields) sc.data.syncedFields = {};

    if(invData && invData.totalValue > 0) {
        document.getElementById('core-principal').value = Math.round(invData.totalValue);
        document.getElementById('core-pre-growth').value = (invData.cagr * 100).toFixed(1);
        document.getElementById('core-pre-yield').value = (invData.dividendYield * 100).toFixed(1);
        
        ['core-principal', 'core-pre-growth', 'core-pre-yield'].forEach(id => {
            document.getElementById(id).classList.add('synced-field');
            sc.data.syncedFields[id] = true;
        });
    }

    if(accData) {
        let cashAsset = state.assets.find(a => a.name === '現金/活存' || a.id === 'cash_default');
        if(!cashAsset) {
            cashAsset = { id: 'cash_default', name: '現金/活存', val: accData.latestBalance, rate: '0.5', locked: true, isSynced: true };
            state.assets.unshift(cashAsset);
        } else {
            cashAsset.val = accData.latestBalance;
            cashAsset.isSynced = true;
        }

        if(accData.avgSalary > 0) {
            document.getElementById('sys-salary-val').value = Math.round(accData.avgSalary);
            document.getElementById('sys-salary-val').classList.add('synced-field');
            sc.data.syncedFields['sys-salary-val'] = true;
        }

        if(accData.salaryGrowth !== undefined) {
            document.getElementById('sys-salary-growth').value = accData.salaryGrowth;
            document.getElementById('sys-salary-growth').classList.add('synced-field');
            sc.data.syncedFields['sys-salary-growth'] = true;
        }

        if(accData.avgExpense > 0) {
            let mainExp = state.preExpenses.find(e => e.isSynced || e.name.includes('生活費'));
            if(!mainExp) {
                state.preExpenses.push({ id: generateId(), name: '近1年平均生活費', val: accData.avgExpense, isSynced: true });
            } else {
                mainExp.val = accData.avgExpense;
                mainExp.name = '近1年平均生活費';
                mainExp.isSynced = true;
            }
        }

        if(accData.avgInvest > 0) {
            document.getElementById('core-annual-add').value = Math.round(accData.avgInvest * 12);
            document.getElementById('core-annual-add').classList.add('synced-field');
            sc.data.syncedFields['core-annual-add'] = true;
        }
    }

    reRenderAll();
    if(typeof calculate === 'function') calculate();
    showToast('✅ 已成功載入最新真實數據');
}

// ==========================================
// 彈窗與劇本管理邏輯
// ==========================================
let customPromptCallback = null;

function openCustomPrompt(title, defaultText, callback) {
    document.getElementById('cp-title').innerText = title;
    const inputEl = document.getElementById('cp-input');
    inputEl.value = defaultText;
    customPromptCallback = callback;
    document.getElementById('cp-modal').style.display = 'flex';
    setTimeout(() => inputEl.focus(), 100);
}

function closeCustomPrompt() { 
    document.getElementById('cp-modal').style.display = 'none'; 
    customPromptCallback = null; 
}

const metricDictionary = {
    'i1': { title: '🛡️ 緊急預備金安全度', desc: '衡量您的流動資金可以支撐幾個月的無收入生活。若突發失業或意外，這是您的第一道防線。', formula: '當年流動資金 ÷ 當年平均月支出', g: '大於 6 個月 (資金充裕)', y: '3 ~ 6 個月 (安全邊緣)', r: '小於 3 個月 (極度危險)' },
    'i2': { title: '💰 儲蓄與提領率', desc: '評估現金流健康度。退休前看「儲蓄率」，退休後看「本金提領率」。', formula: '退休前：(總收入 - 總支出) ÷ 總收入\n退休後：當年提領本金 ÷ 當年總資產', g: '退休前 > 20% ｜ 退休後 < 4%', y: '退休前 0~20% ｜ 退休後 4~8%', r: '退休前 透支 ｜ 退休後 > 8%' },
    'i3': { title: '⚖️ 負債壓力指數', desc: '每個月賺的錢，有多少比例一拿到就要還給銀行？用來衡量還款的窒息感。', formula: '當年總還款 (本+息) ÷ 當年總收入', g: '小於 20% (輕鬆無壓)', y: '20% ~ 40% (可控負債)', r: '大於 40% (高風險易斷頭)' },
    'i4': { title: '🏖️ 財務自由達成率', desc: '距離「不工作也能活下去」還有多遠？比起資產絕對值，覆蓋率更能反映真實自由度。', formula: '當年總被動配息 ÷ 當年總支出', g: '大於 100% (完全財務自由)', y: '30% ~ 100% (資產正在發揮作用)', r: '小於 30% (高度依賴勞力)' },
    'i5': { title: '💧 資產流動性風險', desc: '揪出「窮得只剩下房」的族群。如果身價千萬但全在不動產，生病時根本拿不出錢。', formula: '當年流動與投資資金 ÷ 當年總淨資產', g: '大於 30% (變現能力極佳)', y: '10% ~ 30% (一般水準)', r: '小於 10% (變現能力極差)' }
};

function showMetricModal(metricKey) {
    const data = metricDictionary[metricKey];
    if(!data) return;
    document.getElementById('metric-title').innerText = data.title;
    document.getElementById('metric-desc').innerText = data.desc;
    document.getElementById('metric-formula').innerText = data.formula;
    document.getElementById('m-g').innerText = data.g;
    document.getElementById('m-y').innerText = data.y;
    document.getElementById('m-r').innerText = data.r;
    document.getElementById('metric-modal').style.display = 'flex';
}

function closeMetricModal() { document.getElementById('metric-modal').style.display = 'none'; }

function closeScenarioModal() {
    document.getElementById('scen-sheet').classList.remove('show');
    setTimeout(() => document.getElementById('scen-overlay').style.display = 'none', 300);
}

function renderScenarioModal() {
    const list = document.getElementById('scen-list');
    list.innerHTML = '';
    appData.scenarios.forEach(sc => {
        const isAct = sc.id === appData.currentId;
        list.innerHTML += `
            <div class="scen-item">
                <div class="scen-name" onclick="${isAct ? '' : `applyScenarioToDOM('${sc.id}'); closeScenarioModal();`}" style="cursor:pointer;">
                    ${sc.name} ${isAct ? '<span style="color:var(--color-positive); font-size:12px; margin-left:5px;">✅ 使用中</span>' : ''}
                </div>
                <div class="scen-actions">
                    <button class="scen-btn" onclick="renameScenario('${sc.id}')">✏️</button>
                    <button class="scen-btn" onclick="deleteScenario('${sc.id}')">🗑️</button>
                </div>
            </div>
        `;
    });
}

function createNewScenario() {
    closeScenarioModal(); 
    const currentScen = appData.scenarios.find(s => s.id === appData.currentId);
    openCustomPrompt("請為新劇本命名", currentScen.name + " - 複製", (newName) => {
        if(!newName || newName.trim() === "") return;
        const newId = generateId();
        const newScen = { id: newId, name: newName.trim(), data: deepCopy(currentScen.data), results: deepCopy(currentScen.results || {}) };
        appData.scenarios.push(newScen);
        applyScenarioToDOM(newId);
    });
}

function renameScenario(id) {
    closeScenarioModal();
    const sc = appData.scenarios.find(s => s.id === id);
    openCustomPrompt("重新命名劇本", sc.name, (newName) => {
        if(newName && newName.trim() !== "") {
            sc.name = newName.trim();
            saveCurrentScenario(); 
            if(typeof renderComparisonTable === 'function') renderComparisonTable();
            if(id === appData.currentId) { document.getElementById('scenario-bar').innerText = `📂 目前劇本：${sc.name} ▾`; }
        }
    });
}

function deleteScenario(id) {
    if(appData.scenarios.length <= 1) { alert("最後一個防線！至少需要保留一個劇本。"); return; }
    if(confirm("確定要刪除這個劇本嗎？(此動作無法復原)")) {
        appData.scenarios = appData.scenarios.filter(s => s.id !== id);
        if(appData.currentId === id) { applyScenarioToDOM(appData.scenarios[0].id); } 
        else { 
            saveCurrentScenario(); 
            renderScenarioModal(); 
            if(typeof renderComparisonTable === 'function') renderComparisonTable(); 
        }
    }
}

function showHmTooltip(el) {
    const tooltipContent = document.getElementById('tooltip-content');
    const tooltipOverlay = document.getElementById('tooltip-overlay');
    tooltipContent.innerText = el.getAttribute('data-tip');
    tooltipOverlay.style.display = 'flex';
}

// ==========================================
// 表單列表渲染與事件綁定
// ==========================================
function renderList(containerId, dataArray, stateKey, hasRate) {
    const container = document.getElementById(containerId);
    container.innerHTML = ''; 
    dataArray.forEach((item, index) => {
        const row = document.createElement('div');
        row.className = 'list-row';

        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.placeholder = '項目名稱';
        nameInput.style.flex = hasRate ? '1.8' : '2.5';
        nameInput.value = item.name;
        if (item.locked) { nameInput.readOnly = true; nameInput.style.backgroundColor = '#eee'; nameInput.style.color = '#888'; }
        if (item.isSynced) nameInput.classList.add('synced-field');
        nameInput.addEventListener('input', (e) => updateState(stateKey, index, 'name', e.target.value));
        row.appendChild(nameInput);

        const valInput = document.createElement('input');
        valInput.type = 'number';
        valInput.placeholder = '金額';
        valInput.style.flex = '1';
        valInput.value = item.val;
        if (item.isSynced) valInput.classList.add('synced-field');
        valInput.addEventListener('input', (e) => updateState(stateKey, index, 'val', e.target.value));
        row.appendChild(valInput);

        if (hasRate) {
            const rateInput = document.createElement('input');
            rateInput.type = 'number';
            rateInput.placeholder = '%';
            rateInput.style.flex = '0.8';
            rateInput.value = item.rate;
            if (item.isSynced) rateInput.classList.add('synced-field');
            rateInput.addEventListener('input', (e) => updateState(stateKey, index, 'rate', e.target.value));
            row.appendChild(rateInput);
        }

        const removeBtn = document.createElement('button');
        removeBtn.className = 'btn-remove';
        if (item.locked) { removeBtn.innerText = '🔒'; removeBtn.disabled = true; removeBtn.style.opacity = '0.3'; } 
        else { removeBtn.innerText = '×'; removeBtn.onclick = () => removeItem(stateKey, index); }
        row.appendChild(removeBtn);
        container.appendChild(row);
    });
}

function updateState(stateKey, index, field, value) { 
    state[stateKey][index][field] = value; 
    if(state[stateKey][index].isSynced) {
        state[stateKey][index].isSynced = false;
        reRenderAll();
    }
    if(typeof calculate === 'function') calculate(); 
}

function addItem(stateKey) { state[stateKey].push({ id: generateId(), name: '', val: '', rate: '', isSynced: false }); reRenderAll(); if(typeof calculate === 'function') calculate(); }
function removeItem(stateKey, index) { state[stateKey].splice(index, 1); reRenderAll(); if(typeof calculate === 'function') calculate(); }

function reRenderAll() {
    renderList('asset-list', state.assets, 'assets', true);
    renderList('debt-list', state.debts, 'debts', true);
    renderList('pre-income-list', state.preIncomes, 'preIncomes', false);
    renderList('pre-expense-list', state.preExpenses, 'preExpenses', false);
    renderList('post-income-list', state.postIncomes, 'postIncomes', false);
    renderList('post-expense-list', state.postExpenses, 'postExpenses', false);
}

// ==========================================
// 綁定 DOM 事件 (DOMContentLoaded)
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    
    // 綁定彈窗確認按鈕
    document.getElementById('cp-btn-confirm').addEventListener('click', () => {
        const val = document.getElementById('cp-input').value;
        if(customPromptCallback) customPromptCallback(val);
        closeCustomPrompt();
    });
    document.getElementById('cp-modal').addEventListener('click', closeCustomPrompt);
    document.querySelectorAll('.cp-box').forEach(el => el.addEventListener('click', e => e.stopPropagation()));
    document.getElementById('metric-modal').addEventListener('click', closeMetricModal);

    // 綁定劇本選單
    const scenOverlay = document.getElementById('scen-overlay');
    const scenSheet = document.getElementById('scen-sheet');
    document.getElementById('scenario-bar').addEventListener('click', () => {
        renderScenarioModal();
        scenOverlay.style.display = 'flex';
        setTimeout(() => scenSheet.classList.add('show'), 10);
    });
    scenOverlay.addEventListener('click', closeScenarioModal);

    // 綁定底部導覽 Tabs
    const navBtns = document.querySelectorAll('.nav-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            navBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(btn.getAttribute('data-target')).classList.add('active');
            window.scrollTo(0, 0);
        });
    });

    // 綁定結餘分配 Switch
    document.getElementById('invest-switch').addEventListener('change', (e) => {
        if (e.target.checked) { 
            document.getElementById('invest-hint-on').style.display = 'block'; 
            document.getElementById('invest-hint-off').style.display = 'none'; 
        } else {
            document.getElementById('invest-hint-on').style.display = 'none'; 
            document.getElementById('invest-hint-off').style.display = 'block'; 
        }
        if(typeof calculate === 'function') calculate();
    });

    // 靜態欄位一碰就解除高亮
    const syncableStaticFields = ['core-principal', 'core-pre-growth', 'core-pre-yield', 'core-annual-add', 'sys-salary-val', 'sys-salary-growth'];
    syncableStaticFields.forEach(id => {
        document.getElementById(id).addEventListener('input', function() {
            this.classList.remove('synced-field');
            let sc = appData.scenarios.find(s => s.id === appData.currentId);
            if(sc && sc.data.syncedFields) sc.data.syncedFields[id] = false;
        });
    });

    // 綁定 Tooltips
    const tooltipIcons = document.querySelectorAll('.tooltip-icon');
    const tooltipOverlay = document.getElementById('tooltip-overlay');
    const tooltipContent = document.getElementById('tooltip-content');
    tooltipIcons.forEach(icon => {
        icon.addEventListener('click', (e) => {
            tooltipContent.innerText = e.target.getAttribute('data-tip');
            tooltipOverlay.style.display = 'flex';
        });
    });
    tooltipOverlay.addEventListener('click', () => tooltipOverlay.style.display = 'none');
    tooltipContent.addEventListener('click', (e) => e.stopPropagation());

    // 綁定現金流等式彈窗
    const eqOverlay = document.getElementById('eq-overlay');
    document.getElementById('btn-cashflow-eq').addEventListener('click', () => {
        document.getElementById('eq-details').innerHTML = currentEqHTML;
        eqOverlay.style.display = 'flex';
    });
    eqOverlay.addEventListener('click', () => eqOverlay.style.display = 'none');
    document.getElementById('eq-content').addEventListener('click', (e) => e.stopPropagation());

    // 綁定新增清單按鈕
    document.getElementById('btn-add-asset').onclick = () => addItem('assets');
    document.getElementById('btn-add-debt').onclick = () => addItem('debts');
    document.getElementById('btn-add-pre-inc').onclick = () => addItem('preIncomes');
    document.getElementById('btn-add-pre-exp').onclick = () => addItem('preExpenses');
    document.getElementById('btn-add-post-inc').onclick = () => addItem('postIncomes');
    document.getElementById('btn-add-post-exp').onclick = () => addItem('postExpenses');

    // 綁定所有數值異動時的重新計算
    const staticInputs = [
        'env-inflation', 'env-curAge', 'env-retAge', 'env-medical', 
        'core-principal', 'core-annual-add', 'core-pre-growth', 'core-pre-yield', 'core-stop-retire', 'core-post-growth', 'core-post-yield',
        'loan-value', 'loan-principal', 'loan-rate', 'loan-years', 'loan-growth',
        'sys-salary-val', 'sys-salary-growth'
    ];
    staticInputs.forEach(id => { document.getElementById(id).addEventListener('input', () => { if(typeof calculate === 'function') calculate(); }); });
    document.getElementById('core-stop-retire').addEventListener('change', () => { if(typeof calculate === 'function') calculate(); });

    // 啟動系統
    loadDataAndInitialize();
});

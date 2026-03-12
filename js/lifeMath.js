// ==========================================
// 財務自由模擬 - 核心運算左腦 (Math Core)
// 負責 30 年以上的現金流、通膨、投資複利迴圈推算
// ==========================================

function calculate() {
    // 1. 取得環境與投資參數
    const inflation = getNum('env-inflation') / 100;
    const curAge = parseInt(document.getElementById('env-curAge').value) || 30;
    const retAge = parseInt(document.getElementById('env-retAge').value) || 60;
    const medical = Math.abs(getNum('env-medical')); // 防呆
    const surplusToInvest = document.getElementById('invest-switch').checked;

    let corePrincipal = getNum('core-principal');
    const coreAnnualAdd = getNum('core-annual-add');
    const corePreGrowth = getNum('core-pre-growth') / 100;
    const corePreYield = getNum('core-pre-yield') / 100;
    const stopAtRetire = document.getElementById('core-stop-retire').checked;
    const corePostGrowth = getNum('core-post-growth') / 100;
    const corePostYield = getNum('core-post-yield') / 100;

    const baseMonthlyAdd = coreAnnualAdd / 12;
    
    document.getElementById('sys-core-inv-pre').value = Math.round(baseMonthlyAdd);
    document.getElementById('sys-core-inv-post').value = stopAtRetire ? 0 : Math.round(baseMonthlyAdd);

    // 2. 取得與整理資產負債表 (強制絕對值，防止負數記帳匯入導致倒扣)
    let currentAssets = state.assets.map(a => ({ 
        val: Math.abs(parseFloat(a.val) || 0), 
        rate: (parseFloat(a.rate) || 0) / 100 
    }));
    let defaultCashRate = currentAssets.length > 0 ? currentAssets[0].rate : 0.005;
    
    let debtTotal = 0, debtWeightedRate = 0;
    state.debts.forEach(d => {
        const v = Math.abs(parseFloat(d.val) || 0); 
        const r = (parseFloat(d.rate) || 0) / 100;
        debtTotal += v;
        debtWeightedRate += v * r;
    });
    const debtAvgRate = debtTotal > 0 ? (debtWeightedRate / debtTotal) : 0.03;
    const monthlyInterest = debtTotal * (debtAvgRate / 12);

    // 3. 取得收支表 (全數加上 Math.abs 防呆)
    const baseSalary = Math.abs(getNum('sys-salary-val'));
    const salaryGrowth = getNum('sys-salary-growth') / 100;
    const otherIncTotal = state.preIncomes.reduce((s, i) => s + Math.abs(parseFloat(i.val)||0), 0);
    
    const expTotal = state.preExpenses.reduce((s, i) => s + Math.abs(parseFloat(i.val)||0), 0);
    const retIncTotal = state.postIncomes.reduce((s, i) => s + Math.abs(parseFloat(i.val)||0), 0);
    
    const hasRetInput = state.postExpenses.some(i => i.val !== '');
    const retExpTotalRaw = state.postExpenses.reduce((s, i) => s + Math.abs(parseFloat(i.val)||0), 0);
    const simBaseRetExp = (retExpTotalRaw === 0 && !hasRetInput) ? expTotal : retExpTotalRaw;

    // 4. 房貸計算
    const houseValue = getNum('loan-value');
    const loanPrincipal = getNum('loan-principal');
    const loanRateYear = getNum('loan-rate');
    const loanYears = getNum('loan-years');
    const houseGrowth = getNum('loan-growth') / 100;

    let monthlyLoanPay = 0;
    let loanPayoffAge = null;
    if (loanPrincipal > 0 && loanYears > 0) {
        if (loanRateYear > 0) {
            const r = loanRateYear / 100 / 12;
            const n = loanYears * 12;
            monthlyLoanPay = loanPrincipal * ((r * Math.pow(1+r, n)) / (Math.pow(1+r, n) - 1));
        } else {
            monthlyLoanPay = loanPrincipal / (loanYears * 12);
        }
        loanPayoffAge = curAge + loanYears;
    }

    document.getElementById('disp-loan-pay').innerText = "$" + fmt(monthlyLoanPay);
    document.getElementById('sys-loan-pre').value = Math.round(monthlyLoanPay);
    const postLoanPay = (loanPayoffAge && retAge < loanPayoffAge) ? monthlyLoanPay : 0;
    document.getElementById('sys-loan-post').value = Math.round(postLoanPay);

    // 5. 當前 (Year 0) 的現金流速算
    let monthlyOtherPassive = currentAssets.reduce((s, a) => s + (a.val * (a.rate/12)), 0);
    let coreInitYield = corePrincipal * (corePreYield / 12);
    let totalPassive = monthlyOtherPassive + coreInitYield;
    
    const totalPreIncome = baseSalary + otherIncTotal + totalPassive;
    const totalPreExpense = expTotal + monthlyInterest + monthlyLoanPay + baseMonthlyAdd;
    const cashFlow = totalPreIncome - totalPreExpense;
    
    const liquidNetWorth = Math.max(0, currentAssets.reduce((s,a)=>s+a.val, 0) + corePrincipal - debtTotal);

    currentEqHTML = `
        <div class="eq-row"><span>總收入</span><span>$${fmt(totalPreIncome)}</span></div>
        <div class="eq-row eq-sub"><span>• 工作薪資</span><span>$${fmt(baseSalary)}</span></div>
        <div class="eq-row eq-sub"><span>• 其他主動收入</span><span>$${fmt(otherIncTotal)}</span></div>
        <div class="eq-row eq-sub"><span>• 其他資產配息</span><span>$${fmt(monthlyOtherPassive)}</span></div>
        <div class="eq-row eq-sub" style="color:#F5A623;"><span>• 核心投資配息</span><span>$${fmt(coreInitYield)}</span></div>
        <div style="height:10px;"></div>
        <div class="eq-row"><span>總支出</span><span>$${fmt(totalPreExpense)}</span></div>
        <div class="eq-row eq-sub neg"><span>• 生活支出</span><span>$${fmt(expTotal)}</span></div>
        <div class="eq-row eq-sub neg"><span>• 房貸月付款</span><span>$${fmt(monthlyLoanPay)}</span></div>
        <div class="eq-row eq-sub neg"><span>• 負債月息</span><span>$${fmt(monthlyInterest)}</span></div>
        <div class="eq-row eq-sub neg" style="color:var(--color-primary);"><span>• 預定投資扣款</span><span>$${fmt(baseMonthlyAdd)}</span></div>
        <div style="border-top:1px dashed rgba(255,255,255,0.3); margin:10px 0;"></div>
        <div class="eq-row" style="font-weight:bold; font-size:16px;"><span>淨現金流 (結餘)</span><span style="color: ${cashFlow >= 0 ? '#A8E6CF' : '#FFD3B6'}">${cashFlow > 0 ? '+' : ''}$${fmt(cashFlow)}</span></div>
    `;

    // ==============================================================
    // 6. 核心迴圈：模擬未來 30~70 年的逐月資產變化 (修復暴增 Bug)
    // ==============================================================
    let simNewMoney = 0; 
    let coreInvestBal = corePrincipal; 
    
    let depletionAge = null;
    let crossOverAge = null; 
    let permanentStop = false;
    let stopAge = null;
    
    let vals = { retire: 0, a70: 0, a80: 0, a90: 0, a80Liquid: 0 }; 
    let simHouseVal = houseValue;
    let simLoanBal = loanPrincipal;
    let chartData = [];
    let heatmapData = [];

    for (let age = curAge; age <= 100; age++) {
        
        if (depletionAge !== null) {
            if (age === retAge) vals.retire = 0;
            if (age === 70) vals.a70 = 0;
            if (age === 80) { vals.a80 = 0; vals.a80Liquid = 0; }
            if (age === 90) vals.a90 = 0;
            
            chartData.push({ age: age, liquid: 0, equity: 0 });
            heatmapData.push({
                age,
                i1_c: 'c-r', i1_t: `【${age}歲】資金已耗盡`,
                i2_c: 'c-r', i2_t: `【${age}歲】資金已耗盡`,
                i3_c: 'c-r', i3_t: `【${age}歲】資金已耗盡`,
                i4_c: 'c-r', i4_t: `【${age}歲】資金已耗盡`,
                i5_c: 'c-r', i5_t: `【${age}歲】資金已耗盡`
            });
            continue; 
        }

        let factor = Math.pow(1 + inflation, age - curAge);
        const hasLoan = loanPayoffAge ? (age < loanPayoffAge) : false;
        let currentSalary = baseSalary * Math.pow(1 + salaryGrowth, age - curAge);

        let isPre = age < retAge;
        let c_growth = isPre ? corePreGrowth : corePostGrowth;
        let c_yield = isPre ? corePreYield : corePostYield;
        let c_targetAdd = (isPre || !stopAtRetire) ? baseMonthlyAdd : 0;

        let yearIn = 0, yearOut = 0, yearDebtPay = 0, yearPassive = 0, yearWithdrawal = 0;

        // 跑 12 個月
        for (let m = 0; m < 12; m++) {
            // 房產增值與房貸扣款
            simHouseVal += simHouseVal * (houseGrowth / 12);
            if (hasLoan && simLoanBal > 0) {
                let loanInt = simLoanBal * (loanRateYear / 100 / 12);
                let loanPrin = monthlyLoanPay - loanInt;
                simLoanBal -= loanPrin;
                if(simLoanBal < 0) simLoanBal = 0;
            }

            let debtInt = debtTotal * (debtAvgRate / 12);
            let currentLoanPay = hasLoan ? monthlyLoanPay : 0;
            let monthIn = 0, monthOut = 0;

            if (isPre) {
                monthIn = currentSalary + (otherIncTotal * factor);
                monthOut = (expTotal * factor) + debtInt + currentLoanPay;
            } else {
                monthIn = retIncTotal; 
                monthOut = (simBaseRetExp * factor) + (medical * factor) + debtInt + currentLoanPay;
            }

            // 配息計算
            let monthOtherPassive = currentAssets.reduce((s, a) => s + (a.val * (a.rate / 12)), 0);
            let monthCoreYield = coreInvestBal * (c_yield / 12);
            let totalMonthYield = monthOtherPassive + monthCoreYield;

            yearIn += monthIn; 
            yearOut += monthOut; 
            yearDebtPay += (debtInt + currentLoanPay); 
            yearPassive += totalMonthYield;

            // 結算淨現金流
            let netBeforeInvest = monthIn + totalMonthYield - monthOut;
            if (!permanentStop && netBeforeInvest < c_targetAdd) {
                permanentStop = true;
                stopAge = age;
            }

            let actualAdd = permanentStop ? 0 : c_targetAdd;
            let netCash = netBeforeInvest - actualAdd;
            
            coreInvestBal += actualAdd; 

            // 結餘處置
            if (netCash >= 0) {
                // 如果有剩錢，根據設定決定要去「核心投資」還是「留現金」
                if (surplusToInvest) coreInvestBal += netCash; 
                else simNewMoney += netCash; 
            } else {
                // 如果缺錢，開始依序抽乾資金池
                let deficit = Math.abs(netCash);
                yearWithdrawal += deficit;

                if (simNewMoney >= deficit) { simNewMoney -= deficit; deficit = 0; }
                else { deficit -= simNewMoney; simNewMoney = 0; }

                if (deficit > 0) {
                    for (let i = 0; i < currentAssets.length; i++) {
                        if (currentAssets[i].val >= deficit) { currentAssets[i].val -= deficit; deficit = 0; break; }
                        else { deficit -= currentAssets[i].val; currentAssets[i].val = 0; }
                    }
                }
                
                if (deficit > 0) {
                    if (coreInvestBal >= deficit) { coreInvestBal -= deficit; deficit = 0; }
                    else { deficit -= coreInvestBal; coreInvestBal = 0; }
                }

                // 若三大池全空，宣告破產
                if (deficit > 0) {
                    depletionAge = age;
                    break; 
                }
            }

            // 【重大 Bug 修復】：移除其他資產本金的無限膨脹 (Double Counting)
            // 原本的寫法會讓配息既成為 netCash 又放大本金，導致資產指數級暴增。
            
            // 核心投資依然要計算「純資本利得 (不發現金的部分)」
            coreInvestBal += coreInvestBal * (c_growth / 12);
            
            // 現金水庫微薄利息
            if (simNewMoney > 0) simNewMoney += simNewMoney * (defaultCashRate / 12); 
        }

        // 年度結算與圖表資料準備
        let endLiquid = 0, endEquity = 0, endTotalNW = 0;

        if (depletionAge !== null) {
            endLiquid = 0;
            endEquity = 0;
            endTotalNW = 0;
        } else {
            if (crossOverAge === null && cashFlow > 0 && (yearOut > yearIn + yearPassive)) { crossOverAge = age; }
            endLiquid = Math.max(0, currentAssets.reduce((s,a)=>s+a.val, 0) + simNewMoney + coreInvestBal - debtTotal);
            endEquity = Math.max(0, simHouseVal - simLoanBal);
            endTotalNW = endLiquid + endEquity;
        }

        if (age === retAge) vals.retire = endTotalNW;
        if (age === 70) vals.a70 = endTotalNW;
        if (age === 80) { vals.a80 = endTotalNW; vals.a80Liquid = endLiquid; }
        if (age === 90) vals.a90 = endTotalNW;

        chartData.push({ age: age, liquid: endLiquid, equity: endEquity });

        if (depletionAge !== null) {
            heatmapData.push({
                age,
                i1_c: 'c-r', i1_t: `【${age}歲】資金已耗盡`,
                i2_c: 'c-r', i2_t: `【${age}歲】資金已耗盡`,
                i3_c: 'c-r', i3_t: `【${age}歲】資金已耗盡`,
                i4_c: 'c-r', i4_t: `【${age}歲】資金已耗盡`,
                i5_c: 'c-r', i5_t: `【${age}歲】資金已耗盡`
            });
            continue;
        }

        let avgMonthOut = yearOut / 12;
        let emRatio = avgMonthOut > 0 ? (endLiquid / avgMonthOut) : 999;
        let i1_c = emRatio > 6 ? 'c-g' : (emRatio >= 3 ? 'c-y' : 'c-r');
        let i1_t = `【${age}歲】緊急預備金：${emRatio>99 ? '>99' : Math.max(0, emRatio).toFixed(1)} 個月`;

        let i2_c, i2_t;
        if (age < retAge) {
            let totalYIn = yearIn + yearPassive;
            let saveRate = totalYIn > 0 ? ((totalYIn - yearOut) / totalYIn) * 100 : -100;
            i2_c = saveRate > 20 ? 'c-g' : (saveRate >= 0 ? 'c-y' : 'c-r');
            i2_t = `【${age}歲】儲蓄率：${saveRate.toFixed(1)}%`;
        } else {
            let wRate = endTotalNW > 0 ? (yearWithdrawal / endTotalNW) * 100 : 100;
            if (yearWithdrawal === 0) wRate = 0;
            if (endTotalNW <= 0) wRate = 100;
            i2_c = wRate < 4 ? 'c-g' : (wRate <= 8 ? 'c-y' : 'c-r');
            i2_t = `【${age}歲】提領率：${wRate.toFixed(1)}%`;
        }

        let debtRate = yearIn > 0 ? (yearDebtPay / yearIn) * 100 : (yearDebtPay > 0 ? 100 : 0);
        let i3_c = debtRate < 20 ? 'c-g' : (debtRate <= 40 ? 'c-y' : 'c-r');
        let i3_t = `【${age}歲】負債壓力：${debtRate.toFixed(1)}%`;

        let fiRate = yearOut > 0 ? (yearPassive / yearOut) * 100 : 100;
        let i4_c = fiRate >= 100 ? 'c-g' : (fiRate >= 30 ? 'c-y' : 'c-r');
        let i4_t = `【${age}歲】自由度：${fiRate.toFixed(1)}%`;

        let liqRate = endTotalNW > 0 ? (endLiquid / endTotalNW) * 100 : 0;
        if(endLiquid <= 0) liqRate = 0;
        let i5_c = liqRate > 30 ? 'c-g' : (liqRate >= 10 ? 'c-y' : 'c-r');
        let i5_t = `【${age}歲】流動資產佔比：${liqRate.toFixed(1)}%`;

        heatmapData.push({ age, i1_c, i1_t, i2_c, i2_t, i3_c, i3_t, i4_c, i4_t, i5_c, i5_t });
    }

    // 7. 更新畫面顯示數值
    document.getElementById('disp-liquid').innerText = fmt(liquidNetWorth);
    const cfEl = document.getElementById('disp-cashflow');
    cfEl.innerText = (cashFlow > 0 ? '+' : '') + fmt(cashFlow);
    cfEl.className = 'summary-val ' + (cashFlow >= 0 ? 'positive' : 'negative');
    const depEl = document.getElementById('disp-depletion');
    if (depletionAge) {
        depEl.innerText = depletionAge + ' 歲';
        depEl.className = 'summary-val negative';
    } else {
        depEl.innerText = '♾️ 永續';
        depEl.className = 'summary-val positive';
    }

    document.getElementById('r-pre-inc').innerText = "$" + fmt(totalPreIncome);
    document.getElementById('r-pre-exp').innerText = "$" + fmt(totalPreExpense);
    
    const totalPostIncome = retIncTotal + totalPassive; 
    const totalPostExpense = simBaseRetExp + medical + monthlyInterest + (stopAtRetire ? 0 : baseMonthlyAdd);
    document.getElementById('r-post-inc').innerText = "$" + fmt(totalPostIncome);
    document.getElementById('r-post-exp').innerText = "$" + fmt(totalPostExpense);

    document.getElementById('ms-retire').innerText = "$" + fmt(vals.retire);
    document.getElementById('ms-70').innerText = "$" + fmt(vals.a70);
    document.getElementById('ms-80').innerText = "$" + fmt(vals.a80);
    document.getElementById('ms-90').innerText = "$" + fmt(vals.a90);

    const alertBox = document.getElementById('dynamic-alert');
    let alertMsg = "";
    if (permanentStop && stopAge !== null && stopAge < retAge) {
        alertMsg += `⚠️ <b>智慧停扣啟動：</b> 由於通膨吞噬或支出過高，系統偵測您在 <b>${stopAge} 歲</b> 時已無力負擔預定投資計畫。系統已觸發【永久停扣】以保全現金。<br><br>`;
    }
    if (cashFlow > 0 && depletionAge !== null && crossOverAge) {
        alertMsg += `⚠️ <b>通膨危機洞察：</b> 物價將逐漸吞噬目前的結餘，預計在 <b>${crossOverAge} 歲</b> 時發生「收支死亡交叉」(支出大於收入)，並在 <b>${depletionAge} 歲</b> 面臨資金耗盡。`;
    }

    if (alertMsg !== "") {
        document.getElementById('alert-text').innerHTML = alertMsg;
        alertBox.style.display = 'block';
    } else {
        alertBox.style.display = 'none';
    }

    // 8. 呼叫外部渲染模組
    if(typeof renderHeatmap === 'function') renderHeatmap(heatmapData);

    const resultsObj = { cashFlow, depletionAge, retireNW: vals.retire, a80NW: vals.a80, a80Liquid: vals.a80Liquid };
    if(typeof saveCurrentScenario === 'function') saveCurrentScenario(resultsObj); 
    if(typeof updateChart === 'function') updateChart(chartData);
    if(typeof renderComparisonTable === 'function') renderComparisonTable();
}

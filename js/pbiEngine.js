// ==========================================
// 恐慌抄底模型 - 數學決策引擎 (PBI Math Core)
// 實作 KDJ, AMT, MACD, 240MA 等四大技術因子
// ==========================================

window.pbiEngine = {
    /**
     * 接收 250 天的歷史 K 線陣列，輸出該標的的最終分數與行動判定
     * @param {Array} marketData - [{ date, close, high, low, volume }, ...]
     * @returns {Object} 判定結果與詳細因子得分
     */
    evaluate: function(marketData) {
        if (!marketData || marketData.length < 30) {
            return { action: 'Wait', score: 0, error: '資料長度不足' };
        }

        const len = marketData.length;
        const today = marketData[len - 1];

        // ==========================================
        // 因子一：日線 KDJ 深度階梯 (9, 3, 3)
        // ==========================================
        let k = 50, d = 50;
        let kArr = [], dArr = [];
        
        for (let i = 0; i < len; i++) {
            let startIdx = Math.max(0, i - 8); // 近 9 日
            let windowData = marketData.slice(startIdx, i + 1);
            let highestHigh = Math.max(...windowData.map(item => item.high || item.close));
            let lowestLow = Math.min(...windowData.map(item => item.low || item.close));

            let rsv = 50;
            if (highestHigh !== lowestLow) {
                rsv = ((marketData[i].close - lowestLow) / (highestHigh - lowestLow)) * 100;
            }
            k = (2 / 3) * k + (1 / 3) * rsv;
            d = (2 / 3) * d + (1 / 3) * k;
            
            kArr.push(k);
            dArr.push(d);
        }

        const yesterdayK = kArr[len - 2];
        const yesterdayD = dArr[len - 2];
        const todayK = kArr[len - 1];
        const todayD = dArr[len - 1];

        let scoreKDJ = 0;
        // 觸發大前提：低檔黃金交叉
        if (yesterdayK < 25 && yesterdayK < yesterdayD && todayK > todayD) {
            if (yesterdayK < 10) scoreKDJ = 40;
            else if (yesterdayK < 15) scoreKDJ = 30;
            else if (yesterdayK < 20) scoreKDJ = 20;
        }

        // ==========================================
        // 因子二：日線 AMT 量能階梯 (20MA Volume)
        // ==========================================
        let volSum = 0;
        let volDays = Math.min(20, len);
        for (let i = len - volDays; i < len; i++) {
            volSum += (marketData[i].volume || 0);
        }
        let vol20MA = volSum / volDays;
        let volRatio = vol20MA > 0 ? (today.volume / vol20MA) : 0;

        let scoreAMT = 0;
        if (volRatio >= 2.5) scoreAMT = 40;
        else if (volRatio >= 2.0) scoreAMT = 30;
        else if (volRatio >= 1.5) scoreAMT = 15;

        // ==========================================
        // 因子三：日線 MACD 動能收斂 (12, 26, 9)
        // ==========================================
        const calcEMA = (data, period) => {
            let multiplier = 2 / (period + 1);
            let ema = data[0].close;
            let emaArr = [ema];
            for (let i = 1; i < data.length; i++) {
                ema = (data[i].close - ema) * multiplier + ema;
                emaArr.push(ema);
            }
            return emaArr;
        };

        const ema12 = calcEMA(marketData, 12);
        const ema26 = calcEMA(marketData, 26);
        let difArr = [];
        for (let i = 0; i < len; i++) {
            difArr.push(ema12[i] - ema26[i]);
        }

        let dea = difArr[0];
        let deaArr = [dea];
        let deaMultiplier = 2 / (9 + 1);
        for (let i = 1; i < len; i++) {
            dea = (difArr[i] - dea) * deaMultiplier + dea;
            deaArr.push(dea);
        }

        let oscArr = [];
        for (let i = 0; i < len; i++) {
            oscArr.push(difArr[i] - deaArr[i]);
        }

        let scoreMACD = 0;
        if (len >= 4) {
            const oscT3 = oscArr[len - 4]; // 大前天
            const oscT2 = oscArr[len - 3]; // 前天
            const oscT1 = oscArr[len - 2]; // 昨日
            const oscT0 = oscArr[len - 1]; // 本日

            // 綠柱連續兩天縮短
            if (oscT3 < oscT2 && oscT2 < oscT1 && oscT0 > oscT1 && oscT0 < 0) {
                scoreMACD = 30;
            }
        }

        // ==========================================
        // 因子四：240MA 乖離率防護網 (BIAS)
        // ==========================================
        let maDays = Math.min(240, len);
        let closeSum = 0;
        for (let i = len - maDays; i < len; i++) {
            closeSum += marketData[i].close;
        }
        let ma240 = closeSum / maDays;
        let bias = ma240 > 0 ? (today.close - ma240) / ma240 : 0;

        let multiplierBIAS = 1.0;
        if (bias > 0.15) multiplierBIAS = 0.7;        // 高檔過熱
        else if (bias < -0.10) multiplierBIAS = 1.5;  // 史詩級超跌
        else if (bias < 0.00) multiplierBIAS = 1.2;   // 一般破年線

        // ==========================================
        // 最終分數與評級結算
        // ==========================================
        let baseScore = scoreKDJ + scoreAMT + scoreMACD;
        let finalScore = Math.round(baseScore * multiplierBIAS);

        let action = 'Wait';
        let badge = '⚪';
        let colorClass = 'text-muted'; // 用於 UI 樣式

        if (finalScore >= 90) { 
            action = '大買'; 
            badge = '🔴'; 
            colorClass = 'text-red';
        } else if (finalScore >= 75) { 
            action = '買入'; 
            badge = '🟡'; 
            colorClass = 'text-warning'; // 假設我們 css 有 .text-warning
        } else if (finalScore >= 60) { 
            action = '小買'; 
            badge = '🟢'; 
            colorClass = 'text-green';
        }

        return {
            symbol: marketData.symbol || 'Unknown',
            score: finalScore,
            action: action,
            badge: badge,
            colorClass: colorClass,
            details: {
                kdj: scoreKDJ,
                amt: scoreAMT,
                macd: scoreMACD,
                biasMultiplier: multiplierBIAS,
                biasPct: (bias * 100).toFixed(2),
                closePrice: today.close.toFixed(2)
            }
        };
    }
};

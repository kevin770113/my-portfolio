// ==========================================
// PBI 恐慌抄底雷達 - 決策核心引擎 (ES Module)
// ==========================================

export const pbiEngine = {
    evaluate: function(data) {
        // 防呆與資料長度檢查 (至少需要 30 天資料才能計算指標)
        if (!data || !Array.isArray(data) || data.length < 30) {
            return { error: true, symbol: data.symbol || 'UNKNOWN', score: 0 };
        }

        // 確保資料依時間排序 (舊到新)
        const sortedData = [...data].sort((a, b) => a.date - b.date);
        const closePrices = sortedData.map(d => d.close);
        const highs = sortedData.map(d => d.high);
        const lows = sortedData.map(d => d.low);
        const volumes = sortedData.map(d => d.volume || 0);
        const currentClose = closePrices[closePrices.length - 1];

        // ------------------------------------------
        // 1. KDJ 深度計算 (9, 3, 3)
        // ------------------------------------------
        let kdjScore = 0;
        const kdj = this.calculateKDJ(highs, lows, closePrices);
        const lastJ = kdj.j[kdj.j.length - 1];
        
        if (lastJ < 0) kdjScore = 30;         // 超賣極值
        else if (lastJ < 10) kdjScore = 20;   // 嚴重超賣
        else if (lastJ < 20) kdjScore = 10;   // 輕微超賣

        // ------------------------------------------
        // 2. MACD 動能計算 (12, 26, 9)
        // ------------------------------------------
        let macdScore = 0;
        const macd = this.calculateMACD(closePrices);
        const lastHist = macd.histogram[macd.histogram.length - 1];
        const prevHist = macd.histogram[macd.histogram.length - 2];
        
        // 判斷柱狀圖收斂 (綠柱縮短或紅柱伸長)
        if (lastHist > prevHist && lastHist < 0) macdScore = 20; // 綠柱縮短
        else if (lastHist > 0 && prevHist < 0) macdScore = 30;   // 黃金交叉

        // ------------------------------------------
        // 3. AMT 量能計算 (5日均量 vs 20日均量)
        // ------------------------------------------
        let amtScore = 0;
        if (volumes.length >= 20) {
            const vol5 = volumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
            const vol20 = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
            if (vol5 > vol20 * 1.5) amtScore = 20;      // 爆量
            else if (vol5 > vol20 * 1.2) amtScore = 10; // 溫和放量
        }

        // ------------------------------------------
        // 4. 240MA 防護 (年線乖離率)
        // ------------------------------------------
        let biasScore = 0;
        let biasPct = 0;
        let biasMultiplier = 1.0;
        if (closePrices.length >= 240) {
            const ma240 = closePrices.slice(-240).reduce((a, b) => a + b, 0) / 240;
            biasPct = ((currentClose - ma240) / ma240) * 100;
            
            // 負乖離過大，觸發抄底倍數
            if (biasPct < -20) {
                biasScore = 20;
                biasMultiplier = 2.0;
            } else if (biasPct < -10) {
                biasScore = 10;
                biasMultiplier = 1.5;
            }
        } else {
            // 如果上市未滿 240 天，用 60MA 替代，但不給加成倍數
            const days = Math.min(60, closePrices.length);
            const ma = closePrices.slice(-days).reduce((a, b) => a + b, 0) / days;
            biasPct = ((currentClose - ma) / ma) * 100;
        }

        // ------------------------------------------
        // 總分計算與標籤判定
        // ------------------------------------------
        let rawScore = kdjScore + macdScore + amtScore + biasScore;
        let finalScore = Math.min(100, Math.round(rawScore * biasMultiplier));

        let badge = '⚪';
        let action = '無訊號';
        let colorClass = '';

        if (finalScore >= 80) { 
            badge = '🔴'; action = '強力買入'; colorClass = 'text-red'; 
        } else if (finalScore >= 60) { 
            badge = '🟡'; action = '分批佈局'; colorClass = 'text-red'; 
        } else if (finalScore >= 40) { 
            badge = '🟢'; action = '持有觀望'; colorClass = 'text-green'; 
        }

        return {
            error: false,
            symbol: data.symbol,
            score: finalScore,
            badge: badge,
            action: action,
            colorClass: colorClass,
            details: {
                closePrice: currentClose.toFixed(2),
                kdj: kdjScore,
                macd: macdScore,
                amt: amtScore,
                biasPct: biasPct.toFixed(1),
                biasMultiplier: biasMultiplier
            }
        };
    },

    calculateKDJ: function(highs, lows, closes, n = 9, m1 = 3, m2 = 3) {
        let k = [], d = [], j = [];
        for (let i = 0; i < closes.length; i++) {
            if (i < n - 1) {
                k.push(50); d.push(50); j.push(50);
                continue;
            }
            const currentHighs = highs.slice(i - n + 1, i + 1);
            const currentLows = lows.slice(i - n + 1, i + 1);
            const hn = Math.max(...currentHighs);
            const ln = Math.min(...currentLows);
            
            let rsv = 50;
            if (hn !== ln) {
                rsv = ((closes[i] - ln) / (hn - ln)) * 100;
            }
            
            const prevK = k[i - 1];
            const prevD = d[i - 1];
            
            const currentK = (2/3) * prevK + (1/3) * rsv;
            const currentD = (2/3) * prevD + (1/3) * currentK;
            const currentJ = 3 * currentK - 2 * currentD;
            
            k.push(currentK);
            d.push(currentD);
            j.push(currentJ);
        }
        return { k, d, j };
    },

    calculateMACD: function(closes, short = 12, long = 26, mid = 9) {
        const calculateEMA = (data, period) => {
            let k = 2 / (period + 1);
            let emaData = [data[0]];
            for (let i = 1; i < data.length; i++) {
                emaData.push(data[i] * k + emaData[i - 1] * (1 - k));
            }
            return emaData;
        };

        const shortEMA = calculateEMA(closes, short);
        const longEMA = calculateEMA(closes, long);
        
        const dif = shortEMA.map((val, idx) => val - longEMA[idx]);
        const dea = calculateEMA(dif, mid);
        const histogram = dif.map((val, idx) => (val - dea[idx]) * 2);

        return { dif, dea, histogram };
    }
};

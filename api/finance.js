export default async function handler(req, res) {
    // 1. 設定 CORS 標頭
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ status: 'error', error: 'Method Not Allowed' });
    }

    const { symbols } = req.body;

    if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
        return res.status(400).json({ status: 'error', error: '請提供有效的 symbols 陣列' });
    }

    try {
        const chartUrl = (sym) => `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?range=10y&interval=1d&events=div`;
        const quoteUrl = (sym) => `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${sym}`;
        
        const fetchOptions = {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'application/json'
            }
        };

        // 【核心處理函式】
        const safeFetch = async (sym) => {
            let currentPrice = 0;
            let prevClose = 0;
            let stockName = sym;
            let cagr = 0;
            let stdev = 0;
            let historyYears = 0;
            let dividendYield = 0;
            let ytd = 0;         // 新增：今年以來報酬率
            let change = 0;      // 新增：單日漲跌金額
            let changePercent = 0;

            try {
                const chartRes = await fetch(chartUrl(sym), fetchOptions);
                
                if (chartRes.ok) {
                    const data = await chartRes.json();
                    if (data.chart && data.chart.result && data.chart.result[0]) {
                        const result = data.chart.result[0];
                        const meta = result.meta;
                        
                        // 取得報價與時間戳記
                        const timestamps = result.timestamp || [];
                        // 優先使用還原權息的 adjclose，若無則用一般 close
                        const rawPrices = result.indicators.adjclose?.[0]?.adjclose || result.indicators.quote[0].close || [];

                        currentPrice = meta.regularMarketPrice || 0;
                        prevClose = meta.chartPreviousClose || meta.previousClose || 0;
                        stockName = meta.shortName || meta.longName || sym;

                        // 清洗歷史資料：過濾 null 並綁定時間
                        const history = [];
                        for (let k = 0; k < timestamps.length; k++) {
                            if (rawPrices[k] !== null && rawPrices[k] > 0) {
                                history.push({ time: timestamps[k], price: rawPrices[k] });
                            }
                        }

                        if (history.length > 0) {
                            const cleanPrices = history.map(h => h.price);
                            
                            // A. 修復：如果 meta 沒有昨收價，抓歷史紀錄倒數第二筆
                            if (!prevClose && cleanPrices.length > 1) {
                                prevClose = cleanPrices[cleanPrices.length - 2];
                            }

                            // B. 運算 YTD (今年以來績效)
                            const currentYear = new Date().getFullYear();
                            let lastYearEndPrice = null;
                            // 從後面往前找，找到第一個年份小於今年的收盤價
                            for (let j = history.length - 1; j >= 0; j--) {
                                const date = new Date(history[j].time * 1000);
                                if (date.getFullYear() < currentYear) {
                                    lastYearEndPrice = history[j].price;
                                    break;
                                }
                            }
                            if (lastYearEndPrice) {
                                ytd = (currentPrice - lastYearEndPrice) / lastYearEndPrice;
                            } else {
                                // 如果是今年剛上市的新股，用第一天收盤價算 YTD
                                ytd = (currentPrice - cleanPrices[0]) / cleanPrices[0];
                            }

                            // C. 運算 CAGR 與標準差
                            if (cleanPrices.length > 20) {
                                const firstPrice = cleanPrices[0];
                                const lastPrice = cleanPrices[cleanPrices.length - 1];
                                historyYears = parseFloat((cleanPrices.length / 252).toFixed(1));
                                
                                if (historyYears > 0) {
                                    cagr = Math.pow(lastPrice / firstPrice, 1 / historyYears) - 1;
                                }
                                
                                let sumReturns = 0;
                                let returns = [];
                                for (let j = 1; j < cleanPrices.length; j++) {
                                    const r = (cleanPrices[j] - cleanPrices[j-1]) / cleanPrices[j-1];
                                    returns.push(r);
                                    sumReturns += r;
                                }
                                const meanReturn = sumReturns / returns.length;
                                const variance = returns.reduce((acc, val) => acc + Math.pow(val - meanReturn, 2), 0) / returns.length;
                                stdev = Math.sqrt(variance) * Math.sqrt(252);
                            }
                        }

                        // D. 計算殖利率
                        let trailingDiv = 0;
                        if (result.events && result.events.dividends) {
                            const now = Date.now() / 1000;
                            const oneYearAgo = now - 31536000;
                            Object.values(result.events.dividends).forEach(d => {
                                if (d.date >= oneYearAgo) trailingDiv += d.amount;
                            });
                        }
                        dividendYield = currentPrice ? (trailingDiv / currentPrice) : 0;
                    }
                } else {
                    // 【備援路線】歷史 API 失敗，改用即時報價 API
                    console.warn(`[備援] ${sym} 歷史資料遭拒，改抓即時報價...`);
                    const quoteRes = await fetch(quoteUrl(sym), fetchOptions);
                    
                    if (quoteRes.ok) {
                        const quoteData = await quoteRes.json();
                        if (quoteData.quoteResponse && quoteData.quoteResponse.result && quoteData.quoteResponse.result.length > 0) {
                            const q = quoteData.quoteResponse.result[0];
                            currentPrice = q.regularMarketPrice || 0;
                            prevClose = q.regularMarketPreviousClose || 0;
                            stockName = q.shortName || q.longName || sym;
                            dividendYield = (q.trailingAnnualDividendYield / 100) || 0;
                            ytd = q.ytdReturn ? (q.ytdReturn / 100) : 0; // Quote API 偶爾有自帶 YTD
                        } else {
                            return { symbol: sym, error: true, message: '查無此代號' };
                        }
                    } else {
                        return { symbol: sym, error: true, message: '伺服器拒絕連線' };
                    }
                }

                if (currentPrice === 0) {
                    return { symbol: sym, error: true, message: '無法取得有效報價' };
                }

                // 結算今日漲跌 (防止 prevClose 為 0 的保護機制)
                change = prevClose ? (currentPrice - prevClose) : 0;
                changePercent = prevClose ? (change / prevClose) : 0;

                return {
                    symbol: sym,
                    error: false,
                    data: {
                        yahooName: stockName,
                        price: currentPrice,
                        change: change,
                        changePercent: changePercent,
                        ytd: ytd, // 回傳給前端
                        cagr: cagr,
                        stdev: stdev,
                        historyYears: historyYears,
                        dividendYield: dividendYield
                    }
                };

            } catch (err) {
                console.warn(`[錯誤] 取得 ${sym} 異常:`, err.message);
                return { symbol: sym, error: true, message: '連線異常' };
            }
        };

        // 平行發送所有請求
        const allRequests = ['TWD=X', ...symbols].map(sym => safeFetch(sym));
        const results = await Promise.all(allRequests);

        // 解析匯率
        let exchangeRate = 32.5; 
        const rateResult = results[0];
        if (!rateResult.error && rateResult.data?.price) {
            exchangeRate = rateResult.data.price;
        }

        // 整理股票數據
        const stockData = {};
        for (let i = 1; i < results.length; i++) {
            const res = results[i];
            if (!res.error) {
                stockData[res.symbol] = res.data;
            }
        }

        res.status(200).json({
            status: 'success',
            exchangeRate: exchangeRate,
            data: stockData
        });

    } catch (error) {
        console.error('API 嚴重錯誤:', error);
        res.status(500).json({ status: 'error', error: 'Internal Server Error' });
    }
}

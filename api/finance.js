export default async function handler(req, res) {
    // CORS 標頭設定
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
        const chartUrl = (sym) => `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?range=10y&interval=1d`;
        const quoteUrl = (sym) => `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${sym}`;
        
        // 偽裝成正常瀏覽器
        const fetchOptions = {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'application/json'
            }
        };

        // 【防彈與備援機制】獨立處理每檔股票
        const safeFetch = async (sym) => {
            let currentPrice = 0;
            let prevClose = 0;
            let stockName = sym;
            let cagr = 0;
            let stdev = 0;
            let historyYears = 0;
            let dividendYield = 0;

            try {
                // 優先嘗試：抓取完整歷史資料 (含算 CAGR 需要的數據)
                const chartRes = await fetch(chartUrl(sym), fetchOptions);
                
                if (chartRes.ok) {
                    const data = await chartRes.json();
                    if (data.chart && data.chart.result && data.chart.result[0]) {
                        const result = data.chart.result[0];
                        const meta = result.meta;
                        const quotes = result.indicators.quote?.[0]?.close || [];

                        currentPrice = meta.regularMarketPrice || 0;
                        prevClose = meta.chartPreviousClose || 0;
                        stockName = meta.shortName || meta.longName || sym;

                        // 計算風險與報酬
                        const cleanPrices = quotes.filter(p => p !== null && p > 0);
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
                } else {
                    // 【備援啟動】如果 Chart API 被擋，改用 Quote API 抓基礎資料
                    console.warn(`[備援啟動] ${sym} 歷史資料遭拒，改抓即時報價...`);
                    const quoteRes = await fetch(quoteUrl(sym), fetchOptions);
                    
                    if (quoteRes.ok) {
                        const quoteData = await quoteRes.json();
                        if (quoteData.quoteResponse && quoteData.quoteResponse.result && quoteData.quoteResponse.result.length > 0) {
                            const q = quoteData.quoteResponse.result[0];
                            currentPrice = q.regularMarketPrice || 0;
                            prevClose = q.regularMarketPreviousClose || 0;
                            stockName = q.shortName || q.longName || sym;
                            dividendYield = (q.trailingAnnualDividendYield / 100) || 0; 
                        } else {
                            return { symbol: sym, error: true, message: '查無此代號' };
                        }
                    } else {
                        return { symbol: sym, error: true, message: 'Yahoo 伺服器拒絕連線' };
                    }
                }

                if (currentPrice === 0) {
                    return { symbol: sym, error: true, message: '無法取得有效報價' };
                }

                return {
                    symbol: sym,
                    error: false,
                    data: {
                        yahooName: stockName,
                        price: currentPrice,
                        change: currentPrice - prevClose,
                        changePercent: prevClose ? (currentPrice - prevClose) / prevClose : 0,
                        cagr: cagr,
                        stdev: stdev,
                        historyYears: historyYears,
                        dividendYield: dividendYield
                    }
                };

            } catch (err) {
                console.warn(`[錯誤] 取得 ${sym} 發生例外錯誤:`, err.message);
                return { symbol: sym, error: true, message: '連線異常' };
            }
        };

        // 平行發送所有請求 (包含匯率與所有股票)
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

        // 成功回傳
        res.status(200).json({
            status: 'success',
            exchangeRate: exchangeRate,
            data: stockData
        });

    } catch (error) {
        console.error('API 嚴重錯誤:', error);
        res.status(500).json({ status: 'error', error: 'Internal Server Error', details: error.message });
    }
}

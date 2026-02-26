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
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { symbols } = req.body;

    if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
        return res.status(400).json({ error: '請提供有效的 symbols 陣列' });
    }

    try {
        const getUrl = (sym) => `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?range=10y&interval=1d&events=div`;
        const fetchOptions = {
            headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
        };

        // 【防彈機制】建立獨立的抓取函式，若單一股票失敗，不會導致全盤崩潰
        const safeFetch = async (sym) => {
            try {
                const response = await fetch(getUrl(sym), fetchOptions);
                // 檢查是否成功且為 JSON 格式 (防止 Yahoo 回傳 HTML 錯誤頁面導致當機)
                const contentType = response.headers.get("content-type");
                if (!response.ok || !contentType || !contentType.includes("application/json")) {
                    console.warn(`[警告] 取得 ${sym} 失敗或格式錯誤`);
                    return { symbol: sym, error: true };
                }
                const data = await response.json();
                return { symbol: sym, data: data };
            } catch (err) {
                console.warn(`[警告] 取得 ${sym} 發生例外錯誤:`, err.message);
                return { symbol: sym, error: true };
            }
        };

        // 2. 平行發送所有請求 (包含匯率與股票)
        const allRequests = ['TWD=X', ...symbols].map(sym => safeFetch(sym));
        const results = await Promise.all(allRequests);

        // 3. 解析匯率 (陣列的第一個)
        let exchangeRate = 32.5; // 預設安全值
        const rateResult = results[0];
        if (!rateResult.error && rateResult.data?.chart?.result?.[0]?.meta?.regularMarketPrice) {
            exchangeRate = rateResult.data.chart.result[0].meta.regularMarketPrice;
        }

        // 4. 解析個股資料
        const stockData = {};

        // 從索引 1 開始處理股票
        for (let i = 1; i < results.length; i++) {
            const { symbol, error, data } = results[i];

            // 若該筆資料抓取失敗，直接跳過，不影響其他股票
            if (error || !data.chart || !data.chart.result || !data.chart.result[0]) {
                continue; 
            }

            const result = data.chart.result[0];
            const meta = result.meta;
            const quotes = result.indicators.adjclose?.[0]?.adjclose || result.indicators.quote[0].close;

            // A. 基礎報價與名稱 (新增抓取 shortName 供前端驗證使用)
            const currentPrice = meta.regularMarketPrice;
            const prevClose = meta.chartPreviousClose;
            const stockName = meta.shortName || meta.longName || symbol; // 抓取公司真實名稱

            // B. 計算 CAGR 與 Risk
            const cleanPrices = quotes ? quotes.filter(p => p !== null && p > 0) : [];
            let cagr = 0;
            let stdev = 0;
            let historyYears = 0;

            if (cleanPrices.length > 20) {
                const firstPrice = cleanPrices[0];
                const lastPrice = cleanPrices[cleanPrices.length - 1];
                const totalDays = cleanPrices.length;
                historyYears = parseFloat((totalDays / 252).toFixed(1));

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

            // C. 推算殖利率
            let trailingDiv = 0;
            if (result.events && result.events.dividends) {
                const now = Date.now() / 1000;
                const oneYearAgo = now - 31536000;
                const divs = result.events.dividends;
                Object.values(divs).forEach(d => {
                    if (d.date >= oneYearAgo) {
                        trailingDiv += d.amount;
                    }
                });
            }
            const dividendYield = currentPrice ? (trailingDiv / currentPrice) : 0;

            // D. 打包數據 (加入 yahooName 欄位)
            stockData[symbol] = {
                yahooName: stockName, // 讓前端可以顯示 "您輸入的是: Taiwan Semi..."
                price: currentPrice,
                change: currentPrice - prevClose,
                changePercent: prevClose ? (currentPrice - prevClose) / prevClose : 0,
                cagr: cagr,
                stdev: stdev,
                historyYears: historyYears,
                dividendYield: dividendYield
            };
        }

        // 5. 回傳 JSON
        res.status(200).json({
            status: 'success',
            exchangeRate: exchangeRate,
            data: stockData
        });

    } catch (error) {
        console.error('API 嚴重錯誤:', error);
        res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
}

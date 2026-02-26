export default async function handler(req, res) {
    // 1. 設定 CORS 標頭 (允許您的網頁從瀏覽器呼叫此 API)
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    // 處理預檢請求
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    // 只接受 POST 請求 (因為我們要傳送股票清單)
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { symbols } = req.body; // 從前端接收到的代號陣列，例如 ["0050.TW", "NVDA"]

    if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
        return res.status(400).json({ error: '請提供有效的 symbols 陣列' });
    }

    try {
        // 2. 準備抓取資料 (包含美金匯率 + 所有股票)
        // Yahoo Finance Chart API (抓取 10 年資料以計算長期指標)
        const getUrl = (sym) => `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?range=10y&interval=1d&events=div`;
        
        // 為了避免 Yahoo 擋擋，我們加上 User-Agent
        const fetchOptions = {
            headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
        };

        // 建立所有請求：第一個是匯率，後面是使用者傳來的股票
        // 匯率代號：TWD=X (美金兌台幣)
        const requests = [
            fetch(getUrl('TWD=X'), fetchOptions).then(r => r.json()),
            ...symbols.map(sym => fetch(getUrl(sym), fetchOptions).then(r => r.json()))
        ];

        // 平行處理所有請求 (加快速度)
        const results = await Promise.all(requests);

        // 3. 解析匯率 (第一個結果)
        const rateData = results[0];
        // 如果抓不到，預設 32.5 (容錯機制)
        const exchangeRate = rateData.chart?.result?.[0]?.meta?.regularMarketPrice || 32.5;

        // 4. 解析個股資料並進行「量化運算」
        const stockData = {};

        // 從索引 1 開始走訪每一檔股票
        for (let i = 1; i < results.length; i++) {
            const symbol = symbols[i - 1];
            const data = results[i];

            // 檢查資料是否有效
            if (!data.chart || !data.chart.result || !data.chart.result[0]) {
                console.warn(`無法抓取 ${symbol} 的資料`);
                continue;
            }

            const result = data.chart.result[0];
            const meta = result.meta;
            const quotes = result.indicators.adjclose?.[0]?.adjclose || result.indicators.quote[0].close; // 優先使用還原權值(含息)

            // A. 基礎報價
            const currentPrice = meta.regularMarketPrice;
            const prevClose = meta.chartPreviousClose;

            // B. 計算年化報酬 (CAGR) 與標準差 (Risk)
            // 過濾掉無效資料 (null)
            const cleanPrices = quotes.filter(p => p !== null && p > 0);
            
            let cagr = 0;
            let stdev = 0;
            let historyYears = 0; // 實際資料長度 (年)

            if (cleanPrices.length > 20) { // 至少要有約一個月的資料才算
                const firstPrice = cleanPrices[0];
                const lastPrice = cleanPrices[cleanPrices.length - 1];
                const totalDays = cleanPrices.length;
                historyYears = parseFloat((totalDays / 252).toFixed(1)); // 假設一年 252 交易日

                // [公式] CAGR = (終值 / 初值) ^ (1 / 年數) - 1
                if (historyYears > 0) {
                    cagr = Math.pow(lastPrice / firstPrice, 1 / historyYears) - 1;
                }

                // [公式] 年化標準差 (Volatility)
                // 先算每日報酬率的標準差，再乘以 sqrt(252)
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

            // C. 推算殖利率 (Yield)
            // Yahoo Chart API 的 events.dividends 包含歷史配息
            // 我們把「過去 12 個月」的配息加總，除以現價
            let trailingDiv = 0;
            if (result.events && result.events.dividends) {
                const now = Date.now() / 1000;
                const oneYearAgo = now - 31536000; // 365天前
                const divs = result.events.dividends;
                Object.values(divs).forEach(d => {
                    if (d.date >= oneYearAgo) {
                        trailingDiv += d.amount;
                    }
                });
            }
            const dividendYield = currentPrice ? (trailingDiv / currentPrice) : 0;

            // D. 打包數據
            stockData[symbol] = {
                price: currentPrice,
                change: currentPrice - prevClose,
                changePercent: (currentPrice - prevClose) / prevClose,
                cagr: cagr,       // 年化報酬率 (小數點格式，如 0.15 代表 15%)
                stdev: stdev,     // 年化標準差
                historyYears: historyYears,
                dividendYield: dividendYield
            };
        }

        // 5. 回傳 JSON 給前端
        res.status(200).json({
            status: 'success',
            exchangeRate: exchangeRate,
            data: stockData
        });

    } catch (error) {
        console.error('API Error:', error);
        res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ status: 'error', error: 'Method Not Allowed' });

    const { symbols } = req.body;
    if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
        return res.status(400).json({ status: 'error', error: '請提供有效的 symbols 陣列' });
    }

    const FUGLE_API_KEY = process.env.FUGLE_API_KEY;

    try {
        const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
        let cookie = ''; let crumb = '';

        try {
            const cookieRes = await fetch('https://fc.yahoo.com', { headers: { 'User-Agent': userAgent } });
            const setCookieHeader = cookieRes.headers.get('set-cookie');
            if (setCookieHeader) cookie = setCookieHeader.split(';')[0]; 
            if (cookie) {
                const crumbRes = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', { headers: { 'Cookie': cookie, 'User-Agent': userAgent } });
                const crumbText = await crumbRes.text();
                if (crumbText && !crumbText.includes('html')) crumb = crumbText;
            }
        } catch (e) {}

        const fetchOptions = { headers: { 'User-Agent': userAgent, 'Accept': 'application/json', ...(cookie ? { 'Cookie': cookie } : {}) } };

        const safeFetch = async (sym) => {
            let currentPrice = 0, prevClose = 0, stockName = sym, dataTime = 0;
            let cagr = 0, stdev = 0, historyYears = 0, dividendYield = 0, ytd = 0;
            let change = 0, changePercent = 0, historicalDividends = [];

            const isTW = sym.endsWith('.TW') || sym.endsWith('.TWO');
            let hasPrimaryQuote = false;

            // 1. 【台股專屬】呼叫富果 API
            if (isTW && FUGLE_API_KEY) {
                const cleanSym = sym.replace('.TW', '').replace('.TWO', '');
                try {
                    const fRes = await fetch(`https://api.fugle.tw/marketdata/v1.0/stock/intraday/quote/${cleanSym}`, {
                        headers: { 'X-API-KEY': FUGLE_API_KEY }
                    });
                    if (fRes.ok) {
                        const fJson = await fRes.json();
                        if (fJson.data && fJson.data.quote) {
                            const q = fJson.data.quote;
                            currentPrice = (q.trade && q.trade.price) || q.previousClose || 0;
                            // ⭐️ 抓取富果的資料更新時間
                            if (fJson.data.info && fJson.data.info.lastUpdatedAt) {
                                dataTime = Math.floor(new Date(fJson.data.info.lastUpdatedAt).getTime() / 1000);
                            }
                            
                            if (currentPrice > 0) {
                                change = q.change !== undefined ? q.change : 0;
                                changePercent = q.changePercent !== undefined ? (q.changePercent / 100) : 0;
                                stockName = fJson.data.info?.name || sym;
                                prevClose = q.previousClose || (currentPrice - change);
                                hasPrimaryQuote = true;
                            }
                        }
                    }
                } catch (e) {}
            }

            // 2. 【美股與匯率】呼叫 Yahoo Quote
            if (!hasPrimaryQuote) {
                try {
                    const qRes = await fetch(`https://query2.finance.yahoo.com/v7/finance/quote?symbols=${sym}${crumb ? '&crumb='+crumb : ''}`, fetchOptions);
                    if (qRes.ok) {
                        const qData = await qRes.json();
                        if (qData.quoteResponse && qData.quoteResponse.result && qData.quoteResponse.result.length > 0) {
                            const q = qData.quoteResponse.result[0];
                            currentPrice = q.regularMarketPrice || 0;
                            // ⭐️ 抓取 Yahoo 的正規市場成交時間
                            dataTime = q.regularMarketTime || 0;
                            if (currentPrice > 0) {
                                change = q.regularMarketChange || 0;
                                changePercent = q.regularMarketChangePercent !== undefined ? (q.regularMarketChangePercent / 100) : 0;
                                prevClose = q.regularMarketPreviousClose || currentPrice;
                                stockName = q.shortName || q.longName || sym;
                                dividendYield = q.trailingAnnualDividendYield !== undefined ? (q.trailingAnnualDividendYield / 100) : 0;
                                ytd = q.ytdReturn !== undefined ? (q.ytdReturn / 100) : 0;
                                hasPrimaryQuote = true;
                            }
                        }
                    }
                } catch (e) {}
            }

            // 3. 【歷史資料】計算 CAGR 與 波動率
            try {
                const chartUrl = `https://query2.finance.yahoo.com/v8/finance/chart/${sym}?range=10y&interval=1d&events=div${crumb ? '&crumb='+crumb : ''}`;
                const chartRes = await fetch(chartUrl, fetchOptions);
                if (chartRes.ok) {
                    const chartData = await chartRes.json();
                    if (chartData.chart && chartData.chart.result && chartData.chart.result[0]) {
                        const result = chartData.chart.result[0];
                        if (!hasPrimaryQuote) {
                            currentPrice = result.meta.regularMarketPrice || 0;
                            dataTime = result.meta.regularMarketTime || 0;
                            prevClose = result.meta.regularMarketPreviousClose || result.meta.previousClose || currentPrice;
                            change = currentPrice - prevClose;
                            changePercent = prevClose ? (change / prevClose) : 0;
                            stockName = result.meta.shortName || result.meta.longName || sym;
                        }
                        const adjPrices = result.indicators.adjclose?.[0]?.adjclose || result.indicators.quote[0].close || [];
                        const validPrices = adjPrices.filter(p => p > 0);
                        if (validPrices.length > 20) {
                            const first = validPrices[0], last = validPrices[validPrices.length - 1];
                            historyYears = validPrices.length / 252;
                            if (historyYears > 0) cagr = Math.pow(last / first, 1 / historyYears) - 1;
                            let returns = [];
                            for (let i = 1; i < validPrices.length; i++) returns.push((validPrices[i] - validPrices[i-1]) / validPrices[i-1]);
                            const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
                            stdev = Math.sqrt(returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length) * Math.sqrt(252);
                        }
                        let trailingDiv = 0;
                        if (result.events && result.events.dividends) {
                            const oneYearAgo = (Date.now() / 1000) - 31536000;
                            Object.values(result.events.dividends).forEach(d => { if (d.date >= oneYearAgo) trailingDiv += d.amount; });
                        }
                        if (dividendYield === 0 && currentPrice > 0) dividendYield = trailingDiv / currentPrice;
                    }
                }
            } catch (err) {}

            if (currentPrice === 0) return { symbol: sym, error: true, message: '無效' };

            return {
                symbol: sym, error: false,
                data: { 
                    yahooName: stockName, price: currentPrice, change: change, 
                    changePercent: changePercent, ytd: ytd, cagr: cagr, 
                    stdev: stdev, dividendYield: dividendYield, 
                    regularMarketTime: dataTime // ⭐️ 將真實時間傳回
                }
            };
        };

        const resList = await Promise.all(['TWD=X', ...symbols].map(sym => safeFetch(sym)));
        let exchangeRate = 32.5, prevExchangeRate = 32.5;
        if (!resList[0].error && resList[0].data?.price) {
            exchangeRate = resList[0].data.price;
            prevExchangeRate = resList[0].data.price - resList[0].data.change; 
        }

        const stockData = {};
        for (let i = 1; i < resList.length; i++) { if (!resList[i].error) stockData[symbols[i - 1]] = resList[i].data; }

        res.status(200).json({ status: 'success', exchangeRate, prevExchangeRate, data: stockData });
    } catch (error) { res.status(500).json({ status: 'error', error: 'Internal Error' }); }
}

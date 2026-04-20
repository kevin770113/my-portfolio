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
        } catch (e) { console.warn("Crumb 取用失敗:", e.message); }

        const fetchOptions = { headers: { 'User-Agent': userAgent, 'Accept': 'application/json', ...(cookie ? { 'Cookie': cookie } : {}) } };

        const quoteUrl = (sym) => `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${sym}${crumb ? '&crumb='+crumb : ''}`;
        const chartUrl = (sym) => `https://query2.finance.yahoo.com/v8/finance/chart/${sym}?range=10y&interval=1d&events=div${crumb ? '&crumb='+crumb : ''}`;

        const safeFetch = async (sym) => {
            let currentPrice = 0, prevClose = 0, stockName = sym;
            let cagr = 0, stdev = 0, historyYears = 0, dividendYield = 0, ytd = 0;
            let change = 0, changePercent = 0, historicalDividends = [], monthlyReturns = {};

            const isTW = sym.endsWith('.TW') || sym.endsWith('.TWO');
            let hasValidQuote = false;

            // 平行發送所有 API 請求，不互相阻塞
            const promises = [
                fetch(chartUrl(sym), fetchOptions).then(r => r.json()).catch(() => null),
                fetch(quoteUrl(sym), fetchOptions).then(r => r.json()).catch(() => null)
            ];

            if (isTW && FUGLE_API_KEY) {
                const cleanSym = sym.replace('.TW', '').replace('.TWO', '');
                promises.push(
                    fetch(`https://api.fugle.tw/marketdata/v1.0/stock/intraday/quote/${cleanSym}`, {
                        headers: { 'X-API-KEY': FUGLE_API_KEY }
                    }).then(r => r.json()).catch(() => null)
                );
            }

            const results = await Promise.all(promises);
            const chartData = results[0];
            const quoteData = results[1];
            const fugleData = isTW && FUGLE_API_KEY ? results[2] : null;

            // 1. 【富果 API 解析】正確解構 data.quote
            if (fugleData && fugleData.data && fugleData.data.quote) {
                const q = fugleData.data.quote;
                const info = fugleData.data.info || {};
                currentPrice = q.closePrice || q.lastPrice || q.referencePrice || 0;
                
                if (currentPrice > 0) {
                    change = q.change !== undefined ? q.change : 0;
                    changePercent = q.changePercent !== undefined ? (q.changePercent / 100) : 0;
                    stockName = info.name || sym;
                    prevClose = q.previousClose || q.referencePrice || (currentPrice - change);
                    hasValidQuote = true;
                }
            }

            // 2. 【Yahoo Quote 解析】美股、匯率或富果連線失敗時的備案
            if (!hasValidQuote && quoteData && quoteData.quoteResponse && quoteData.quoteResponse.result && quoteData.quoteResponse.result.length > 0) {
                const q = quoteData.quoteResponse.result[0];
                currentPrice = q.regularMarketPrice || 0;
                if (currentPrice > 0) {
                    prevClose = q.regularMarketPreviousClose || currentPrice;
                    stockName = q.shortName || q.longName || sym;
                    change = q.regularMarketChange || 0; 
                    changePercent = (q.regularMarketChangePercent / 100) || 0;
                    dividendYield = (q.trailingAnnualDividendYield / 100) || 0;
                    ytd = q.ytdReturn ? (q.ytdReturn / 100) : 0;
                    hasValidQuote = true;
                }
            }

            // 3. 【歷史 K 線與備用兜底】
            if (chartData && chartData.chart && chartData.chart.result && chartData.chart.result[0]) {
                const result = chartData.chart.result[0];
                
                // 極端狀況兜底：徹底拔除 meta.previousClose 變數
                if (!hasValidQuote) {
                    currentPrice = result.meta.regularMarketPrice || 0;
                    stockName = result.meta.shortName || result.meta.longName || sym;
                    prevClose = result.meta.regularMarketPreviousClose || currentPrice;
                    change = currentPrice - prevClose;
                    changePercent = prevClose ? change / prevClose : 0;
                }

                const timestamps = result.timestamp || [];
                const adjPrices = result.indicators.adjclose?.[0]?.adjclose || result.indicators.quote[0].close || [];
                const history = [];
                for (let k = 0; k < timestamps.length; k++) {
                    if (adjPrices[k] > 0) history.push({ time: timestamps[k], price: adjPrices[k] });
                }

                if (history.length > 0) {
                    const cleanPrices = history.map(h => h.price);
                    if (ytd === 0) {
                        const currentYear = new Date().getFullYear();
                        let lastYearEndPrice = null;
                        for (let j = history.length - 1; j >= 0; j--) {
                            if (new Date(history[j].time * 1000).getFullYear() < currentYear) {
                                lastYearEndPrice = history[j].price; break;
                            }
                        }
                        if (!lastYearEndPrice) lastYearEndPrice = cleanPrices[0];
                        ytd = (currentPrice - lastYearEndPrice) / lastYearEndPrice;
                    }

                    if (cleanPrices.length > 20) {
                        const firstPrice = cleanPrices[0]; const lastPrice = cleanPrices[cleanPrices.length - 1];
                        historyYears = parseFloat((cleanPrices.length / 252).toFixed(1));
                        if (historyYears > 0) cagr = Math.pow(lastPrice / firstPrice, 1 / historyYears) - 1;
                        
                        let sumReturns = 0; let returns = [];
                        for (let j = 1; j < cleanPrices.length; j++) {
                            const r = (cleanPrices[j] - cleanPrices[j-1]) / cleanPrices[j-1];
                            returns.push(r); sumReturns += r;
                        }
                        const meanReturn = sumReturns / returns.length;
                        const variance = returns.reduce((acc, val) => acc + Math.pow(val - meanReturn, 2), 0) / returns.length;
                        stdev = Math.sqrt(variance) * Math.sqrt(252);
                    }
                    
                    try {
                        const monthEndPrices = {};
                        for (let h of history) {
                            if (h && typeof h.price === 'number') {
                                const date = new Date(h.time * 1000);
                                const yyyy = date.getUTCFullYear();
                                const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
                                monthEndPrices[`${yyyy}-${mm}`] = h.price;
                            }
                        }
                        const sortedMonths = Object.keys(monthEndPrices).sort();
                        for (let i = 1; i < sortedMonths.length; i++) {
                            const prevPrice = monthEndPrices[sortedMonths[i - 1]];
                            const currPrice = monthEndPrices[sortedMonths[i]];
                            if (prevPrice && prevPrice > 0 && currPrice !== undefined) {
                                monthlyReturns[sortedMonths[i]] = (currPrice - prevPrice) / prevPrice;
                            }
                        }
                    } catch (e) { }
                }

                let trailingDiv = 0;
                if (result.events && result.events.dividends) {
                    const oneYearAgo = (Date.now() / 1000) - 31536000;
                    Object.values(result.events.dividends).forEach(d => { 
                        if (d.date >= oneYearAgo) {
                            trailingDiv += d.amount; 
                            historicalDividends.push({ date: d.date, amount: d.amount }); 
                        }
                    });
                    historicalDividends.sort((a, b) => a.date - b.date);
                }
                if (dividendYield === 0 && currentPrice > 0) dividendYield = trailingDiv / currentPrice;
            }

            if (currentPrice === 0) return { symbol: sym, error: true, message: '無效報價' };

            return {
                symbol: sym, error: false,
                data: { 
                    yahooName: stockName, price: currentPrice, change: change, 
                    changePercent: changePercent, ytd: ytd, cagr: cagr, 
                    stdev: stdev, dividendYield: dividendYield, 
                    historicalDividends: historicalDividends,
                    monthlyReturns: monthlyReturns 
                }
            };
        };

        const allRequests = ['TWD=X', ...symbols].map(sym => safeFetch(sym));
        const resList = await Promise.all(allRequests);

        let exchangeRate = 32.5; 
        let prevExchangeRate = 32.5;
        if (!resList[0].error && resList[0].data?.price) {
            exchangeRate = resList[0].data.price;
            prevExchangeRate = resList[0].data.price - resList[0].data.change; 
        }

        const stockData = {};
        for (let i = 1; i < resList.length; i++) { if (!resList[i].error) stockData[resList[i].symbol] = resList[i].data; }

        res.status(200).json({ status: 'success', exchangeRate, prevExchangeRate, data: stockData });

    } catch (error) { 
        res.status(500).json({ status: 'error', error: 'Internal Server Error' }); 
    }
}

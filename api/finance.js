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
            let currentPrice = 0, prevClose = 0, stockName = sym;
            let cagr = 0, stdev = 0, historyYears = 0, dividendYield = 0, ytd = 0;
            let change = 0, changePercent = 0, historicalDividends = [], monthlyReturns = {};

            const isTW = sym.endsWith('.TW') || sym.endsWith('.TWO');
            let hasPrimaryQuote = false;

            // 1. 【台股專屬】精準呼叫 Fugle API
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
                            // ⭐️ 修正富果資料結構，正確讀取 trade.price
                            currentPrice = (q.trade && q.trade.price) || q.previousClose || 0;
                            
                            if (currentPrice > 0) {
                                change = q.change !== undefined ? q.change : 0;
                                changePercent = q.changePercent !== undefined ? (q.changePercent / 100) : 0;
                                stockName = fJson.data.info?.name || sym;
                                prevClose = q.previousClose || (currentPrice - change);
                                hasPrimaryQuote = true;
                            }
                        }
                    }
                } catch (e) { console.warn(`Fugle API 連線失敗 (${sym})`); }
            }

            // 2. 【美股與匯率】單獨呼叫 Yahoo Quote (防止批次查詢被擋)
            if (!hasPrimaryQuote) {
                try {
                    const qRes = await fetch(`https://query2.finance.yahoo.com/v7/finance/quote?symbols=${sym}${crumb ? '&crumb='+crumb : ''}`, fetchOptions);
                    if (qRes.ok) {
                        const qData = await qRes.json();
                        if (qData.quoteResponse && qData.quoteResponse.result && qData.quoteResponse.result.length > 0) {
                            const q = qData.quoteResponse.result[0];
                            currentPrice = q.regularMarketPrice || 0;
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
                } catch (e) { console.warn(`Yahoo Quote 失敗 (${sym})`); }
            }

            // 3. 【歷史 K 線與圖表數據】計算 CAGR 與波動率
            try {
                const chartUrl = `https://query2.finance.yahoo.com/v8/finance/chart/${sym}?range=10y&interval=1d&events=div${crumb ? '&crumb='+crumb : ''}`;
                const chartRes = await fetch(chartUrl, fetchOptions);
                
                if (chartRes.ok) {
                    const chartData = await chartRes.json();
                    if (chartData.chart && chartData.chart.result && chartData.chart.result[0]) {
                        const result = chartData.chart.result[0];
                        
                        // 【極端防禦兜底】：只有在富果和 Yahoo Quote 都當機時才觸發
                        if (!hasPrimaryQuote) {
                            currentPrice = result.meta.regularMarketPrice || 0;
                            prevClose = result.meta.regularMarketPreviousClose || result.meta.previousClose || currentPrice;
                            change = currentPrice - prevClose;
                            changePercent = prevClose ? (change / prevClose) : 0;
                            stockName = result.meta.shortName || result.meta.longName || sym;
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
                            } catch (e) {}
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
                }
            } catch (err) {}

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

        // 加入 TWD=X 讓匯率也透過單獨的 Yahoo Quote 抓取
        const allRequests = ['TWD=X', ...symbols].map(sym => safeFetch(sym));
        const resList = await Promise.all(allRequests);

        let exchangeRate = 32.5; 
        let prevExchangeRate = 32.5;
        if (!resList[0].error && resList[0].data?.price) {
            exchangeRate = resList[0].data.price;
            prevExchangeRate = resList[0].data.price - resList[0].data.change; 
        }

        const stockData = {};
        for (let i = 1; i < resList.length; i++) { 
            if (!resList[i].error) stockData[symbols[i - 1]] = resList[i].data; 
        }

        res.status(200).json({ status: 'success', exchangeRate, prevExchangeRate, data: stockData });

    } catch (error) { 
        res.status(500).json({ status: 'error', error: 'Internal Server Error' }); 
    }
}

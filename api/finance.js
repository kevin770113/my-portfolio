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

        const chartUrl = (sym) => `https://query2.finance.yahoo.com/v8/finance/chart/${sym}?range=10y&interval=1d&events=div${crumb ? '&crumb='+crumb : ''}`;
        const quoteUrl = (sym) => `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${sym}${crumb ? '&crumb='+crumb : ''}`;

        const safeFetch = async (sym) => {
            let currentPrice = 0; let prevClose = 0; let stockName = sym;
            let cagr = 0; let stdev = 0; let historyYears = 0;
            let dividendYield = 0; let ytd = 0; 
            let change = 0; let changePercent = 0;
            let historicalDividends = []; 
            let monthlyReturns = {}; 

            try {
                const chartRes = await fetch(chartUrl(sym), fetchOptions);
                if (chartRes.ok) {
                    const data = await chartRes.json();
                    if (data.chart && data.chart.result && data.chart.result[0]) {
                        const result = data.chart.result[0];
                        const meta = result.meta;
                        const timestamps = result.timestamp || [];
                        
                        const adjPrices = result.indicators.adjclose?.[0]?.adjclose || result.indicators.quote[0].close || [];
                        const rawCloses = result.indicators.quote[0].close || [];

                        currentPrice = meta.regularMarketPrice || 0;
                        stockName = meta.shortName || meta.longName || sym;

                        // ⭐️ 雙重官方欄位防護
                        prevClose = meta.previousClose || meta.chartPreviousClose;

                        // 備用陣列推算機制
                        if (!prevClose || prevClose === 0) {
                            const validRawCloses = rawCloses.filter(p => p !== null && p > 0);
                            if (validRawCloses.length > 1) {
                                if (currentPrice !== validRawCloses[validRawCloses.length - 1]) {
                                    prevClose = validRawCloses[validRawCloses.length - 1];
                                } else {
                                    prevClose = validRawCloses[validRawCloses.length - 2];
                                }
                            } else {
                                // ⭐️ 【關鍵防呆】若歷史 K 線不足，強制讓昨收等於現價，阻絕 100% 暴漲假象
                                prevClose = currentPrice;
                            }
                        }

                        const history = [];
                        for (let k = 0; k < timestamps.length; k++) {
                            if (adjPrices[k] !== null && adjPrices[k] > 0) history.push({ time: timestamps[k], price: adjPrices[k] });
                        }

                        if (history.length > 0) {
                            const cleanPrices = history.map(h => h.price);
                            
                            const currentYear = new Date().getFullYear();
                            let lastYearEndPrice = null;
                            for (let j = history.length - 1; j >= 0; j--) {
                                if (new Date(history[j].time * 1000).getFullYear() < currentYear) {
                                    lastYearEndPrice = history[j].price; break;
                                }
                            }
                            ytd = lastYearEndPrice ? (currentPrice - lastYearEndPrice) / lastYearEndPrice : (currentPrice - cleanPrices[0]) / cleanPrices[0];

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
                            } catch (mathErr) {
                                console.warn(`計算 ${sym} 月報酬率時發生錯誤:`, mathErr.message);
                            }
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
                        dividendYield = currentPrice ? (trailingDiv / currentPrice) : 0;
                    }
                } else {
                    const quoteRes = await fetch(quoteUrl(sym), fetchOptions);
                    if (quoteRes.ok) {
                        const quoteData = await quoteRes.json();
                        if (quoteData.quoteResponse && quoteData.quoteResponse.result && quoteData.quoteResponse.result.length > 0) {
                            const q = quoteData.quoteResponse.result[0];
                            currentPrice = q.regularMarketPrice || 0;
                            prevClose = q.regularMarketPreviousClose || currentPrice; // ⭐️ 備用 API 也加上防呆
                            stockName = q.shortName || q.longName || sym;
                            dividendYield = (q.trailingAnnualDividendYield / 100) || 0;
                            ytd = q.ytdReturn ? (q.ytdReturn / 100) : 0;
                        } else { return { symbol: sym, error: true, message: '查無代號' }; }
                    } else { return { symbol: sym, error: true, message: '被擋' }; }
                }

                if (currentPrice === 0) return { symbol: sym, error: true, message: '無效報價' };

                change = prevClose ? (currentPrice - prevClose) : 0;
                changePercent = prevClose ? (change / prevClose) : 0;

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

            } catch (err) { return { symbol: sym, error: true, message: '異常' }; }
        };

        const allRequests = ['TWD=X', ...symbols].map(sym => safeFetch(sym));
        const results = await Promise.all(allRequests);

        let exchangeRate = 32.5; 
        let prevExchangeRate = 32.5;
        if (!results[0].error && results[0].data?.price) {
            exchangeRate = results[0].data.price;
            prevExchangeRate = results[0].data.price - results[0].data.change; 
        }

        const stockData = {};
        for (let i = 1; i < results.length; i++) { if (!results[i].error) stockData[results[i].symbol] = results[i].data; }

        res.status(200).json({ status: 'success', exchangeRate: exchangeRate, prevExchangeRate: prevExchangeRate, data: stockData });

    } catch (error) { 
        res.status(500).json({ status: 'error', error: 'Internal Server Error' }); 
    }
}

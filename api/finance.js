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

    // 🔒 從 Vercel 環境變數安全讀取，不寫死金鑰
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
        } catch (e) { console.warn("Yahoo Crumb 取用失敗:", e.message); }

        const fetchOptions = { headers: { 'User-Agent': userAgent, 'Accept': 'application/json', ...(cookie ? { 'Cookie': cookie } : {}) } };

        // 預先為 Yahoo Finance 準備批次 Quote 請求 (主要處理美股與匯率)
        const allSymbols = ['TWD=X', ...symbols];
        let yahooQuoteMap = {};
        try {
            const quoteUrlBatch = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${allSymbols.join(',')}${crumb ? '&crumb='+crumb : ''}`;
            const quoteRes = await fetch(quoteUrlBatch, fetchOptions);
            if (quoteRes.ok) {
                const quoteJson = await quoteRes.json();
                if (quoteJson.quoteResponse && quoteJson.quoteResponse.result) {
                    quoteJson.quoteResponse.result.forEach(q => { yahooQuoteMap[q.symbol] = q; });
                }
            }
        } catch(e) { console.warn('Yahoo Batch quote fetch failed', e); }

        const chartUrl = (sym) => `https://query2.finance.yahoo.com/v8/finance/chart/${sym}?range=10y&interval=1d&events=div${crumb ? '&crumb='+crumb : ''}`;

        const safeFetch = async (sym) => {
            let currentPrice = 0; let prevClose = 0; let stockName = sym;
            let cagr = 0; let stdev = 0; let historyYears = 0;
            let dividendYield = 0; let ytd = 0; 
            let change = 0; let changePercent = 0;
            let historicalDividends = []; 
            let monthlyReturns = {}; 

            const isTW = sym.endsWith('.TW') || sym.endsWith('.TWO');
            let hasPrimaryQuote = false;

            // 1. 【台股專屬】優先呼叫 Fugle API 取得精準報價
            if (isTW && FUGLE_API_KEY) {
                const cleanSym = sym.replace('.TW', '').replace('.TWO', '');
                try {
                    const fugleRes = await fetch(`https://api.fugle.tw/marketdata/v1.0/stock/intraday/quote/${cleanSym}`, {
                        headers: { 'X-API-KEY': FUGLE_API_KEY }
                    });
                    if (fugleRes.ok) {
                        const fugleData = await fugleRes.json();
                        if (fugleData && fugleData.data) {
                            const q = fugleData.data;
                            // 優先取昨收與漲跌，確保損益計算與券商一致
                            currentPrice = q.closePrice || q.lastPrice || (q.lastTrade && q.lastTrade.price) || q.referencePrice || 0;
                            change = q.change !== undefined ? q.change : 0;
                            changePercent = q.changePercent !== undefined ? (q.changePercent / 100) : 0;
                            stockName = q.name || sym;
                            prevClose = q.referencePrice || (currentPrice - change);
                            hasPrimaryQuote = true;
                        }
                    }
                } catch (e) { console.warn(`Fugle API 失敗 (${sym}), 回退至 Yahoo:`, e.message); }
            }

            // 2. 【美股/備用】使用 Yahoo Finance 報價
            if (!hasPrimaryQuote) {
                const q = yahooQuoteMap[sym];
                if (q) {
                    currentPrice = q.regularMarketPrice || 0;
                    prevClose = q.regularMarketPreviousClose || currentPrice;
                    stockName = q.shortName || q.longName || sym;
                    change = q.regularMarketChange || 0; 
                    changePercent = (q.regularMarketChangePercent / 100) || 0;
                    dividendYield = (q.trailingAnnualDividendYield / 100) || 0;
                    ytd = q.ytdReturn ? (q.ytdReturn / 100) : 0;
                    hasPrimaryQuote = true;
                }
            }

            // 3. 【長線量化】統一使用 Yahoo Chart API 抓取歷史 K 線
            try {
                const chartRes = await fetch(chartUrl(sym), fetchOptions);
                if (chartRes.ok) {
                    const data = await chartRes.json();
                    if (data.chart && data.chart.result && data.chart.result[0]) {
                        const result = data.chart.result[0];
                        const timestamps = result.timestamp || [];
                        const adjPrices = result.indicators.adjclose?.[0]?.adjclose || result.indicators.quote[0].close || [];
                        
                        // 若雙重報價都失敗，才從 Chart Meta 提取
                        if (currentPrice === 0) {
                            currentPrice = result.meta.regularMarketPrice || 0;
                            stockName = result.meta.shortName || result.meta.longName || sym;
                            prevClose = result.meta.previousClose || result.meta.regularMarketPreviousClose || currentPrice;
                            change = currentPrice - prevClose;
                        }

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
                                ytd = lastYearEndPrice ? (currentPrice - lastYearEndPrice) / lastYearEndPrice : (currentPrice - cleanPrices[0]) / cleanPrices[0];
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

                        // 處理配息紀錄
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

            } catch (err) { return { symbol: sym, error: true, message: '異常' }; }
        };

        const results = await Promise.all(symbols.map(sym => safeFetch(sym)));
        
        // 匯率計算
        let exchangeRate = 32.5; 
        let prevExchangeRate = 32.5;
        const twdQuote = yahooQuoteMap['TWD=X'];
        if (twdQuote && twdQuote.regularMarketPrice) {
            exchangeRate = twdQuote.regularMarketPrice;
            prevExchangeRate = twdQuote.regularMarketPrice - (twdQuote.regularMarketChange || 0);
        }

        const stockData = {};
        for (let i = 0; i < results.length; i++) { if (!results[i].error) stockData[symbols[i]] = results[i].data; }

        res.status(200).json({ status: 'success', exchangeRate, prevExchangeRate, data: stockData });

    } catch (error) { 
        res.status(500).json({ status: 'error', error: 'Internal Server Error' }); 
    }
}

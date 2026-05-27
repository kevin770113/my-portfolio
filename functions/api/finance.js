const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,OPTIONS,POST',
    'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequest(context) {
    const { request, env } = context;

    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
    if (request.method !== 'POST') return Response.json({ status: 'error', error: 'Method Not Allowed' }, { status: 405, headers: corsHeaders });

    try {
        const body = await request.json();
        const symbols = body.symbols;
        
        if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
            return Response.json({ status: 'error', error: '請提供有效的 symbols 陣列' }, { status: 400, headers: corsHeaders });
        }

        const FUGLE_API_KEY = env.FUGLE_API_KEY; // 從 Cloudflare 環境變數讀取
        const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
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
            let change = 0, changePercent = 0, historicalDividends = [], monthlyReturns = {};

            const isTW = sym.endsWith('.TW') || sym.endsWith('.TWO');
            let hasPrimaryQuote = false;

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

            if (!hasPrimaryQuote) {
                try {
                    const qRes = await fetch(`https://query2.finance.yahoo.com/v7/finance/quote?symbols=${sym}${crumb ? '&crumb='+crumb : ''}`, fetchOptions);
                    if (qRes.ok) {
                        const qData = await qRes.json();
                        if (qData.quoteResponse && qData.quoteResponse.result && qData.quoteResponse.result.length > 0) {
                            const q = qData.quoteResponse.result[0];
                            currentPrice = q.regularMarketPrice || 0;
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

            try {
                const chartRes = await fetch(`https://query2.finance.yahoo.com/v8/finance/chart/${sym}?range=10y&interval=1d&events=div${crumb ? '&crumb='+crumb : ''}`, fetchOptions);
                if (chartRes.ok) {
                    const chartData = await chartRes.json();
                    if (chartData.chart && chartData.chart.result && chartData.chart.result[0]) {
                        const result = chartData.chart.result[0];
                        
                        if (!hasPrimaryQuote) {
                            currentPrice = result.meta.regularMarketPrice || 0;
                            dataTime = result.meta.regularMarketTime || 0;
                            stockName = result.meta.shortName || result.meta.longName || sym;
                        }

                        const timestamps = result.timestamp || [];
                        const adjPrices = result.indicators.adjclose?.[0]?.adjclose || result.indicators.quote[0].close || [];
                        const history = [];
                        for (let k = 0; k < timestamps.length; k++) {
                            if (adjPrices[k] > 0) history.push({ time: timestamps[k], price: adjPrices[k] });
                        }

                        if (history.length > 0) {
                            const validPrices = history.map(h => h.price);

                            if (!hasPrimaryQuote && validPrices.length >= 2) {
                                const lastK = validPrices[validPrices.length - 1];
                                const prevK = validPrices[validPrices.length - 2];
                                prevClose = Math.abs(currentPrice - lastK) < 0.001 ? prevK : lastK;
                                change = currentPrice - prevClose;
                                changePercent = prevClose ? (change / prevClose) : 0;
                            }

                            if (ytd === 0 && currentPrice > 0) {
                                const currentYear = new Date().getFullYear();
                                let lastYearEndPrice = null;
                                for (let j = history.length - 1; j >= 0; j--) {
                                    if (new Date(history[j].time * 1000).getFullYear() < currentYear) {
                                        lastYearEndPrice = history[j].price; break;
                                    }
                                }
                                if (!lastYearEndPrice && validPrices.length > 0) lastYearEndPrice = validPrices[0];
                                if (lastYearEndPrice && lastYearEndPrice > 0) ytd = (currentPrice - lastYearEndPrice) / lastYearEndPrice;
                            }

                            if (validPrices.length > 20) {
                                historyYears = Math.max(1, validPrices.length / 252);
                                cagr = Math.pow(validPrices[validPrices.length - 1] / validPrices[0], 1 / historyYears) - 1;
                                let returns = [];
                                for (let i = 1; i < validPrices.length; i++) returns.push((validPrices[i] - validPrices[i-1]) / validPrices[i-1]);
                                const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
                                stdev = Math.sqrt(returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length) * Math.sqrt(252);
                            }

                            try {
                                const monthEndPrices = {};
                                for (let h of history) {
                                    const date = new Date((h.time + 43200) * 1000);
                                    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
                                    monthEndPrices[key] = h.price;
                                }
                                
                                const rawMonths = Object.keys(monthEndPrices).sort();
                                if (rawMonths.length > 0) {
                                    let firstMonth = rawMonths[0];
                                    let lastMonth = rawMonths[rawMonths.length - 1];
                                    let [y, m] = firstMonth.split('-').map(Number);
                                    let [endY, endM] = lastMonth.split('-').map(Number);
                                    let lastKnownPrice = monthEndPrices[firstMonth];
                                    
                                    while (y < endY || (y === endY && m <= endM)) {
                                        let key = `${y}-${String(m).padStart(2, '0')}`;
                                        if (monthEndPrices[key] !== undefined) {
                                            lastKnownPrice = monthEndPrices[key];
                                        } else {
                                            monthEndPrices[key] = lastKnownPrice;
                                        }
                                        m++; if (m > 12) { m = 1; y++; }
                                    }
                                }

                                const filledMonths = Object.keys(monthEndPrices).sort();
                                for (let i = 1; i < filledMonths.length; i++) {
                                    const prevP = monthEndPrices[filledMonths[i - 1]];
                                    const currP = monthEndPrices[filledMonths[i]];
                                    if (prevP > 0 && currP !== undefined) monthlyReturns[filledMonths[i]] = (currP - prevP) / prevP;
                                }
                            } catch (e) {}
                        }

                        let trailingDiv = 0;
                        if (result.events && result.events.dividends) {
                            const oneYearAgo = (Date.now() / 1000) - 31536000;
                            Object.values(result.events.dividends).forEach(d => { 
                                if (d.date >= oneYearAgo) trailingDiv += d.amount; 
                                historicalDividends.push({ date: d.date, amount: d.amount }); 
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
                    regularMarketTime: dataTime,
                    historicalDividends: historicalDividends, 
                    monthlyReturns: monthlyReturns
                }
            };
        };

        const resList = await Promise.all(['TWD=X', ...symbols].map(sym => safeFetch(sym)));
        let exchangeRate = 32.5, prevExchangeRate = 32.5;
        if (!resList[0].error && resList[0].data?.price) {
            exchangeRate = resList[0].data.price;
            prevExchangeRate = resList[0].data.price - (resList[0].data.change || 0); 
        }

        const stockData = {};
        for (let i = 1; i < resList.length; i++) { 
            if (!resList[i].error) stockData[symbols[i - 1]] = resList[i].data; 
        }

        return Response.json({ status: 'success', exchangeRate, prevExchangeRate, data: stockData }, { headers: corsHeaders });
    } catch (error) { 
        return Response.json({ status: 'error', error: 'Internal Error' }, { status: 500, headers: corsHeaders }); 
    }
}

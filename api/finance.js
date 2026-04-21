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
                            if (fJson.data.info?.lastUpdatedAt) dataTime = Math.floor(new Date(fJson.data.info.lastUpdatedAt).getTime() / 1000);
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
                        if (qData.quoteResponse?.result?.[0]) {
                            const q = qData.quoteResponse.result[0];
                            currentPrice = q.regularMarketPrice || 0;
                            dataTime = q.regularMarketTime || 0;
                            change = q.regularMarketChange || 0;
                            changePercent = (q.regularMarketChangePercent / 100) || 0;
                            prevClose = q.regularMarketPreviousClose || currentPrice;
                            stockName = q.shortName || q.longName || sym;
                            dividendYield = (q.trailingAnnualDividendYield / 100) || 0;
                            ytd = (q.ytdReturn / 100) || 0;
                            hasPrimaryQuote = true;
                        }
                    }
                } catch (e) {}
            }

            try {
                const chartRes = await fetch(`https://query2.finance.yahoo.com/v8/finance/chart/${sym}?range=10y&interval=1d&events=div${crumb ? '&crumb='+crumb : ''}`, fetchOptions);
                if (chartRes.ok) {
                    const chartData = await chartRes.json();
                    if (chartData.chart?.result?.[0]) {
                        const result = chartData.chart.result[0];
                        if (!hasPrimaryQuote) {
                            currentPrice = result.meta.regularMarketPrice || 0;
                            prevClose = result.meta.regularMarketPreviousClose || result.meta.previousClose || currentPrice;
                            change = currentPrice - prevClose;
                            changePercent = prevClose ? change / prevClose : 0;
                        }
                        const adjPrices = (result.indicators.adjclose?.[0]?.adjclose || result.indicators.quote[0].close || []).filter(p => p > 0);
                        if (validPrices = adjPrices, validPrices.length > 20) {
                            historyYears = validPrices.length / 252;
                            cagr = Math.pow(validPrices[validPrices.length - 1] / validPrices[0], 1 / historyYears) - 1;
                            let returns = [];
                            for (let i = 1; i < validPrices.length; i++) returns.push((validPrices[i] - validPrices[i-1]) / validPrices[i-1]);
                            const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
                            stdev = Math.sqrt(returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length) * Math.sqrt(252);
                        }
                    }
                }
            } catch (err) {}

            return { symbol: sym, error: currentPrice === 0, data: { yahooName: stockName, price: currentPrice, change, changePercent, ytd, cagr, stdev, dividendYield, regularMarketTime: dataTime } };
        };

        const resList = await Promise.all(['TWD=X', ...symbols].map(sym => safeFetch(sym)));
        let exRate = resList[0].data.price || 32.5;
        let prevExRate = exRate - (resList[0].data.change || 0);
        const stockData = {};
        for (let i = 1; i < resList.length; i++) { if (!resList[i].error) stockData[symbols[i-1]] = resList[i].data; }
        res.status(200).json({ status: 'success', exchangeRate: exRate, prevExchangeRate: prevExRate, data: stockData });
    } catch (error) { res.status(500).json({ status: 'error' }); }
}

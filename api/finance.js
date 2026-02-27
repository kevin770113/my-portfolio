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
        return res.status(405).json({ status: 'error', error: 'Method Not Allowed' });
    }

    const { symbols } = req.body;

    if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
        return res.status(400).json({ status: 'error', error: '請提供有效的 symbols 陣列' });
    }

    try {
        const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
        
        // ==========================================
        // 破甲系統：自動取得 Yahoo Cookie 與 Crumb
        // ==========================================
        let cookie = '';
        let crumb = '';

        try {
            // 步驟一：去 Yahoo 首頁拿 Cookie
            const cookieRes = await fetch('https://fc.yahoo.com', {
                headers: { 'User-Agent': userAgent }
            });
            const setCookieHeader = cookieRes.headers.get('set-cookie');
            if (setCookieHeader) {
                cookie = setCookieHeader.split(';')[0]; // 取出第一段 A3 cookie
            }

            // 步驟二：用 Cookie 去換取 Crumb 密碼
            if (cookie) {
                const crumbRes = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
                    headers: { 'Cookie': cookie, 'User-Agent': userAgent }
                });
                const crumbText = await crumbRes.text();
                if (crumbText && !crumbText.includes('html')) {
                    crumb = crumbText;
                }
            }
        } catch (e) {
            console.warn("[警告] 無法取得 Crumb/Cookie，將嘗試無密碼強行突破:", e.message);
        }

        // 組合帶有通行證的 Header 與 URL (切換至 query2)
        const fetchOptions = {
            headers: { 
                'User-Agent': userAgent,
                'Accept': 'application/json',
                ...(cookie ? { 'Cookie': cookie } : {})
            }
        };

        const chartUrl = (sym) => {
            let url = `https://query2.finance.yahoo.com/v8/finance/chart/${sym}?range=10y&interval=1d&events=div`;
            if (crumb) url += `&crumb=${crumb}`;
            return url;
        };

        const quoteUrl = (sym) => {
            let url = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${sym}`;
            if (crumb) url += `&crumb=${crumb}`;
            return url;
        };

        // ==========================================
        // 核心抓取邏輯 (獨立防護)
        // ==========================================
        const safeFetch = async (sym) => {
            let currentPrice = 0; let prevClose = 0; let stockName = sym;
            let cagr = 0; let stdev = 0; let historyYears = 0;
            let dividendYield = 0; let ytd = 0; 
            let change = 0; let changePercent = 0;

            try {
                // 優先嘗試：歷史資料 API (v8)
                const chartRes = await fetch(chartUrl(sym), fetchOptions);
                
                if (chartRes.ok) {
                    const data = await chartRes.json();
                    if (data.chart && data.chart.result && data.chart.result[0]) {
                        const result = data.chart.result[0];
                        const meta = result.meta;
                        const timestamps = result.timestamp || [];
                        const rawPrices = result.indicators.adjclose?.[0]?.adjclose || result.indicators.quote[0].close || [];

                        currentPrice = meta.regularMarketPrice || 0;
                        prevClose = meta.chartPreviousClose || meta.previousClose || 0;
                        stockName = meta.shortName || meta.longName || sym;

                        const history = [];
                        for (let k = 0; k < timestamps.length; k++) {
                            if (rawPrices[k] !== null && rawPrices[k] > 0) {
                                history.push({ time: timestamps[k], price: rawPrices[k] });
                            }
                        }

                        if (history.length > 0) {
                            const cleanPrices = history.map(h => h.price);
                            if (!prevClose && cleanPrices.length > 1) prevClose = cleanPrices[cleanPrices.length - 2];

                            // YTD 計算
                            const currentYear = new Date().getFullYear();
                            let lastYearEndPrice = null;
                            for (let j = history.length - 1; j >= 0; j--) {
                                const date = new Date(history[j].time * 1000);
                                if (date.getFullYear() < currentYear) {
                                    lastYearEndPrice = history[j].price;
                                    break;
                                }
                            }
                            if (lastYearEndPrice) {
                                ytd = (currentPrice - lastYearEndPrice) / lastYearEndPrice;
                            } else {
                                ytd = (currentPrice - cleanPrices[0]) / cleanPrices[0];
                            }

                            // CAGR 計算
                            if (cleanPrices.length > 20) {
                                const firstPrice = cleanPrices[0];
                                const lastPrice = cleanPrices[cleanPrices.length - 1];
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
                        }

                        // 殖利率計算
                        let trailingDiv = 0;
                        if (result.events && result.events.dividends) {
                            const now = Date.now() / 1000;
                            const oneYearAgo = now - 31536000;
                            Object.values(result.events.dividends).forEach(d => {
                                if (d.date >= oneYearAgo) trailingDiv += d.amount;
                            });
                        }
                        dividendYield = currentPrice ? (trailingDiv / currentPrice) : 0;
                    }
                } else {
                    // 【備援路線】歷史 API 被擋，改用即時報價 API (v7)
                    console.warn(`[備援] ${sym} 歷史資料遭拒，改抓即時報價...`);
                    const quoteRes = await fetch(quoteUrl(sym), fetchOptions);
                    
                    if (quoteRes.ok) {
                        const quoteData = await quoteRes.json();
                        if (quoteData.quoteResponse && quoteData.quoteResponse.result && quoteData.quoteResponse.result.length > 0) {
                            const q = quoteData.quoteResponse.result[0];
                            currentPrice = q.regularMarketPrice || 0;
                            prevClose = q.regularMarketPreviousClose || 0;
                            stockName = q.shortName || q.longName || sym;
                            dividendYield = (q.trailingAnnualDividendYield / 100) || 0;
                            ytd = q.ytdReturn ? (q.ytdReturn / 100) : 0;
                        } else {
                            return { symbol: sym, error: true, message: '查無此代號' };
                        }
                    } else {
                        return { symbol: sym, error: true, message: 'Yahoo 防護阻擋，請稍後再試' };
                    }
                }

                if (currentPrice === 0) return { symbol: sym, error: true, message: '無法取得有效報價' };

                change = prevClose ? (currentPrice - prevClose) : 0;
                changePercent = prevClose ? (change / prevClose) : 0;

                return {
                    symbol: sym, error: false,
                    data: {
                        yahooName: stockName, price: currentPrice, change: change,
                        changePercent: changePercent, ytd: ytd, cagr: cagr,
                        stdev: stdev, historyYears: historyYears, dividendYield: dividendYield
                    }
                };

            } catch (err) {
                console.warn(`[錯誤] 取得 ${sym} 異常:`, err.message);
                return { symbol: sym, error: true, message: '連線異常' };
            }
        };

        // 平行發送所有請求
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
            if (!res.error) stockData[res.symbol] = res.data;
        }

        res.status(200).json({ status: 'success', exchangeRate: exchangeRate, data: stockData });

    } catch (error) {
        console.error('API 嚴重錯誤:', error);
        res.status(500).json({ status: 'error', error: 'Internal Server Error' });
    }
}

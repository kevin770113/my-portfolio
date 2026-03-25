export default async function handler(req, res) {
    // 1. 設定 CORS 標頭，允許前端跨網域呼叫
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    // 處理 OPTIONS 預檢請求
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    const { symbol } = req.query;

    if (!symbol) {
        return res.status(400).json({ error: 'Missing symbol parameter' });
    }

    try {
        const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
        let cookie = ''; 
        let crumb = '';

        // 嘗試取得 Yahoo Crumb (防擋機制)
        try {
            const cookieRes = await fetch('https://fc.yahoo.com', { headers: { 'User-Agent': userAgent } });
            const setCookieHeader = cookieRes.headers.get('set-cookie');
            if (setCookieHeader) cookie = setCookieHeader.split(';')[0]; 
            if (cookie) {
                const crumbRes = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', { headers: { 'Cookie': cookie, 'User-Agent': userAgent } });
                const crumbText = await crumbRes.text();
                if (crumbText && !crumbText.includes('html')) crumb = crumbText;
            }
        } catch (e) { 
            console.warn("Crumb 取用失敗:", e.message); 
        }

        const fetchOptions = { 
            headers: { 'User-Agent': userAgent, 'Accept': 'application/json', ...(cookie ? { 'Cookie': cookie } : {}) } 
        };
        
        // 抓取過去 1 年的日線資料 (足以計算 240MA)
        const chartUrl = `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?range=1y&interval=1d${crumb ? '&crumb='+crumb : ''}`;

        const chartRes = await fetch(chartUrl, fetchOptions);
        if (!chartRes.ok) {
            throw new Error(`Yahoo API returned status ${chartRes.status}`);
        }

        const data = await chartRes.json();
        if (!data.chart || !data.chart.result || !data.chart.result[0]) {
            throw new Error('Invalid data format from Yahoo API');
        }

        const result = data.chart.result[0];
        const timestamps = result.timestamp || [];
        const quote = result.indicators.quote[0] || {};
        
        const opens = quote.open || [];
        const highs = quote.high || [];
        const lows = quote.low || [];
        const closes = quote.close || [];
        const volumes = quote.volume || [];

        let formattedData = [];
        for (let i = 0; i < timestamps.length; i++) {
            if (closes[i] !== null && closes[i] > 0) {
                formattedData.push({
                    date: new Date(timestamps[i] * 1000).toISOString(),
                    open: opens[i],
                    high: highs[i],
                    low: lows[i],
                    close: closes[i],
                    volume: volumes[i]
                });
            }
        }

        // 回傳最近 250 天的資料以節省頻寬
        const recentData = formattedData.slice(-250);
        res.status(200).json({ data: recentData });

    } catch (error) {
        console.error(`Error fetching historical data for ${symbol}:`, error);
        res.status(500).json({ error: 'Failed to fetch historical data', details: error.message });
    }
}

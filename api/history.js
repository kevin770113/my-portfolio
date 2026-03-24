const yahooFinance = require('yahoo-finance2').default;

export default async function handler(req, res) {
    // ==========================================
    // 1. 設定 CORS 標頭，允許前端跨網域呼叫
    // ==========================================
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
        // ==========================================
        // 2. 設定時間區間 (確保取得足夠的交易日算 240MA)
        // ==========================================
        const period2 = new Date(); // 今天
        const period1 = new Date();
        period1.setMonth(period1.getMonth() - 14); // 往前推 14 個月 (確保扣掉假日後仍有 > 250 天)

        const queryOptions = {
            period1: period1.toISOString().split('T')[0],
            period2: period2.toISOString().split('T')[0],
            interval: '1d', // 日線
        };

        // ==========================================
        // 3. 呼叫 yahoo-finance2 取得歷史資料
        // ==========================================
        const result = await yahooFinance.historical(symbol, queryOptions);

        // ==========================================
        // 4. 資料清洗與格式化
        // ==========================================
        const formattedData = result.map(item => ({
            date: item.date,
            close: item.close,
            high: item.high,
            low: item.low,
            volume: item.volume
        }));

        // 為了節省頻寬與提升前端運算速度，我們只保留最新剛好 250 天的資料回傳
        // 若上市未滿 250 天的新股，則回傳全部
        const recentData = formattedData.slice(-250);

        res.status(200).json({ data: recentData });

    } catch (error) {
        console.error(`Error fetching historical data for ${symbol}:`, error);
        res.status(500).json({ error: 'Failed to fetch historical data', details: error.message });
    }
}

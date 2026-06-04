const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequest(context) {
    const { request } = context;
    const url = new URL(request.url);
    
    // 處理 CORS 預檢請求
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
    if (request.method !== 'GET') return Response.json({ status: 'error', message: 'Method Not Allowed' }, { status: 405, headers: corsHeaders });

    // 取得查詢參數 ?q=關鍵字
    const keyword = url.searchParams.get('q');
    if (!keyword) {
        return Response.json({ status: 'error', message: '缺少關鍵字' }, { status: 400, headers: corsHeaders });
    }

    try {
        const searchUrl = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(keyword)}&quotesCount=8&newsCount=0`;
        
        const response = await fetch(searchUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        if (!response.ok) {
            throw new Error('Yahoo Search API 請求失敗');
        }

        const data = await response.json();
        
        // 若查無結果，回傳 empty 狀態
        if (!data.quotes || data.quotes.length === 0) {
            return Response.json({ status: 'empty', data: [] }, { headers: corsHeaders });
        }

        // 過濾並正規化輸出格式
        const validQuotes = data.quotes.filter(q => 
            q.quoteType === 'EQUITY' || q.quoteType === 'ETF'
        ).map(q => {
            let market = 'UNKNOWN';
            // 精準判斷所屬市場
            if (q.exchange === 'TAI' || q.exchange === 'TWO' || q.symbol.endsWith('.TW') || q.symbol.endsWith('.TWO')) {
                market = 'TW';
            } else if (['NYQ', 'NMS', 'NGM', 'NCM', 'PCX', 'BATS', 'ASE'].includes(q.exchange) || !q.symbol.includes('.')) {
                market = 'US'; 
            }

            return {
                symbol: q.symbol,
                name: q.longname || q.shortname || q.symbol,
                exchange: q.exchDisp || q.exchange,
                market: market,
                type: q.quoteType
            };
        });

        return Response.json({ status: 'success', data: validQuotes }, { headers: corsHeaders });

    } catch (error) {
        console.error('Search API Error:', error);
        return Response.json({ status: 'error', message: '搜尋服務異常' }, { status: 500, headers: corsHeaders });
    }
}

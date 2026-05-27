const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequest(context) {
    const { request } = context;

    if (request.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
    }

    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get('symbol');

    if (!symbol) {
        return Response.json({ error: 'Missing symbol parameter' }, { status: 400, headers: corsHeaders });
    }

    try {
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
        const chartUrl = `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?range=1y&interval=1d${crumb ? '&crumb='+crumb : ''}`;

        const chartRes = await fetch(chartUrl, fetchOptions);
        if (!chartRes.ok) throw new Error(`Yahoo API returned status ${chartRes.status}`);

        const data = await chartRes.json();
        if (!data.chart || !data.chart.result || !data.chart.result[0]) throw new Error('Invalid data format');

        const result = data.chart.result[0];
        const timestamps = result.timestamp || [];
        const quote = result.indicators.quote[0] || {};
        
        const opens = quote.open || []; const highs = quote.high || [];
        const lows = quote.low || []; const closes = quote.close || [];
        const volumes = quote.volume || [];

        let formattedData = [];
        for (let i = 0; i < timestamps.length; i++) {
            if (closes[i] !== null && closes[i] > 0) {
                formattedData.push({
                    date: new Date(timestamps[i] * 1000).toISOString(),
                    open: opens[i], high: highs[i], low: lows[i], close: closes[i], volume: volumes[i]
                });
            }
        }

        const recentData = formattedData.slice(-250);
        return Response.json({ data: recentData }, { headers: corsHeaders });

    } catch (error) {
        return Response.json({ error: 'Failed to fetch historical data', details: error.message }, { status: 500, headers: corsHeaders });
    }
}

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,OPTIONS,POST',
    'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequest(context) {
    const { request, env } = context;

    if (request.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
    }
    if (request.method !== 'POST') {
        return Response.json({ error: 'Method Not Allowed' }, { status: 405, headers: corsHeaders });
    }

    try {
        const body = await request.json();

        // 【功能 A：寫入/更新字典】
        if (body.update) {
            const { name, symbol } = body.update;
            if (!name || !symbol) return Response.json({ error: '資料不完整' }, { status: 400, headers: corsHeaders });
            
            await env.KV_DB.put(name, symbol);
            return Response.json({ status: 'success', saved: { name, symbol } }, { headers: corsHeaders });
        }

        // 【功能 B：批次查詢字典】
        if (body.names && Array.isArray(body.names)) {
            if (body.names.length === 0) return Response.json({}, { headers: corsHeaders });

            const result = {};
            // Cloudflare KV 需要使用 Promise.all 平行查詢
            const promises = body.names.map(async (name) => {
                const val = await env.KV_DB.get(name);
                result[name] = val;
            });
            await Promise.all(promises);
            
            return Response.json(result, { headers: corsHeaders });
        }
        return Response.json({ error: '無效的請求格式' }, { status: 400, headers: corsHeaders });
    } catch (error) {
        return Response.json({ error: 'Database Error', details: error.message }, { status: 500, headers: corsHeaders });
    }
}

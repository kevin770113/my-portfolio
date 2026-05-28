const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequest(context) {
    const { request, env } = context;

    // 處理 CORS 跨域請求
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
    if (request.method !== 'POST') return Response.json({ error: 'Method Not Allowed' }, { status: 405, headers: corsHeaders });

    try {
        const body = await request.json();
        const csvChunk = body.csvChunk;
        
        if (!csvChunk) {
            return Response.json({ error: 'Missing csvChunk' }, { status: 400, headers: corsHeaders });
        }

        // 🛡️ 防護機制一：產生券商格式指紋 (取前 2 行作為特徵) 並查詢 KV 快取
        const lines = csvChunk.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        const featureText = lines.slice(0, 2).join('|');
        // 使用 Base64 安全編碼，作為 KV 資料庫的 Key
        const signature = 'parser_' + btoa(encodeURIComponent(featureText)).replace(/[^a-zA-Z0-9]/g, '').slice(0, 50);

        const cached = await env.KV_DB.get(signature, 'json');
        if (cached && cached.nameColumn && cached.sharesColumn) {
            // 如果快取命中，直接回傳，免去 AI 運算時間
            return Response.json({ status: 'success', source: 'KV_CACHE', data: cached }, { headers: corsHeaders });
        }

        // 🧠 大腦運算：呼叫 Cloudflare Workers AI (選用 Qwen 1.5 14B 中文特化模型)
        const prompt = `你是一個嚴格的資料解析系統。
以下是一份台灣券商匯出的 CSV 原始文字片段。開頭可能有空白行或帳戶雜訊。
請找出「真正的股票資料表頭」所在的那一行，並判斷哪一個欄位名稱代表「股票名稱/商品名稱」，哪一個欄位代表「庫存股數/股數/數量/庫存」。

【CSV 片段開始】
${csvChunk}
【CSV 片段結束】

請你「只」回傳一個 JSON 物件，絕對不要包含任何其他文字或 Markdown 標籤。
JSON 格式必須為：
{"nameColumn": "找到的股票名稱欄位", "sharesColumn": "找到的股數欄位"}

如果完全找不到，請回傳：
{"nameColumn": null, "sharesColumn": null}
`;

        const aiResponse = await env.AI.run('@cf/qwen/qwen1.5-14b-chat-awq', {
            messages: [
                { role: 'system', content: 'You are a data parser that outputs ONLY valid JSON.' },
                { role: 'user', content: prompt }
            ]
        });

        // 🛡️ 防護機制二：處理 AI 回傳結果 (防幻覺與過濾 Markdown 符號)
        let aiText = aiResponse.response || '';
        let parsedData = null;

        const jsonMatch = aiText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try {
                parsedData = JSON.parse(jsonMatch[0]);
            } catch (e) {
                console.error("JSON 解析失敗:", aiText);
            }
        }

        // 🛡️ 防護機制三：嚴格驗證解析結果，失敗則拋出特定錯誤碼
        if (!parsedData || !parsedData.nameColumn || !parsedData.sharesColumn) {
            return Response.json({ error: 'LLM_PARSE_FAILED', details: aiText }, { status: 500, headers: corsHeaders });
        }

        // 寫入 KV 快取，造福下次匯入
        await env.KV_DB.put(signature, JSON.stringify(parsedData));

        return Response.json({ status: 'success', source: 'AI_PARSED', data: parsedData }, { headers: corsHeaders });

    } catch (error) {
        return Response.json({ error: 'API_ERROR', details: error.message }, { status: 500, headers: corsHeaders });
    }
}

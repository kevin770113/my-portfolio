export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        const body = await request.json();
        const csvChunk = body.csvChunk;

        if (!csvChunk) {
            return new Response(JSON.stringify({ status: 'error', message: '未提供 CSV 內容 (Missing csvChunk)' }), { status: 400 });
        }

        // 確保環境變數中已經綁定了 AI 服務 (在 wrangler.toml 或 Cloudflare Dashboard 中設定)
        if (!env.AI) {
            throw new Error("Cloudflare AI 尚未綁定 (Missing env.AI)");
        }

        // 系統提示詞：強制 AI 扮演無情的 JSON 解析器
        const systemPrompt = `You are a strict financial data parser. Analyze the provided CSV header and sample data from a Taiwanese stock broker.
Your task is to identify the exact column name that represents the 'Stock Name' (e.g., 商品名稱, 證券名稱, 股票名稱, 標的, Symbol) and the exact column name that represents the 'Shares or Inventory' (e.g., 股數, 庫存股數, 目前餘額, 數量, Shares).
You must return ONLY a raw JSON object with exactly two keys: "nameColumn" and "sharesColumn".
Do NOT wrap the response in markdown code blocks like \`\`\`json. Do NOT output any other text, greetings, or explanations.`;

        const userPrompt = `Here is the CSV snippet to analyze:\n\n${csvChunk}`;

        // 呼叫 Cloudflare Workers AI (使用 Llama-3-8B 輕量快速模型)
        const response = await env.AI.run('@cf/meta/llama-3-8b-instruct', {
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ]
        });

        // 處理 AI 回傳結果：清洗可能的 Markdown 標籤以防 JSON.parse 崩潰
        let rawText = response.response.trim();
        if (rawText.startsWith('```json')) {
            rawText = rawText.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
        } else if (rawText.startsWith('```')) {
            rawText = rawText.replace(/^```\n?/, '').replace(/\n?```$/, '').trim();
        }

        const parsedResult = JSON.parse(rawText);

        if (!parsedResult.nameColumn || !parsedResult.sharesColumn) {
            throw new Error("AI 未能成功解析出必填欄位。");
        }

        return new Response(JSON.stringify({
            status: 'success',
            source: 'Workers_AI_Llama3',
            data: {
                nameColumn: parsedResult.nameColumn,
                sharesColumn: parsedResult.sharesColumn
            }
        }), {
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (err) {
        console.error("[AI Parser Error]", err);
        return new Response(JSON.stringify({ 
            status: 'error', 
            message: err.message || 'AI 智慧解析失敗',
            fallback: true 
        }), { 
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

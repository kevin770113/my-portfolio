export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        const body = await request.json();
        
        // 確保環境變數中已經綁定了 AI 服務
        if (!env.AI) {
            throw new Error("Cloudflare AI 尚未綁定 (Missing env.AI)");
        }

        const {
            totalValueTWD = 0,
            dayChangeTWD = 0,
            dayChangePct = 0,
            ytdPct = 0,
            cagr = 0,
            stdev = 0,
            dividendYield = 0
        } = body;

        // 系統提示詞：強制扮演冷靜的量化分析師，且絕對禁止使用 Emoji，不包含問候語
        const systemPrompt = `You are a senior quantitative analyst providing a daily portfolio briefing in Traditional Chinese (Taiwan).
Your tone must be highly professional, objective, calm, and analytical.
CRITICAL RULES:
1. ABSOLUTELY NO EMOJIS. Do not generate any symbols like 📈, 💰, etc.
2. Keep the summary between 80 and 100 words.
3. Do not include time-based greetings (like 早安 or 午安), just start the analysis directly.
4. Focus on risk management, return metrics, and overall portfolio stability.`;

        const userPrompt = `請根據以下最新投資組合數據提供量化簡報：
- 總現值：${totalValueTWD.toLocaleString()} TWD
- 今日損益：${dayChangeTWD.toLocaleString()} TWD (${dayChangePct.toFixed(2)}%)
- YTD (今年累計績效)：${ytdPct.toFixed(2)}%
- CAGR (年化報酬)：${cagr.toFixed(2)}%
- 組合總風險 (標準差)：${stdev.toFixed(2)}%
- 預估殖利率：${dividendYield.toFixed(2)}%`;

        // 呼叫 Cloudflare Workers AI
        const response = await env.AI.run('@cf/meta/llama-3-8b-instruct', {
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            max_tokens: 250,
            temperature: 0.3 // 較低的溫度以確保專業冷靜的語氣
        });

        let summaryText = response.response.trim();
        // 移除可能意外生成的引號
        summaryText = summaryText.replace(/^["']|["']$/g, '');

        return new Response(JSON.stringify({
            status: 'success',
            data: { summary: summaryText }
        }), {
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (err) {
        console.error("[AI Summary Error]", err);
        return new Response(JSON.stringify({ 
            status: 'error', 
            message: err.message || 'AI 簡報生成失敗'
        }), { 
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

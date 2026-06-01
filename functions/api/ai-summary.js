export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        const body = await request.json();
        
        // 確保環境變數中已經綁定了 AI 服務
        if (!env.AI) {
            throw new Error("Cloudflare AI 尚未綁定 (Missing env.AI)");
        }

        // 接收前端已格式化（且可能包含 <up>/<down> 標籤）的字串
        const {
            totalValueTWD = "0",
            dayChangeTWD = "0",
            dayChangePct = "0",
            ytdPct = "0",
            cagr = "0",
            stdev = "0",
            dividendYield = "0"
        } = body;

        // 系統提示詞：強制保留標籤、嚴禁 Emoji、保持量化分析師語氣
        const systemPrompt = `You are a senior quantitative analyst providing a daily portfolio briefing in Traditional Chinese (Taiwan).
Your tone must be highly professional, objective, calm, and analytical.
CRITICAL RULES:
1. ABSOLUTELY NO EMOJIS. Do not generate any symbols like 📈, 💰, etc.
2. Keep the summary between 80 and 100 words.
3. Do not include time-based greetings (like 早安 or 午安), just start the analysis directly.
4. Focus on risk management, return metrics, and overall portfolio stability.
5. PRESERVE TAGS: The numerical inputs contain <up>...</up> and <down>...</down> HTML tags. You MUST keep these exact tags surrounding the numbers in your output. Do not remove, alter, or filter these tags.`;

        const userPrompt = `請根據以下最新投資組合數據提供量化簡報：
- 總現值：${totalValueTWD} TWD
- 今日損益：${dayChangeTWD} TWD (${dayChangePct}%)
- YTD (今年累計績效)：${ytdPct}%
- CAGR (年化報酬)：${cagr}%
- 組合總風險 (標準差)：${stdev}%
- 預估殖利率：${dividendYield}%`;

        // 呼叫 Cloudflare Workers AI
        const response = await env.AI.run('@cf/meta/llama-3-8b-instruct', {
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            max_tokens: 250,
            temperature: 0.3
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

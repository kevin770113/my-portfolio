import { kv } from '@vercel/kv';

export default async function handler(req, res) {
    // 1. 設定 CORS 標頭
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const body = req.body;

        // 【功能 A：寫入/更新字典】
        if (body.update) {
            const { name, symbol } = body.update;
            if (!name || !symbol) return res.status(400).json({ error: '資料不完整' });
            
            await kv.set(name, symbol);
            return res.status(200).json({ status: 'success', saved: { name, symbol } });
        }

        // 【功能 B：批次查詢字典】
        if (body.names && Array.isArray(body.names)) {
            if (body.names.length === 0) return res.status(200).json({});

            const values = await kv.mget(...body.names);
            
            const result = {};
            body.names.forEach((name, index) => {
                result[name] = values[index];
            });
            
            return res.status(200).json(result);
        }

        return res.status(400).json({ error: '無效的請求格式' });

    } catch (error) {
        console.error('KV Error:', error);
        return res.status(500).json({ error: 'Database Error', details: error.message });
    }
}

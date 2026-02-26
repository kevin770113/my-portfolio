export default function handler(req, res) {
    res.status(200).json({ 
        status: "success", 
        message: "恭喜！Vercel Serverless API 成功連線！" 
    });
}

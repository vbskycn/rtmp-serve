const jwt = require('jsonwebtoken');

const SECRET_KEY = process.env.JWT_SECRET || 'your-secret-key';

module.exports = (req, res, next) => {
    // 跳过登录接口的认证
    if (req.path === '/login') {
        return next();
    }

    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({
            status: 'error',
            message: '未提供认证令牌'
        });
    }

    try {
        const decoded = jwt.verify(token, SECRET_KEY);
        req.user = decoded;
        next();
    } catch (error) {
        res.status(401).json({
            status: 'error',
            message: '无效的认证令牌'
        });
    }
}; 
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const JWT_SECRET = 'your-secret-key'; // 建议使用环境变量存储
const USERS_FILE = path.join(__dirname, '../../config/users.json');

// 加密密码
function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

// 验证用户
async function verifyUser(username, password) {
    const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')).users;
    const user = users.find(u => u.username === username);
    if (!user) return null;
    
    const hashedPassword = hashPassword(password);
    if (user.password === hashedPassword) {
        return user;
    }
    return null;
}

// 更新用户密码
async function updatePassword(username, newPassword) {
    const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    const userIndex = data.users.findIndex(u => u.username === username);
    if (userIndex === -1) return false;
    
    data.users[userIndex].password = hashPassword(newPassword);
    fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 4));
    return true;
}

// 认证中间件
function authMiddleware(req, res, next) {
    // 允许访问的公共路径
    const publicPaths = [
        '/admin/login.html',
        'login.html',
        '/api/login',
        '/play',
        '/streams',
        '/favicon.ico'
    ];

    // 检查是否是公共路径
    if (publicPaths.some(path => req.path.startsWith(path))) {
        return next();
    }

    // 允许访问静态资源
    if (req.path.match(/\.(css|js|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$/)) {
        return next();
    }

    const token = req.cookies.token;
    if (!token) {
        if (req.path.startsWith('/admin')) {
            return res.redirect('/admin/login.html');
        }
        if (req.path.startsWith('/api')) {
            return res.status(401).json({ success: false, message: '未登录' });
        }
        return next();
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        if (req.path.startsWith('/admin')) {
            return res.redirect('/admin/login.html');
        }
        if (req.path.startsWith('/api')) {
            return res.status(401).json({ success: false, message: '登录已过期' });
        }
        next();
    }
}

module.exports = {
    authMiddleware,
    verifyUser,
    updatePassword,
    JWT_SECRET
}; 
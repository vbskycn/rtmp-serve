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
    try {
        console.log('Attempting to verify user:', username);
        const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')).users;
        const user = users.find(u => u.username === username);
        
        if (!user) {
            console.log('User not found:', username);
            return null;
        }
        
        const hashedPassword = hashPassword(password);
        console.log('Login attempt:');
        console.log('Username:', username);
        console.log('Input password hash:', hashedPassword);
        console.log('Stored password hash:', user.password);
        console.log('Password match:', hashedPassword === user.password);
        
        if (user.password === hashedPassword) {
            return user;
        }
        return null;
    } catch (error) {
        console.error('Error in verifyUser:', error);
        return null;
    }
}

// 更新用户密码
async function updatePassword(username, newPassword) {
    try {
        const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
        const userIndex = data.users.findIndex(u => u.username === username);
        
        if (userIndex === -1) {
            console.error('User not found for password update:', username);
            return false;
        }
        
        const hashedPassword = hashPassword(newPassword);
        data.users[userIndex].password = hashedPassword;
        
        fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 4));
        console.log('Password updated successfully for user:', username);
        return true;
    } catch (error) {
        console.error('Error updating password:', error);
        return false;
    }
}

// 认证中间件
function authMiddleware(req, res, next) {
    // 允许访问的公共路径
    const publicPaths = [
        '/login.html',
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
    
    // 如果是访问管理页面且未登录，重定向到登录页
    if (req.path === '/' || req.path === '/index.html') {
        if (!token) {
            return res.redirect('/login.html');
        }
        try {
            jwt.verify(token, JWT_SECRET);
            return next();
        } catch (err) {
            return res.redirect('/login.html');
        }
    }

    // API接口的认证处理
    if (req.path.startsWith('/api/')) {
        if (!token) {
            return res.status(401).json({ 
                success: false, 
                message: '未登录或登录已过期，请重新登录' 
            });
        }
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            req.user = decoded;
            return next();
        } catch (err) {
            return res.status(401).json({ 
                success: false, 
                message: '登录已过期，请重新登录' 
            });
        }
    }

    // 其他路径放行
    next();
}

module.exports = {
    authMiddleware,
    verifyUser,
    updatePassword,
    JWT_SECRET
}; 
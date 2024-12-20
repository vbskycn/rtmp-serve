const jwt = require('jsonwebtoken');
const config = require('config');

const JWT_SECRET = config.get('jwt.secret');

module.exports = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: '未授权访问' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: '无效的令牌' });
  }
}; 
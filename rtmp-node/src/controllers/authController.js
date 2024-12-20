const jwt = require('jsonwebtoken');
const UserModel = require('../models/user');
const config = require('config');

const JWT_SECRET = config.get('jwt.secret');

class AuthController {
  async login(req, res) {
    try {
      const { username, password } = req.body;
      const users = await UserModel.getUsers();
      const user = users.find(u => u.username === username);

      if (!user || user.password !== UserModel.hashPassword(password)) {
        return res.status(401).json({ error: '用户名或密码错误' });
      }

      const token = jwt.sign(
        { id: user.id, username: user.username, role: user.role },
        JWT_SECRET,
        { expiresIn: '24h' }
      );

      res.json({ token, user: { username: user.username, role: user.role } });
    } catch (error) {
      res.status(500).json({ error: '登录失败' });
    }
  }
}

module.exports = new AuthController(); 
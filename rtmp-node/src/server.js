const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const apiRoutes = require('./routes/api');
const UserModel = require('./models/user');

const app = express();
const PORT = process.env.PORT || 3000;

// 初始化默认用户
UserModel.initDefaultUser();

// 中间件
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('static'));

// API 路由
app.use('/api', apiRoutes);

// 前端页面路由
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../static/index.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, '../static/login.html'));
});

// 错误处理中间件
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: '服务器内部错误' });
});

app.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
}); 
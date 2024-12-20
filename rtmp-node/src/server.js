const express = require('express');
const path = require('path');
const cors = require('cors');
const auth = require('./middleware/auth');
const streamController = require('./controllers/streamController');
const configController = require('./controllers/configController');
const systemController = require('./controllers/systemController');

const app = express();

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.static('static'));

// 认证中间件
app.use('/api', auth);

// API路由
app.use('/api/streams', streamController);
app.use('/api/configs', configController);
app.use('/api/system', systemController);

// 错误处理
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
        status: 'error',
        message: err.message || '服务器内部错误'
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`服务器运行在 http://localhost:${PORT}`);
}); 
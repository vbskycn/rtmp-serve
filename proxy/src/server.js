const express = require('express');
const path = require('path');
const cors = require('cors');
const { StreamManager } = require('./streamManager');
const adminRoutes = require('./adminRoutes');
const logger = require('./utils/logger');

const app = express();
const port = process.env.PORT || 3000;

// 创建 StreamManager 实例
const streamManager = new StreamManager();

// 中间件设置
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../streams')));
app.use(express.static(path.join(__dirname, '../admin')));

// 设置管理路由
app.use(adminRoutes);

// 播放路由
app.get('/play/:streamId', async (req, res) => {
    try {
        const { streamId } = req.params;
        const streamUrl = await streamManager.getStreamUrl(streamId);
        
        if (!streamUrl) {
            return res.status(404).send('Stream not found');
        }
        
        // 重定向到实际的流文件
        res.redirect(streamUrl);
    } catch (error) {
        logger.error('Error serving stream:', error);
        res.status(500).send('Internal Server Error');
    }
});

// 错误处理中间件
app.use((err, req, res, next) => {
    logger.error('Unhandled error:', err);
    res.status(500).send('Internal Server Error');
});

// 启动服务器
app.listen(port, () => {
    logger.info(`Server running on port ${port}`);
});

// 优雅关闭
process.on('SIGTERM', async () => {
    logger.info('SIGTERM received. Shutting down gracefully...');
    // 停止所有流
    for (const [streamId] of streamManager.streams) {
        await streamManager.stopStreaming(streamId);
    }
    process.exit(0);
});

process.on('SIGINT', async () => {
    logger.info('SIGINT received. Shutting down gracefully...');
    // 停止所有流
    for (const [streamId] of streamManager.streams) {
        await streamManager.stopStreaming(streamId);
    }
    process.exit(0);
}); 
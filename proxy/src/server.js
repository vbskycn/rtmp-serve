const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const { StreamManager } = require('./streamManager');
const { setupAdminRoutes } = require('./adminRoutes');

const app = express();
const port = process.env.PORT || 3000;

// 添加错误处理中间件
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something broke!');
});

// 添加请求超时处理
app.use((req, res, next) => {
    req.setTimeout(5000000);
    res.setTimeout(5000000);
    next();
});

// 设置 ffmpeg 路径
ffmpeg.setFfmpegPath(require('ffmpeg-static'));

// 创建流管理器实例
const streamManager = new StreamManager();

// 设置静态文件目录
app.use('/streams', express.static(path.join(__dirname, '../streams')));

// 设置管理界面静态文件
app.use('/admin', express.static(path.join(__dirname, '../admin')));

// 处理流请求
app.get('/stream/:streamId', async (req, res) => {
    const { streamId } = req.params;
    try {
        const streamUrl = await streamManager.getStreamUrl(streamId);
        if (!streamUrl) {
            return res.status(404).send('Stream not found');
        }
        
        // 开始转换流
        await streamManager.startStreaming(streamId);
        
        // 返回 m3u8 播放列表
        res.redirect(`/streams/${encodeURIComponent(streamId)}/playlist.m3u8`);
    } catch (error) {
        console.error(error);
        res.status(500).send('Internal Server Error');
    }
});

// 添加直接访问 m3u8 的路由
app.get('/streams/:streamId/playlist.m3u8', async (req, res) => {
    const { streamId } = req.params;
    try {
        // 确保流存在
        const streamUrl = await streamManager.getStreamUrl(streamId);
        if (!streamUrl) {
            return res.status(404).send('Stream not found');
        }
        
        // 如果流未启动，则启动它
        if (!streamManager.streamProcesses.has(streamId)) {
            await streamManager.startStreaming(streamId);
        }
        
        // 转发到静态文件
        res.sendFile(path.join(__dirname, '../streams', streamId, 'playlist.m3u8'));
    } catch (error) {
        console.error(error);
        res.status(500).send('Internal Server Error');
    }
});

// 设置管理路由
setupAdminRoutes(app, streamManager);

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
}); 
const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const { StreamManager } = require('./streamManager');
const { setupAdminRoutes } = require('./adminRoutes');

const app = express();
const port = process.env.PORT || 3000;

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
        res.redirect(`/streams/${streamId}/playlist.m3u8`);
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
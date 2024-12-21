const express = require('express');
const path = require('path');
const cors = require('cors');
const { StreamManager } = require('./streamManager');
const adminRoutes = require('./adminRoutes');
const logger = require('./utils/logger');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 3000;

// 创建 StreamManager 实例
const streamManager = new StreamManager();

// 中间件设置
app.use(cors());
app.use(express.json());

// 修改静态文件服务配置
app.use('/streams', express.static(path.join(__dirname, '../streams'), {
    setHeaders: (res, path, stat) => {
        // 为 m3u8 和 ts 文件设置正确的 MIME 类型和缓存控制
        if (path.endsWith('.m3u8')) {
            res.set('Content-Type', 'application/vnd.apple.mpegurl');
            res.set('Cache-Control', 'no-cache');
        } else if (path.endsWith('.ts')) {
            res.set('Content-Type', 'video/mp2t');
            res.set('Cache-Control', 'public, max-age=86400');
        }
    }
}));

app.use(express.static(path.join(__dirname, '../admin')));

// 设置管理路由
app.use(adminRoutes);

// 播放���由
app.get('/play/:streamId', async (req, res) => {
    try {
        const { streamId } = req.params;
        const stream = streamManager.streams.get(streamId);
        
        if (!stream) {
            return res.status(404).send('Stream not found');
        }

        // 如果流没有运行，启动它
        if (!streamManager.streamProcesses.has(streamId)) {
            await streamManager.startStreaming(streamId);
        }

        // 重定向到 HLS 播放列表
        res.redirect(`/streams/${streamId}/playlist.m3u8`);
    } catch (error) {
        logger.error('Error serving stream:', error);
        res.status(500).send('Internal Server Error');
    }
});

// 直接访问 m3u8 文件的路由
app.get('/streams/:streamId/playlist.m3u8', async (req, res) => {
    try {
        const { streamId } = req.params;
        const playlistPath = path.join(__dirname, '../streams', streamId, 'playlist.m3u8');
        
        if (!fs.existsSync(playlistPath)) {
            // 如果文件不存在，尝试启动流
            const stream = streamManager.streams.get(streamId);
            if (stream) {
                await streamManager.startStreaming(streamId);
                // 等待文件创建
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
        
        if (fs.existsSync(playlistPath)) {
            // 添加观看者
            streamManager.addViewer(streamId);
            
            // 读取并修改 m3u8 文件内容
            let content = fs.readFileSync(playlistPath, 'utf8');
            
            // 替换分片路径为完整 URL
            content = content.replace(/segment_\d+\.ts/g, (match) => {
                return `/streams/${streamId}/${match}`;
            });

            // 监听连接关闭
            res.on('close', () => {
                streamManager.removeViewer(streamId);
            });

            res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
            res.setHeader('Cache-Control', 'no-cache');
            res.send(content);
        } else {
            res.status(404).send('Stream not found');
        }
    } catch (error) {
        logger.error('Error serving m3u8 file:', error);
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
const express = require('express');
const path = require('path');
const cors = require('cors');
const { StreamManager } = require('./streamManager');
const adminRoutes = require('./adminRoutes');
const logger = require('./utils/logger');
const fs = require('fs');
const config = require('../config/config.json');
const os = require('os');
const cookieParser = require('cookie-parser');
const { authMiddleware } = require('./middleware/auth');

const app = express();
// 使用配置文件中的端口
const port = config.server.port;

// 创建 StreamManager 实例
const streamManager = new StreamManager();

// 中间件设置
app.use(cors());
app.use(express.json());
app.use(cookieParser());
app.use(authMiddleware);

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

// 播放由
app.get('/play/:streamId', async (req, res) => {
    try {
        const { streamId } = req.params;
        // 尝试两种形式的streamId
        const fullStreamId = streamId.startsWith('stream_') ? streamId : `stream_${streamId}`;
        const shortStreamId = streamId.startsWith('stream_') ? streamId.replace('stream_', '') : streamId;
        
        // 先尝试完整ID，再尝试短ID
        let stream = streamManager.streams.get(fullStreamId);
        if (!stream) {
            stream = streamManager.streams.get(`stream_${shortStreamId}`);
        }
        
        if (!stream) {
            logger.error(`Stream not found: ${streamId} (tried ${fullStreamId} and stream_${shortStreamId})`);
            return res.status(404).send('Stream not found');
        }

        const actualStreamId = stream.id; // 使用找到的流的实际ID

        // 如果流没有运行，启动它
        if (!streamManager.streamProcesses.has(actualStreamId)) {
            logger.info(`Starting stream on demand: ${actualStreamId}`);
            await streamManager.startStreaming(actualStreamId);
        }

        // 重定向到 HLS 播放列表
        res.redirect(`/streams/${actualStreamId}/playlist.m3u8`);
    } catch (error) {
        logger.error('Error serving stream:', error);
        res.status(500).send('Internal Server Error');
    }
});

// 直接访问 m3u8 文件的路由
app.get('/streams/:streamId/playlist.m3u8', async (req, res) => {
    try {
        const { streamId } = req.params;
        // 尝试两种形式的streamId
        const fullStreamId = streamId.startsWith('stream_') ? streamId : `stream_${streamId}`;
        const shortStreamId = streamId.startsWith('stream_') ? streamId.replace('stream_', '') : streamId;
        
        // 先尝试完整ID，再尝试短ID
        let stream = streamManager.streams.get(fullStreamId);
        if (!stream) {
            stream = streamManager.streams.get(`stream_${shortStreamId}`);
        }
        
        if (!stream) {
            logger.error(`Stream not found: ${streamId} (tried ${fullStreamId} and stream_${shortStreamId})`);
            return res.status(404).send('Stream not found');
        }

        const actualStreamId = stream.id; // 使用找到的流的实际ID
        const playlistPath = path.join(__dirname, '../streams', actualStreamId, 'playlist.m3u8');
        
        if (!fs.existsSync(playlistPath)) {
            // 如果文件不存在，尝试启动流
            logger.info(`Starting stream for m3u8 request: ${actualStreamId}`);
            await streamManager.startStreaming(actualStreamId);
            // 等待文件创建
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
        if (fs.existsSync(playlistPath)) {
            // 添加观看者
            streamManager.addViewer(actualStreamId);
            
            // 读取并修改 m3u8 文件内容
            let content = fs.readFileSync(playlistPath, 'utf8');
            
            // 替换分片路径为完整 URL
            content = content.replace(/segment_\d+\.ts/g, (match) => {
                return `/streams/${actualStreamId}/${match}`;
            });

            // 监听连接关闭
            res.on('close', () => {
                streamManager.removeViewer(actualStreamId);
            });

            res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
            res.setHeader('Cache-Control', 'no-cache');
            res.send(content);
        } else {
            logger.error(`Playlist not found: ${actualStreamId}`);
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

// 添加获取本机IP的函数
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const interface of interfaces[name]) {
            // 跳过内部IP和IPv6
            if (interface.internal || interface.family === 'IPv6') {
                continue;
            }
            return interface.address;
        }
    }
    return 'localhost';
}

// 在服务器启动前检查和更新配置
async function initializeServer() {
    try {
        if (config.server.host === 'auto') {
            config.server.host = getLocalIP();
            // 保存更新后的配置
            fs.writeFileSync(
                path.join(__dirname, '../config/config.json'),
                JSON.stringify(config, null, 2)
            );
        }
        
        // 启动服务器
        app.listen(port, () => {
            logger.info(`Server running on ${config.server.host}:${port}`);
        });
    } catch (error) {
        logger.error('Error initializing server:', error);
        process.exit(1);
    }
}

// 添加配置相关的路由
app.get('/api/config', (req, res) => {
    res.json(config);
});

app.post('/api/config', (req, res) => {
    try {
        const newConfig = req.body;
        // 验证配置
        if (!newConfig.server || !newConfig.rtmp) {
            return res.status(400).json({ success: false, error: '无效的配置格式' });
        }
        
        // 检查配置是否有实际变化
        const hasChanges = JSON.stringify(config.server) !== JSON.stringify(newConfig.server) ||
                          JSON.stringify(config.rtmp) !== JSON.stringify(newConfig.rtmp);
        
        if (!hasChanges) {
            return res.json({ success: true, message: '配置未发生变化' });
        }
        
        // 保存配置
        fs.writeFileSync(
            path.join(__dirname, '../config/config.json'),
            JSON.stringify(newConfig, null, 2)
        );

        // 返回需要重启的信息
        res.json({ 
            success: true, 
            requireRestart: true,
            message: '配置已保存，系统将在5秒后自动重启...'
        });

        // 延迟5秒后重启服务器
        setTimeout(() => {
            logger.info('Restarting server due to configuration change...');
            process.exit(0);  // 使用 PM2 或 systemd 会自动重启服务
        }, 5000);
        
    } catch (error) {
        logger.error('Error saving config:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 修改启动方式
initializeServer();

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
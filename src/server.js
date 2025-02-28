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
const axios = require('axios');

process.chdir(path.join(__dirname, '..'));

const app = express();
// 使用配置文件中的端口
const port = config.server.port;

// 创建 StreamManager 实例
const streamManager = new StreamManager();
app.set('streamManager', streamManager);

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

// 修改播放路由
app.get('/play/:streamId', async (req, res) => {
    try {
        const { streamId } = req.params;
        const streamUrl = await streamManager.getStreamUrl(streamId);
        
        if (!streamUrl) {
            logger.error(`Failed to get stream URL for: ${streamId}`);
            return res.status(404).send('Stream not found or failed to start');
        }

        // 检查播放列表文件是否存在
        const stream = streamManager.getStreamById(streamId);
        const actualStreamId = stream ? stream.id : null;
        if (!actualStreamId) {
            logger.error(`Stream not found: ${streamId}`);
            return res.status(404).send('Stream not found');
        }

        const playlistPath = path.join(__dirname, '../streams', actualStreamId, 'playlist.m3u8');
        
        if (!fs.existsSync(playlistPath)) {
            logger.error(`Playlist file not found for stream: ${actualStreamId}`);
            return res.status(404).send('Stream playlist not found');
        }

        // 重定向到实际的播放地址
        res.redirect(streamUrl);
    } catch (error) {
        logger.error('Error serving stream:', error);
        res.status(500).send('Internal Server Error');
    }
});

// 修改 m3u8 文件路由
app.get('/streams/:streamId/playlist.m3u8', async (req, res) => {
    try {
        const { streamId } = req.params;
        const stream = streamManager.getStreamById(streamId);
        
        if (!stream) {
            logger.error(`Stream not found: ${streamId}`);
            return res.status(404).send('Stream not found');
        }

        const actualStreamId = stream.id;
        const playlistPath = path.join(__dirname, '../streams', actualStreamId, 'playlist.m3u8');
        
        // 如果播放列表不存在，尝试重新启动流
        if (!fs.existsSync(playlistPath)) {
            logger.info(`Playlist not found, starting stream: ${actualStreamId}`);
            await streamManager.startStreaming(actualStreamId);
            
            // 等待播放列表生成
            let attempts = 0;
            while (!fs.existsSync(playlistPath) && attempts < 10) {
                await new Promise(resolve => setTimeout(resolve, 1000));
                attempts++;
            }
            
            if (!fs.existsSync(playlistPath)) {
                logger.error(`Failed to generate playlist for stream: ${actualStreamId}`);
                return res.status(404).send('Stream playlist not found');
            }
        }
        
        // 添加观看者并处理连接关闭
        streamManager.addViewer(actualStreamId);
        res.on('close', () => {
            streamManager.removeViewer(actualStreamId);
        });

        // 读取并修改播放列表内容
        let content = fs.readFileSync(playlistPath, 'utf8');
        content = content.replace(/segment_\d+\.ts/g, (match) => {
            return `/streams/${actualStreamId}/${match}`;
        });

        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.setHeader('Cache-Control', 'no-cache');
        res.send(content);
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

// 修改 getPublicIP 函数
async function getPublicIP() {
    try {
        // 首先检查环境变量
        if (process.env.SERVER_HOST) {
            logger.info(`Using SERVER_HOST from environment: ${process.env.SERVER_HOST}`);
            return process.env.SERVER_HOST;
        }

        // 使用 StreamManager 的 getPublicIP 方法
        const ip = await streamManager.getPublicIP();
        logger.info(`Obtained public IP: ${ip}`);
        return ip;
    } catch (error) {
        logger.error('Failed to get public IP:', error);
        return '0.0.0.0';
    }
}

// 修改 initializeServer 函数
async function initializeServer() {
    try {
        // 获取服务器IP和端口
        const serverHost = await getPublicIP();
        const serverPort = parseInt(process.env.SERVER_PORT) || config.server.port;

        // 更新配置
        config.server.host = serverHost;
        config.server.port = serverPort;

        // 保存更新后的配置
        const configPath = path.join(__dirname, '../config/config.json');
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        
        // 启动服务器
        app.listen(serverPort, '0.0.0.0', () => {
            logger.info(`Server running at http://${serverHost}:${serverPort}`);
            logger.info(`Server IP: ${serverHost}`);
            logger.info(`Server Port: ${serverPort}`);
        });

        // 启动心跳服务
        if (streamManager.heartbeatConfig?.enabled) {
            streamManager.startHeartbeat();
        }
    } catch (error) {
        logger.error('Server initialization failed:', error);
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

// 添加获取统计信息的路由
app.get('/api/stats', (req, res) => {
    const stats = streamManager.getStats();
    res.json(stats);
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
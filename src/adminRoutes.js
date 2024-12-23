const express = require('express');
const router = express.Router();
const { StreamManager } = require('./streamManager');
const logger = require('./utils/logger');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const { verifyUser, updatePassword, JWT_SECRET } = require('./middleware/auth');

// 创建 StreamManager 实例
const streamManager = new StreamManager();

// 修改生成流ID的函数
function generateStreamId(name, url, customId = '') {
    // 如果提供了自定义ID，直接使用
    if (customId) {
        return 'stream_' + customId;
    }

    // 生成6位随机ID
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let randomId = '';
    for (let i = 0; i < 6; i++) {
        randomId += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return 'stream_' + randomId;
}

// 添加单个流
router.post('/api/streams', async (req, res) => {
    try {
        const { name, url, customId, category } = req.body;
        
        if (!name || !url) {
            return res.json({
                success: false,
                error: '名称和地址不能为空'
            });
        }

        // 生成streamId (优先使用customId，否则生成随机ID)
        const streamId = generateStreamId(name, url, customId);
        const streamData = {
            id: streamId,
            name: name,
            url: url,
            category: category || '未分类',
            kodiprop: '',
            tvg: {
                id: '',
                name: name,
                logo: '',
                group: category || ''
            }
        };

        const result = await streamManager.addStream(streamData);
        
        if (!result || !result.success) {
            throw new Error(result?.error || '添加流失败');
        }

        res.json({
            success: true,
            stream: streamData
        });
    } catch (error) {
        logger.error('添加流失败:', error);
        res.json({
            success: false,
            error: error.message || '添加流失败'
        });
    }
});

// 获取所有流列表
router.get('/api/streams', async (req, res) => {
    try {
        const streams = [];
        for (const [id, streamConfig] of streamManager.streams.entries()) {
            const playUrl = `${streamManager.getServerUrl()}/play/${id}`;
            streams.push({
                id,
                ...streamConfig,
                playUrl,
                stats: streamManager.streamStats.get(id),
                processRunning: await checkStreamStatus(id),
                manuallyStarted: streamManager.manuallyStartedStreams.has(id)
            });
        }
        res.json(streams);
    } catch (error) {
        logger.error('Error getting streams:', error);
        res.status(500).json({ error: 'Failed to get streams' });
    }
});

// 修改批量导入的路由处理
router.post('/api/streams/batch', async (req, res) => {
    try {
        const { m3u } = req.body;
        const lines = m3u.split('\n').filter(line => line.trim());
        const results = [];
        let currentCategory = '未分类';
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            
            // 检查是否是分类行
            if (line.endsWith('#genre#')) {
                currentCategory = line.split(',')[0].trim();
                continue;
            }
            
            // 处理常规流行
            const [name, url] = line.split(',').map(s => s.trim());
            
            if (!name || !url) {
                continue;
            }

            try {
                const streamData = {
                    name,
                    url,
                    category: currentCategory,
                    tvg: {
                        id: '',
                        name: name,
                        logo: '',
                        group: currentCategory
                    }
                };

                const result = await streamManager.addStream(streamData);
                results.push({
                    name,
                    success: true
                });
            } catch (error) {
                logger.error(`Error adding stream ${name}:`, error);
                results.push({
                    name,
                    success: false,
                    error: error.message
                });
            }
        }

        const successCount = results.filter(r => r.success).length;
        const failCount = results.length - successCount;

        res.json({
            success: true,
            results,
            summary: {
                total: results.length,
                success: successCount,
                failed: failCount
            }
        });
    } catch (error) {
        logger.error('Error in batch import:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 删除流
router.delete('/api/streams/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await streamManager.deleteStream(id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 修改重启流的路由
router.post('/api/streams/:id/restart', async (req, res) => {
    try {
        const { id } = req.params;
        const { manual } = req.body;
        await streamManager.restartStream(id, manual === true);
        res.json({ success: true });
    } catch (error) {
        logger.error(`Error restarting stream: ${id}`, error);
        res.json({ 
            success: false, 
            error: error.message || '重启流失败'
        });
    }
});

// 停止流
router.post('/api/streams/:id/stop', async (req, res) => {
    try {
        const { id } = req.params;
        await streamManager.stopStreaming(id);
        res.json({ success: true });
    } catch (error) {
        logger.error(`Error stopping stream: ${id}`, error);
        res.json({ 
            success: false, 
            error: error.message || '停止流失败'
        });
    }
});

// 更新流ID
router.post('/api/streams/:id/updateId', async (req, res) => {
    try {
        const { id } = req.params;
        const { newId } = req.body;
        
        // 检查新ID是否已存在
        if (streamManager.streams.has(newId)) {
            return res.json({
                success: false,
                error: '流ID已存在'
            });
        }

        // 更新流ID
        const stream = streamManager.streams.get(id);
        if (!stream) {
            return res.json({
                success: false,
                error: '流不存在'
            });
        }

        // 复制流配置到新ID
        streamManager.streams.set(newId, stream);
        streamManager.streams.delete(id);

        // 更新统计信息
        const stats = streamManager.streamStats.get(id);
        if (stats) {
            streamManager.streamStats.set(newId, stats);
            streamManager.streamStats.delete(id);
        }

        // 更新进程信息
        const processes = streamManager.streamProcesses.get(id);
        if (processes) {
            streamManager.streamProcesses.set(newId, processes);
            streamManager.streamProcesses.delete(id);
        }

        // 保存配置
        await streamManager.saveStreams();

        res.json({ success: true });
    } catch (error) {
        logger.error(`Error updating stream ID: ${id}`, error);
        res.json({
            success: false,
            error: error.message || '更新流ID失败'
        });
    }
});

function parseM3U(content) {
    const streams = [];
    const lines = content.split('\n');
    let currentStream = null;
    let kodiprops = [];
    let currentCategory = '未分类';

    for (let line of lines) {
        line = line.trim();
        if (!line) continue;

        // 检查是否是分类行
        if (line.endsWith('#genre#')) {
            currentCategory = line.split(',')[0].trim();
            continue;
        }

        if (line.startsWith('#EXTINF:')) {
            currentStream = {};
            const tvgInfo = line.match(/tvg-id="([^"]*)".*tvg-name="([^"]*)".*tvg-logo="([^"]*)".*group-title="([^"]*)",\s*(.*)/);
            if (tvgInfo) {
                currentStream.tvg = {
                    id: tvgInfo[1],
                    name: tvgInfo[2],
                    logo: tvgInfo[3],
                    group: currentCategory
                };
                currentStream.name = tvgInfo[5].trim();
            } else {
                // 如果没有匹配到完整的TVG信息，至少设置名称和分类
                currentStream.name = line.split(',').pop().trim();
                currentStream.tvg = {
                    id: '',
                    name: currentStream.name,
                    logo: '',
                    group: currentCategory
                };
            }
            currentStream.category = currentCategory;
        } else if (line.startsWith('#KODIPROP:')) {
            kodiprops.push(line);
        } else if (!line.startsWith('#')) {
            if (currentStream) {
                currentStream.url = line;
                currentStream.kodiprop = kodiprops.join('\n');
                streams.push(currentStream);
                currentStream = null;
                kodiprops = [];
            }
        }
    }

    return streams;
}

// 添加检查流状态的函数
async function checkStreamStatus(streamId) {
    try {
        // 检查进程是否存在
        const hasProcess = streamManager.streamProcesses.has(streamId);
        if (hasProcess) return true;

        // 检查播放列表文件是否存在且最近有更新
        const playlistPath = path.join(__dirname, '../streams', streamId, 'playlist.m3u8');
        if (fs.existsSync(playlistPath)) {
            const stats = fs.statSync(playlistPath);
            const fileAge = Date.now() - stats.mtimeMs;
            // 如果文件在最近30秒内有更新，认为流是活跃的
            if (fileAge < 30000) return true;
        }

        // 检查是否有 .ts 分片文件且最近有更新
        const streamDir = path.join(__dirname, '../streams', streamId);
        if (fs.existsSync(streamDir)) {
            const files = fs.readdirSync(streamDir);
            const tsFiles = files.filter(f => f.endsWith('.ts'));
            if (tsFiles.length > 0) {
                // 检查最新的分片文件
                const latestTs = tsFiles.sort().pop();
                const tsStats = fs.statSync(path.join(streamDir, latestTs));
                const fileAge = Date.now() - tsStats.mtimeMs;
                // 如果最新的分片文件在最近30秒内有更新，认为流是活跃的
                if (fileAge < 30000) return true;
            }
        }

        return false;
    } catch (error) {
        logger.error(`Error checking stream status: ${streamId}`, error);
        return false;
    }
}

// 添加获取服务器配置的路由
router.get('/api/config', (req, res) => {
    res.json(streamManager.config);
});

// 添加更新流的路由
router.put('/api/streams/:streamId', async (req, res) => {
    try {
        const { streamId } = req.params;
        const result = await streamManager.updateStream(streamId, req.body);
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 添加获取单个流信息的路由
router.get('/api/streams/:streamId', async (req, res) => {
    try {
        const { streamId } = req.params;
        const stream = streamManager.streams.get(streamId);
        if (!stream) {
            res.status(404).json({
                success: false,
                error: 'Stream not found'
            });
            return;
        }
        res.json(stream);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 修改获取系统统计信息的路由
router.get('/api/stats', (req, res) => {
    try {
        const trafficStats = streamManager.getTrafficStats();
        const stats = {
            uptime: Date.now() - streamManager.startTime, // 使用实际的启动时间
            totalStreams: streamManager.streams.size,
            activeStreams: streamManager.streamProcesses.size,
            traffic: {
                sent: trafficStats.sent,
                received: trafficStats.received
            }
        };
        res.json(stats);
    } catch (error) {
        logger.error('Error getting system stats:', error);
        res.status(500).json({ error: 'Failed to get system stats' });
    }
});

// 登录接口
router.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.json({
            success: false,
            message: '用户名和密码不能为空'
        });
    }

    try {
        const user = await verifyUser(username, password);
        if (!user) {
            return res.json({
                success: false,
                message: '用户名或密码错误'
            });
        }

        // 生成JWT token
        const token = jwt.sign(
            { username: user.username, role: user.role },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        // 设置cookie
        res.cookie('token', token, {
            httpOnly: true,
            maxAge: 24 * 60 * 60 * 1000 // 24小时
        });

        res.json({ success: true });
    } catch (error) {
        console.error('Login error:', error);
        res.json({
            success: false,
            message: '登录失败，请稍后重试'
        });
    }
});

// 修改密码接口
router.post('/api/change-password', async (req, res) => {
    const { oldPassword, newPassword } = req.body;
    const username = req.user.username;

    try {
        // 验证旧密码
        const user = await verifyUser(username, oldPassword);
        if (!user) {
            return res.json({ 
                success: false, 
                message: '旧密码错误' 
            });
        }

        // 更新密码
        const updated = await updatePassword(username, newPassword);
        if (!updated) {
            return res.json({ 
                success: false, 
                message: '更新密码失败' 
            });
        }

        res.json({ 
            success: true, 
            message: '密码已更新，请重新登录' 
        });
    } catch (error) {
        console.error('Change password error:', error);
        res.json({ 
            success: false, 
            message: '更新密码失败：' + error.message 
        });
    }
});

// 登出接口
router.post('/logout', (req, res) => {
    res.clearCookie('token');
    res.json({ success: true });
});

// 在现有路由之后添加
// 存储服务器状态
const servers = new Map();

// 接收心跳 - 不需要验证
router.post('/api/heartbeat', (req, res) => {
    try {
        const serverInfo = req.body;
        // 添加接收时间戳
        const receivedAt = Date.now();
        servers.set(serverInfo.serverName, {
            ...serverInfo,
            lastHeartbeat: receivedAt
        });
        logger.debug(`Received heartbeat from ${serverInfo.serverName}`);
        res.json({ 
            success: true,
            receivedAt
        });
    } catch (error) {
        logger.error('Error processing heartbeat:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// 获取所有服务器状态 - 需要认证的路由
router.get('/api/servers', verifyToken, (req, res) => {
    try {
        const serverList = Array.from(servers.entries()).map(([name, info]) => ({
            ...info,
            isOnline: (Date.now() - info.lastHeartbeat) < 600000 // 10分钟内有心跳就认为在线
        }));
        res.json(serverList);
    } catch (error) {
        logger.error('Error getting server list:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

module.exports = router; 
const express = require('express');
const router = express.Router();
const { StreamManager } = require('./streamManager');
const logger = require('./utils/logger');

// 创建 StreamManager 实例
const streamManager = new StreamManager();

// 生成流ID
function generateStreamId(name, url, customId = '') {
    // 如果提供了自定义ID，直接使用
    if (customId) {
        return 'stream_' + customId;
    }

    // 尝试从URL中提取ID
    try {
        const urlParts = url.split('/');
        const lastPart = urlParts[urlParts.length - 1];
        if (lastPart && lastPart.length > 3) {
            return 'stream_' + lastPart;
        }
    } catch (error) {
        logger.debug('Failed to extract ID from URL:', error);
    }

    // 生成随机ID（6位字母数字组合）
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
        const { name, url, customId } = req.body;
        
        if (!name || !url) {
            return res.json({
                success: false,
                error: '名称和地址不能为空'
            });
        }

        const streamData = {
            id: generateStreamId(name, url, customId),
            name: name,
            url: url,
            kodiprop: '',
            tvg: {
                id: '',
                name: name,
                logo: '',
                group: ''
            }
        };

        await streamManager.addStream(streamData);
        
        // 检查流是否成功启动
        const stream = streamManager.streams.get(streamData.id);
        if (!stream) {
            throw new Error('流添加失败');
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
router.get('/api/streams', (req, res) => {
    const streams = [];
    for (const [id, config] of streamManager.streams.entries()) {
        streams.push({
            id,
            ...config,
            stats: streamManager.streamStats.get(id)
        });
    }
    res.json(streams);
});

// 批量添加流
router.post('/api/streams/batch', async (req, res) => {
    try {
        const { m3u } = req.body;
        const streams = parseM3U(m3u);
        
        for (const stream of streams) {
            await streamManager.addStream(stream.name, {
                name: stream.name,
                url: stream.url,
                kodiprop: stream.kodiprop,
                tvg: stream.tvg
            });
        }

        logger.info(`Batch added ${streams.length} streams`);
        res.json({ success: true, count: streams.length });
    } catch (error) {
        logger.error('Error adding streams:', error);
        res.status(500).json({ error: error.message });
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

// 重启流
router.post('/api/streams/:id/restart', async (req, res) => {
    try {
        const { id } = req.params;
        await streamManager.restartStream(id);
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

    for (let line of lines) {
        line = line.trim();
        if (!line) continue;

        if (line.startsWith('#EXTINF:')) {
            // 解析 EXTINF 行
            currentStream = {};
            const tvgInfo = line.match(/tvg-id="([^"]*)".*tvg-name="([^"]*)".*tvg-logo="([^"]*)".*group-title="([^"]*)",\s*(.*)/);
            if (tvgInfo) {
                currentStream.tvg = {
                    id: tvgInfo[1],
                    name: tvgInfo[2],
                    logo: tvgInfo[3],
                    group: tvgInfo[4]
                };
                currentStream.name = tvgInfo[5].trim();
            }
        } else if (line.startsWith('#KODIPROP:')) {
            // 收集 KODIPROP
            kodiprops.push(line);
        } else if (!line.startsWith('#')) {
            // URL 行
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

module.exports = router; 
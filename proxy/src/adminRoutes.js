const express = require('express');
const logger = require('./utils/logger');

function setupAdminRoutes(app, streamManager) {
    app.use(express.json());

    // 获取所有流列表
    app.get('/api/streams', (req, res) => {
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
    app.post('/api/streams/batch', async (req, res) => {
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
    app.delete('/api/streams/:id', async (req, res) => {
        try {
            const { id } = req.params;
            await streamManager.deleteStream(id);
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });
}

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

module.exports = { setupAdminRoutes }; 
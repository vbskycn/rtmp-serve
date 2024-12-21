const express = require('express');
const basicAuth = require('express-basic-auth');
const logger = require('./utils/logger');

function setupAdminRoutes(app, streamManager) {
    const auth = basicAuth({
        users: { 'admin': 'password' },
        challenge: true
    });

    app.use('/api', auth);
    app.use(express.json());

    // 添加新流
    app.post('/api/streams', async (req, res) => {
        const { id, url, name } = req.body;
        try {
            await streamManager.addStream(id, { url, name });
            logger.info(`New stream added`, { id, name });
            res.json({ success: true });
        } catch (error) {
            logger.error('Error adding stream', { error });
            res.status(500).json({ error: error.message });
        }
    });

    // 获取所有流
    app.get('/api/streams', async (req, res) => {
        try {
            const streams = Array.from(streamManager.streams.entries()).map(([id, config]) => ({
                id,
                ...config,
                active: streamManager.streamProcesses.has(id),
                stats: streamManager.getStreamStats(id)
            }));
            res.json(streams);
        } catch (error) {
            logger.error('Error getting streams', { error });
            res.status(500).json({ error: error.message });
        }
    });

    // 停止流
    app.post('/api/streams/:id/stop', async (req, res) => {
        const { id } = req.params;
        try {
            await streamManager.stopStreaming(id);
            logger.info(`Stream stopped`, { id });
            res.json({ success: true });
        } catch (error) {
            logger.error('Error stopping stream', { error });
            res.status(500).json({ error: error.message });
        }
    });

    // 获取流统计信息
    app.get('/api/streams/:id/stats', async (req, res) => {
        const { id } = req.params;
        try {
            const stats = streamManager.getStreamStats(id);
            if (!stats) {
                return res.status(404).json({ error: 'Stream not found' });
            }
            res.json(stats);
        } catch (error) {
            logger.error('Error getting stream stats', { error });
            res.status(500).json({ error: error.message });
        }
    });

    // 启动流
    app.post('/api/streams/:id/start', async (req, res) => {
        const { id } = req.params;
        try {
            await streamManager.startStreaming(id);
            logger.info(`Stream started`, { id });
            res.json({ success: true });
        } catch (error) {
            logger.error('Error starting stream', { error });
            res.status(500).json({ error: error.message });
        }
    });

    // 删除流
    app.delete('/api/streams/:id', async (req, res) => {
        const { id } = req.params;
        try {
            await streamManager.stopStreaming(id);
            streamManager.streams.delete(id);
            streamManager.streamStats.delete(id);
            logger.info(`Stream deleted`, { id });
            res.json({ success: true });
        } catch (error) {
            logger.error('Error deleting stream', { error });
            res.status(500).json({ error: error.message });
        }
    });
}

module.exports = { setupAdminRoutes }; 
const express = require('express');
const router = express.Router();
const ffmpegService = require('../services/ffmpegService');
const db = require('../services/db');

// 获取所有流列表
router.get('/', async (req, res) => {
    try {
        const streams = await db.getAllStreams();
        res.json({
            status: 'success',
            data: streams
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
});

// 添加新流
router.post('/', async (req, res) => {
    try {
        const streamData = req.body;
        const stream = await db.addStream(streamData);
        res.json({
            status: 'success',
            data: stream
        });
    } catch (error) {
        res.status(400).json({
            status: 'error',
            message: error.message
        });
    }
});

// 启动流
router.post('/:id/start', async (req, res) => {
    try {
        const { id } = req.params;
        const stream = await db.getStream(id);
        await ffmpegService.startStream(stream);
        await db.updateStreamStatus(id, 'running');
        res.json({
            status: 'success',
            message: '流已启动'
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
});

// 停止流
router.post('/:id/stop', async (req, res) => {
    try {
        const { id } = req.params;
        await ffmpegService.stopStream(id);
        await db.updateStreamStatus(id, 'stopped');
        res.json({
            status: 'success',
            message: '流已停止'
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
});

// 删除流
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await ffmpegService.stopStream(id);
        await db.deleteStream(id);
        res.json({
            status: 'success',
            message: '流已删除'
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
});

// 获取流状态
router.get('/:id/status', async (req, res) => {
    try {
        const { id } = req.params;
        const status = await ffmpegService.getStreamStatus(id);
        res.json({
            status: 'success',
            data: status
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
});

// 批量操作
router.post('/batch', async (req, res) => {
    try {
        const { action, ids } = req.body;
        
        switch (action) {
            case 'start':
                await Promise.all(ids.map(id => ffmpegService.startStream(id)));
                break;
            case 'stop':
                await Promise.all(ids.map(id => ffmpegService.stopStream(id)));
                break;
            case 'delete':
                await Promise.all(ids.map(id => {
                    ffmpegService.stopStream(id);
                    return db.deleteStream(id);
                }));
                break;
            default:
                throw new Error('未知的操作类型');
        }
        
        res.json({
            status: 'success',
            message: '批量操作完成'
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
});

module.exports = router; 
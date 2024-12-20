const express = require('express');
const router = express.Router();
const services = require('../services');

// 流管理
router.get('/streams', async (req, res) => {
    try {
        const streams = await services.db.getAllStreams();
        res.json({ status: 'success', data: streams });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// 配置管理
router.get('/configs', async (req, res) => {
    try {
        const configs = await services.db.getAllConfigs();
        res.json({ status: 'success', data: configs });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// 系统监控
router.get('/system/metrics', async (req, res) => {
    try {
        const metrics = await services.ffmpeg.getSystemMetrics();
        res.json(metrics);
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// ... 其他API路由

module.exports = router; 
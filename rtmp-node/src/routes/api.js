const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const streamController = require('../controllers/streamController');
const authController = require('../controllers/authController');

// 认证路由
router.post('/auth/login', authController.login);

// 受保护的路由
router.use(authMiddleware);

// 流管理路由
router.get('/streams', streamController.getAllStreams);
router.post('/streams', streamController.addStream);
router.post('/streams/:id/start', streamController.startStream);
router.post('/streams/:id/stop', streamController.stopStream);
router.delete('/streams/:id', streamController.deleteStream);
router.get('/streams/metrics', streamController.getStreamMetrics);

module.exports = router; 
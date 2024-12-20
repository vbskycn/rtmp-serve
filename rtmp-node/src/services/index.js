const ffmpegService = require('./ffmpegService');
const dbService = require('./db');
const logger = require('./logger');
const WebSocketService = require('./websocket');

// 导出所有服务
module.exports = {
    ffmpeg: ffmpegService,
    db: dbService,
    logger,
    WebSocketService
}; 
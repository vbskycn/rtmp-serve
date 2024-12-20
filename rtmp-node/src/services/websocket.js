const WebSocket = require('ws');
const logger = require('./logger');

class WebSocketService {
    constructor(server) {
        this.wss = new WebSocket.Server({ server });
        this.clients = new Set();
        this.init();
    }

    init() {
        this.wss.on('connection', (ws) => {
            this.clients.add(ws);
            logger.info('WebSocket客户端连接');

            ws.on('close', () => {
                this.clients.delete(ws);
                logger.info('WebSocket客户端断开');
            });

            ws.on('error', (error) => {
                logger.error('WebSocket错误:', error);
            });
        });
    }

    broadcast(data) {
        this.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(data));
            }
        });
    }

    // 发送系统指标更新
    sendMetricsUpdate(metrics) {
        this.broadcast({
            type: 'metrics',
            data: metrics
        });
    }

    // 发送流状态更新
    sendStreamUpdate(streamId, status) {
        this.broadcast({
            type: 'stream_status',
            data: {
                id: streamId,
                status: status
            }
        });
    }

    // 发送错误通知
    sendError(error) {
        this.broadcast({
            type: 'error',
            data: {
                message: error.message
            }
        });
    }
}

module.exports = WebSocketService; 
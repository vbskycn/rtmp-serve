const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const logger = require('./utils/logger');
const axios = require('axios');
const EventEmitter = require('events');
const config = require('../config/config.json');
const { spawn } = require('child_process');

class StreamManager extends EventEmitter {
    constructor() {
        super();
        this.streams = new Map();
        this.activeStreams = new Map();
        this.streamProcesses = new Map();
        this.streamStats = new Map();
        this.healthChecks = new Map();
        this.configPath = path.join(__dirname, '../config/streams.json');
        this.serverPorts = new Map();
        this.failureCount = new Map();
        this.activeViewers = new Map();
        this.autoStopTimers = new Map();
        this.manuallyStartedStreams = new Set();
        this.autoPlayStreams = new Set(); // 存储自动启停的流ID
        this.autoStartStreams = new Set(); // 存储自动启动的流ID
        this.streamRetries = new Map(); // 存储流的重试次数
        this.streamStatus = new Map(); // 存储流的状态

        // 1. 首先加载配置
        this.loadConfig();
        
        // 2. 加载流配置
        this.loadStreams();
        
        // 3. 加载自动配置
        this.loadAutoConfig();

        // 4. 确保目录存在
        this.ensureDirectories();

        // 5. 启动自动启动的流（使用Promise确保异步操作完成）
        this.initializeAutoStart();

        // ... 其他初始化代码 ...
    }

    // 加载配置
    loadConfig() {
        try {
            this.config = require('../config/config.json');
            logger.info(`Loaded config with version: ${this.config.version}`);
        } catch (error) {
            logger.error('Error loading config:', error);
            this.config = {
                version: process.env.APP_VERSION || 'unknown',
                server: {
                    host: 'localhost',
                    port: 3000
                },
                rtmp: {
                    pushServer: 'rtmp://ali.push.yximgs.com/live/',
                    pullServer: 'http://ali.hlspull.yximgs.com/live/'
                }
            };
        }
    }

    // 确保必要的目录存在
    ensureDirectories() {
        const dirs = [
            path.dirname(this.configPath),
            path.join(__dirname, '../streams'),
            path.join(__dirname, '../config')
        ];

        for (const dir of dirs) {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true, mode: 0o777 });
            } else {
                fs.chmodSync(dir, 0o777);
            }
        }
    }

    // 初始化自动启动流
    async initializeAutoStart() {
        try {
            logger.info('Initializing auto-start streams...');
            // 等待一段时间确保系统完全初始化
            await new Promise(resolve => setTimeout(resolve, 5000));

            const autoStartStreams = Array.from(this.autoStartStreams);
            logger.info(`Found ${autoStartStreams.length} auto-start streams`);

            for (const streamId of autoStartStreams) {
                try {
                    if (!this.streamProcesses.has(streamId)) {
                        logger.info(`Auto-starting stream: ${streamId}`);
                        this.manuallyStartedStreams.add(streamId);
                        await this.startStreaming(streamId, true);
                    }
                } catch (error) {
                    logger.error(`Error auto-starting stream ${streamId}:`, error);
                }
            }
            logger.info('Auto-start initialization completed');
        } catch (error) {
            logger.error('Error in initializeAutoStart:', error);
        }
    }

    // 修改 loadAutoConfig 方法
    loadAutoConfig() {
        try {
            const autoConfigPath = path.join(__dirname, '../config/auto_config.json');
            if (fs.existsSync(autoConfigPath)) {
                const data = fs.readFileSync(autoConfigPath, 'utf8');
                if (data.trim()) {
                    const config = JSON.parse(data);
                    this.autoPlayStreams = new Set(config.autoPlay || []);
                    this.autoStartStreams = new Set(config.autoStart || []);
                    logger.info(`Loaded auto config: ${this.autoStartStreams.size} auto-start streams`);
                } else {
                    this.createDefaultAutoConfig(autoConfigPath);
                }
            } else {
                this.createDefaultAutoConfig(autoConfigPath);
            }
        } catch (error) {
            logger.error('Error loading auto config:', error);
            this.createDefaultAutoConfig(path.join(__dirname, '../config/auto_config.json'));
        }
    }
}

module.exports = { StreamManager }; 
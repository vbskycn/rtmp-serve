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

    // 添加 loadStreams 方法
    loadStreams() {
        try {
            if (fs.existsSync(this.configPath)) {
                const data = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
                if (Array.isArray(data)) {
                    data.forEach(stream => {
                        if (stream.id) {
                            this.streams.set(stream.id, stream);
                        }
                    });
                }
                logger.info(`Loaded ${this.streams.size} streams from config`);
            } else {
                // 如果配置文件不存在，创建一个空的配置文件
                fs.writeFileSync(this.configPath, JSON.stringify([], null, 2));
                logger.info('Created empty streams config file');
            }
        } catch (error) {
            logger.error('Error loading streams:', error);
            // 如果加载失败，确保 streams 是空的 Map
            this.streams = new Map();
        }
    }

    // 添加保存流配置的方法
    async saveStreams() {
        try {
            const streamsArray = Array.from(this.streams.values());
            await fs.promises.writeFile(this.configPath, JSON.stringify(streamsArray, null, 2));
            logger.info(`Saved ${streamsArray.length} streams to config`);
            return true;
        } catch (error) {
            logger.error('Error saving streams:', error);
            return false;
        }
    }

    // 添加更新流配置的方法
    async updateStream(streamId, streamData) {
        try {
            const existingStream = this.streams.get(streamId);
            if (!existingStream) {
                throw new Error('Stream not found');
            }

            // 更新流配置
            const updatedStream = {
                ...existingStream,
                ...streamData,
                id: streamId // 确保 ID 不变
            };

            this.streams.set(streamId, updatedStream);
            await this.saveStreams();

            return {
                success: true,
                stream: updatedStream
            };
        } catch (error) {
            logger.error(`Error updating stream ${streamId}:`, error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // 添加流的方法
    async addStream(streamData) {
        try {
            if (this.streams.has(streamData.id)) {
                throw new Error('Stream ID already exists');
            }

            this.streams.set(streamData.id, streamData);
            await this.saveStreams();

            return {
                success: true,
                streamId: streamData.id
            };
        } catch (error) {
            logger.error('Error adding stream:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // 添加删除流的方法
    async deleteStream(streamId) {
        try {
            // 先停止流（如果正在运行）
            await this.stopStreaming(streamId);

            // 从所有集合中移除
            this.streams.delete(streamId);
            this.autoPlayStreams.delete(streamId);
            this.autoStartStreams.delete(streamId);
            this.manuallyStartedStreams.delete(streamId);
            this.streamStatus.delete(streamId);
            this.streamRetries.delete(streamId);

            // 保存配置
            await this.saveStreams();
            await this.saveAutoConfig();

            // 清理流的目录
            const streamDir = path.join(__dirname, '../streams', streamId);
            if (fs.existsSync(streamDir)) {
                fs.rmSync(streamDir, { recursive: true, force: true });
            }

            return { success: true };
        } catch (error) {
            logger.error(`Error deleting stream ${streamId}:`, error);
            return {
                success: false,
                error: error.message
            };
        }
    }
}

module.exports = { StreamManager }; 
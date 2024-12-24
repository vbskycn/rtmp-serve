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
        this.autoPlayStreams = new Set();
        this.autoStartStreams = new Set();
        this.streamRetries = new Map();
        this.streamStatus = new Map();

        // 加载配置
        this.loadConfig();
        
        // 加载流配置
        this.loadStreams();
        
        // 加载自动配置
        this.loadAutoConfig();

        // 初始化自动启动流
        setTimeout(() => {
            this.startAutoStartStreams();
        }, 5000);

        // 添加流量统计
        this.trafficStats = {
            received: 0,
            sent: 0,
            lastUpdate: Date.now()
        };

        // 添加重试相关的配置
        this.MAX_RETRIES = 3;        // 最大重试次数
        this.RETRY_DELAY = 3000;     // 重试间隔（毫秒）
        this.retryAttempts = new Map(); // 记录每个流的重试次数
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

    // 添加创建默认自动配置的方法
    createDefaultAutoConfig(autoConfigPath) {
        try {
            const defaultConfig = {
                autoPlay: [],
                autoStart: []
            };
            
            // 确保目录存在
            const configDir = path.dirname(autoConfigPath);
            if (!fs.existsSync(configDir)) {
                fs.mkdirSync(configDir, { recursive: true, mode: 0o777 });
            }
            
            // 写入默认配置
            fs.writeFileSync(autoConfigPath, JSON.stringify(defaultConfig, null, 2));
            logger.info('Created default auto config file');
            
            // 初始化集合
            this.autoPlayStreams = new Set();
            this.autoStartStreams = new Set();
        } catch (error) {
            logger.error('Error creating default auto config:', error);
            // 确保即使创建失败也有默认的空集合
            this.autoPlayStreams = new Set();
            this.autoStartStreams = new Set();
        }
    }

    // 修改 loadAutoConfig 方法，确保正确调用 createDefaultAutoConfig
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

    // 修改 loadStreams 方法
    loadStreams() {
        try {
            if (fs.existsSync(this.configPath)) {
                const data = fs.readFileSync(this.configPath, 'utf8');
                if (data.trim()) {
                    const streams = JSON.parse(data);
                    if (Array.isArray(streams)) {
                        streams.forEach(stream => {
                            if (stream.id) {
                                this.streams.set(stream.id, stream);
                            }
                        });
                    }
                    logger.info(`Loaded ${this.streams.size} streams from config`);
                } else {
                    logger.info('Streams config file is empty');
                }
            } else {
                logger.info('Creating empty streams config file');
                fs.writeFileSync(this.configPath, JSON.stringify([], null, 2));
            }
        } catch (error) {
            logger.error('Error loading streams:', error);
            // 如果加载失败，确保 streams 是空的 Map
            this.streams = new Map();
        }
    }

    // 修改 saveStreams 方法
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

    // 修改 saveAutoConfig 方法
    async saveAutoConfig() {
        try {
            const autoConfigPath = path.join(__dirname, '../config/auto_config.json');
            const data = {
                autoPlay: Array.from(this.autoPlayStreams),
                autoStart: Array.from(this.autoStartStreams)
            };
            await fs.promises.writeFile(autoConfigPath, JSON.stringify(data, null, 2));
            logger.info(`Saved auto config with ${this.autoStartStreams.size} auto-start streams`);
            return true;
        } catch (error) {
            logger.error('Error saving auto config:', error);
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

    // 修改 getStreamInfo 方法，简化状态检测逻辑
    async getStreamInfo(streamId) {
        try {
            const stream = this.streams.get(streamId);
            if (!stream) return null;

            const processInfo = this.streamProcesses.get(streamId);
            const status = this.streamStatus.get(streamId) || 'stopped';
            const isInvalid = this.retryAttempts.get(streamId) >= 3;

            // 检查进程是否在运行
            let isProcessRunning = false;
            if (processInfo && processInfo.ffmpeg) {
                try {
                    process.kill(processInfo.ffmpeg.pid, 0);
                    isProcessRunning = true && processInfo.streamStarted;
                } catch (e) {
                    isProcessRunning = false;
                    this.streamProcesses.delete(streamId);
                    this.manuallyStartedStreams.delete(streamId);
                    this.streamStatus.set(streamId, 'stopped');
                }
            }

            // 确定最终状态
            let finalStatus;
            if (isInvalid) {
                finalStatus = 'invalid';
            } else if (isProcessRunning && status === 'running') {
                finalStatus = 'running';
            } else {
                finalStatus = 'stopped';
            }

            // 推流状态只有在进程运行且是手动启动的情况下才为 true
            const isRtmpActive = isProcessRunning && 
                               processInfo?.isManualStart && 
                               this.manuallyStartedStreams.has(streamId);

            return {
                ...stream,
                processRunning: isProcessRunning,
                manuallyStarted: this.manuallyStartedStreams.has(streamId),
                autoStart: this.autoStartStreams.has(streamId),
                autoPlay: this.autoPlayStreams.has(streamId),
                stats: this.streamStats.get(streamId) || {},
                status: finalStatus,
                isRtmpActive: isRtmpActive,
                invalid: isInvalid
            };
        } catch (error) {
            logger.error(`Error getting stream info for ${streamId}:`, error);
            return null;
        }
    }

    // 添加启动流的方法
    async startStreaming(streamId, isRtmpPush = false) {
        try {
            const stream = this.streams.get(streamId);
            if (!stream) {
                throw new Error('Stream not found');
            }

            // 更新流状态
            this.streamStatus.set(streamId, 'starting');
            this.emit('streamStatusChanged', streamId, 'starting');

            // 如果是推流模式，标记为手动启动
            if (isRtmpPush) {
                this.manuallyStartedStreams.add(streamId);
            }

            const result = await this.startStreamingWithFFmpeg(streamId, stream, isRtmpPush);
            
            if (result && !result.success) {
                throw new Error(result.error);
            }

            // 更新状态为运行中
            this.streamStatus.set(streamId, 'running');
            this.emit('streamStatusChanged', streamId, 'running');
            
            return { success: true };
        } catch (error) {
            logger.error(`Error starting stream ${streamId}:`, error);
            return { success: false, error: error.message };
        }
    }

    // 修改 startAutoStartStreams 方法，改进错误处理
    async startAutoStartStreams() {
        logger.info(`Starting auto-start streams, count: ${this.autoStartStreams.size}`);
        for (const streamId of this.autoStartStreams) {
            try {
                if (!this.streamProcesses.has(streamId)) {
                    logger.info(`Auto-starting stream: ${streamId}`);
                    const result = await this.startStreaming(streamId, true);
                    if (!result.success) {
                        // 如果启动失败，从自动启动列表中移除
                        this.autoStartStreams.delete(streamId);
                        await this.saveAutoConfig();
                        logger.error(`Removed ${streamId} from auto-start list due to start failure`);
                    }
                }
            } catch (error) {
                // 如果出错，从自动启动列表中移除
                this.autoStartStreams.delete(streamId);
                await this.saveAutoConfig();
                logger.error(`Error auto-starting stream ${streamId}, removed from auto-start list:`, error);
            }
        }
    }

    // 修改 startStreamingWithFFmpeg 方法中的错误处理
    async startStreamingWithFFmpeg(streamId, streamConfig, isRtmpPush = false) {
        try {
            // 检查重试次数
            const attempts = this.retryAttempts.get(streamId) || 0;
            if (attempts >= this.MAX_RETRIES) {
                logger.error(`Stream ${streamId} marked as invalid after ${attempts} retries`);
                this.retryAttempts.delete(streamId);
                throw new Error(`Stream failed after ${attempts} retries`);
            }

            // 更新重试计数
            this.retryAttempts.set(streamId, attempts + 1);

            // 确保输出目录存在
            const outputPath = path.join(__dirname, '../streams', streamId);
            if (!fs.existsSync(outputPath)) {
                fs.mkdirSync(outputPath, { recursive: true, mode: 0o777 });
            }

            // 设置 FFmpeg 参数
            const args = [
                '-i', streamConfig.url,
                // HLS 输出
                '-c:v', 'copy',
                '-c:a', 'aac',
                '-ar', '44100',
                '-hls_time', '10',
                '-hls_list_size', '6',
                '-hls_flags', 'delete_segments',
                '-hls_segment_filename', path.join(outputPath, 'segment_%d.ts'),
                path.join(outputPath, 'playlist.m3u8')
            ];

            // 如果是推流模式，添加RTMP输出
            if (isRtmpPush) {
                args.push(
                    '-c:v', 'copy',
                    '-c:a', 'aac',
                    '-f', 'flv',
                    `${this.config.rtmp.pushServer}${streamId}`
                );
            }

            return new Promise((resolve, reject) => {
                try {
                    const ffmpeg = spawn('ffmpeg', args);
                    let ffmpegError = '';
                    let hasStarted = false;
                    let consecutiveErrors = 0;
                    let streamStarted = false;
                    const MAX_SEGMENT_ERRORS = 3;

                    ffmpeg.stderr.on('data', (data) => {
                        const message = data.toString();
                        
                        // 检测分片错误
                        if (message.includes('Failed to open segment')) {
                            consecutiveErrors++;
                            logger.error(`FFmpeg stderr: ${message}`);
                            
                            if (consecutiveErrors >= MAX_SEGMENT_ERRORS) {
                                logger.error(`Stream ${streamId} failed to get segments after ${consecutiveErrors} attempts, stopping...`);
                                // 清理所有状态
                                this.cleanupStream(streamId);
                                ffmpeg.kill('SIGTERM');
                                reject(new Error('Failed to get stream segments'));
                                return;
                            }
                        } 
                        // 检测 HTTP 404 错误
                        else if (message.includes('HTTP error 404')) {
                            logger.error(`Stream ${streamId} received HTTP 404 error, stopping...`);
                            this.cleanupStream(streamId);
                            ffmpeg.kill('SIGTERM');
                            reject(new Error('Stream source returned 404'));
                            return;
                        }
                        // 检测其他严重错误
                        else if (message.includes('Error') || 
                                message.includes('Invalid')) {
                            logger.error(`FFmpeg stderr: ${message}`);
                            ffmpegError += message;
                            
                            // 对于严重错误，立即停止
                            if (message.includes('Server error') || 
                                message.includes('Invalid data found') ||
                                message.includes('Operation not permitted') ||
                                message.includes('Connection reset by peer')) {
                                this.cleanupStream(streamId);
                                ffmpeg.kill('SIGTERM');
                                reject(new Error(message));
                                return;
                            }
                        }
                        // 检测成功的标志
                        else if (message.includes('Opening') || 
                                message.includes('Stream mapping')) {
                            consecutiveErrors = 0;
                            if (!streamStarted) {
                                streamStarted = true;
                                this.streamStatus.set(streamId, 'running');
                                if (isRtmpPush) {
                                    this.manuallyStartedStreams.add(streamId);
                                }
                            }
                        }
                    });

                    ffmpeg.on('exit', (code, signal) => {
                        if (code !== 0 && !signal) {
                            // 非正常退出且不是手动停止
                            logger.error(`Stream ${streamId} exited with code ${code}`);
                            this.cleanupStream(streamId);
                            reject(new Error(`FFmpeg exited with code ${code}`));
                        } else if (signal === 'SIGTERM') {
                            // 手动停止
                            logger.info(`Stream ${streamId} manually stopped`);
                            this.cleanupStream(streamId);
                            resolve({ success: true });
                        }
                    });

                    // 等待流启动
                    setTimeout(() => {
                        try {
                            process.kill(ffmpeg.pid, 0);
                            if (streamStarted) {
                                const processInfo = this.streamProcesses.get(streamId);
                                if (processInfo) {
                                    processInfo.streamStarted = true;
                                }
                                resolve({ success: true });
                            } else {
                                this.cleanupStream(streamId);
                                ffmpeg.kill('SIGTERM');
                                reject(new Error('Stream failed to start properly'));
                            }
                        } catch (e) {
                            this.cleanupStream(streamId);
                            reject(new Error('Process exited before initialization completed'));
                        }
                    }, 3000);

                } catch (error) {
                    this.cleanupStream(streamId);
                    reject(error);
                }
            });
        } catch (error) {
            this.cleanupStream(streamId);
            throw error;
        }
    }

    // 添加清理流状态的辅助方法
    cleanupStream(streamId) {
        this.streamProcesses.delete(streamId);
        this.manuallyStartedStreams.delete(streamId);
        this.streamStatus.set(streamId, 'stopped');
        // 如果是自动启动的流，从列表中移除
        if (this.autoStartStreams.has(streamId)) {
            this.autoStartStreams.delete(streamId);
            this.saveAutoConfig().catch(err => {
                logger.error(`Error saving auto config after cleanup: ${err}`);
            });
        }
    }

    // 添加停止流的方法
    async stopStreaming(streamId) {
        try {
            const processInfo = this.streamProcesses.get(streamId);
            if (processInfo) {
                const { ffmpeg } = processInfo;
                ffmpeg.kill('SIGTERM');
                
                // 等待进程完全退出
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                // 如果进程还在运行，强制结束
                if (ffmpeg.exitCode === null) {
                    ffmpeg.kill('SIGKILL');
                }
                
                this.streamProcesses.delete(streamId);
                this.manuallyStartedStreams.delete(streamId);
                this.streamStatus.set(streamId, 'stopped');
                
                logger.info(`Stream stopped: ${streamId}`);
                return true;
            }
            return false;
        } catch (error) {
            logger.error(`Error stopping stream ${streamId}:`, error);
            return false;
        }
    }

    // 添加获取流量统计的方法
    getTrafficStats() {
        return {
            received: this.formatBytes(this.trafficStats.received),
            sent: this.formatBytes(this.trafficStats.sent),
            lastUpdate: this.trafficStats.lastUpdate
        };
    }

    // 添加格式化字节的辅助方法
    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
}

module.exports = { StreamManager }; 
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
        this.logger = logger;
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

        // 添加 streams 目录路径
        this.streamsPath = path.join(__dirname, '../streams');
        
        // 确保 streams 目录存在
        if (!fs.existsSync(this.streamsPath)) {
            fs.mkdirSync(this.streamsPath, { recursive: true });
        }

        // 初始化全局统计信息
        this.globalStats = {
            traffic: {
                received: '0 B',
                sent: '0 B'
            }
        };

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

        // 添加启动时间记录
        this.startTime = Date.now();

        // 启动流量统计更新定时器
        setInterval(() => this.updateTrafficStats(), 5000);
    }

    // 加载配置
    loadConfig() {
        try {
            this.config = require('../config/config.json');
            
            // 如果配置中的 host 是 auto，则尝试获取实际 IP
            if (this.config.server.host === 'auto') {
                // 这里先设置一个默认值，实际 IP 会在服务启动时通过 API 更新
                this.config.server.host = process.env.SERVER_HOST || 'localhost';
            }
            
            logger.info(`Loaded config with version: ${this.config.version}`);
        } catch (error) {
            logger.error('Error loading config:', error);
            this.config = {
                version: process.env.APP_VERSION || 'unknown',
                server: {
                    host: process.env.SERVER_HOST || 'localhost',
                    port: process.env.SERVER_PORT || 3000
                },
                rtmp: {
                    pushServer: process.env.RTMP_PUSH_SERVER || 'rtmp://ali.push.yximgs.com/live/',
                    pullServer: process.env.RTMP_PULL_SERVER || 'http://ali.hlspull.yximgs.com/live/'
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

    // 修改 getStreamInfo 方法
    async getStreamInfo(streamId) {
        try {
            const stream = this.streams.get(streamId);
            if (!stream) return null;

            const processInfo = this.streamProcesses.get(streamId);
            const status = this.streamStatus.get(streamId) || 'stopped';
            
            let finalStatus = 'stopped';
            let statusReason = '';
            let isRtmpActive = false;

            if (processInfo && processInfo.ffmpeg) {
                try {
                    // 检查进程是否存活
                    process.kill(processInfo.ffmpeg.pid, 0);
                    
                    // 检查拉流和推流状态
                    if (processInfo.pullStreamStarted && processInfo.pushStreamStarted) {
                        // 检查最后一帧时间
                        const timeSinceLastFrame = Date.now() - processInfo.lastFrameTime;
                        
                        if (timeSinceLastFrame > 10000) { // 10秒没有新帧
                            finalStatus = 'unhealthy';
                            statusReason = `${Math.floor(timeSinceLastFrame / 1000)}秒未收到新帧`;
                        } else {
                            finalStatus = 'running';
                            statusReason = `正常运行中(${processInfo.frameCount || 0}帧)`;
                            isRtmpActive = true;
                        }
                    } else if (processInfo.pullStreamStarted) {
                        finalStatus = 'starting';
                        statusReason = '推流初始化中';
                    } else {
                        finalStatus = 'starting';
                        statusReason = '拉流初始化中';
                    }
                } catch (e) {
                    finalStatus = 'stopped';
                    statusReason = '进程已停止';
                    this.streamProcesses.delete(streamId);
                }
            }

            return {
                ...stream,
                processRunning: finalStatus === 'running',
                status: finalStatus,
                statusReason,
                isRtmpActive,
                stats: processInfo ? {
                    frameCount: processInfo.frameCount || 0,
                    lastFrameTime: processInfo.lastFrameTime,
                    pullStreamStarted: processInfo.pullStreamStarted,
                    pushStreamStarted: processInfo.pushStreamStarted
                } : null,
                autoStart: this.autoStartStreams.has(streamId)
            };
        } catch (error) {
            logger.error(`[${streamId}] Error getting stream info:`, error);
            return null;
        }
    }

    // 添加检查 HLS 状态的方法
    async checkHlsStatus(streamId) {
        try {
            const playlistPath = path.join(__dirname, '../streams', streamId, 'playlist.m3u8');
            if (!fs.existsSync(playlistPath)) {
                return false;
            }

            // 检查文件最后修改时间
            const stats = fs.statSync(playlistPath);
            const fileAge = Date.now() - stats.mtimeMs;
            
            // 如果文件在最近30秒内有更新，认为是活跃的
            if (fileAge < 30000) {
                return true;
            }

            // 检查最新的 ts 文件
            const streamDir = path.join(__dirname, '../streams', streamId);
            const files = fs.readdirSync(streamDir);
            const tsFiles = files.filter(f => f.endsWith('.ts'));
            
            if (tsFiles.length > 0) {
                const latestTs = tsFiles.sort().pop();
                const tsStats = fs.statSync(path.join(streamDir, latestTs));
                const tsAge = Date.now() - tsStats.mtimeMs;
                
                // 如果最新的ts文件在30秒内有更新，认为是活跃的
                return tsAge < 30000;
            }

            return false;
        } catch (error) {
            logger.error(`Error checking HLS status for ${streamId}:`, error);
            return false;
        }
    }

    // 添加启动流的方法
    async startStreaming(streamId, isRtmpPush = false) {
        try {
            const stream = this.streams.get(streamId);
            if (!stream) {
                throw new Error('Stream not found');
            }

            // 检查流是否已经在运行
            if (this.streamProcesses.has(streamId)) {
                logger.debug(`[${streamId}] Stream already running`);
                return { success: true };
            }

            // 更新流状态
            this.streamStatus.set(streamId, 'starting');
            this.emit('streamStatusChanged', streamId, 'starting');

            // 如果是推流模式，标记为手动启动
            if (isRtmpPush) {
                this.manuallyStartedStreams.add(streamId);
            }

            // 启动流
            const result = await this.startStreamingWithFFmpeg(streamId, stream);
            
            if (!result.success) {
                this.streamStatus.set(streamId, 'error');
                throw new Error(result.error || 'Failed to start stream');
            }

            // 更新状态为运行中
            this.streamStatus.set(streamId, 'running');
            this.emit('streamStatusChanged', streamId, 'running');
            
            return { success: true };
        } catch (error) {
            logger.error(`Error starting stream ${streamId}:`, error);
            // 清理任何可能的残留进程
            await this.cleanupStream(streamId);
            return { 
                success: false, 
                error: error.message 
            };
        }
    }

    // 修改 startAutoStartStreams 方法
    async startAutoStartStreams() {
        try {
            const autoStartStreams = Array.from(this.autoStartStreams);
            logger.info(`Starting auto-start streams, count: ${autoStartStreams.length}`);
            
            // 创建一个 Map 来跟踪启动尝试
            const startAttempts = new Map();
            
            // 使用 Promise.all 并行启动所有流
            await Promise.all(autoStartStreams.map(async (streamId) => {
                try {
                    // 检查是否已经在运行
                    if (this.streamProcesses.has(streamId)) {
                        logger.debug(`[${streamId}] Stream already running, skipping`);
                        return;
                    }
                    
                    // 检查启动尝试次数
                    const attempts = startAttempts.get(streamId) || 0;
                    if (attempts >= this.MAX_RETRIES) {
                        logger.error(`[${streamId}] Exceeded maximum retry attempts`);
                        return;
                    }
                    
                    startAttempts.set(streamId, attempts + 1);
                    
                    // 启动流
                    logger.info(`Auto-starting stream: ${streamId}`);
                    const result = await this.startStreaming(streamId, true);
                    
                    if (!result.success) {
                        logger.error(`[${streamId}] Failed to start: ${result.error}`);
                    } else {
                        logger.info(`[${streamId}] Auto-start successful`);
                    }
                } catch (error) {
                    logger.error(`Error auto-starting stream ${streamId}:`, error);
                }
            }));
            
            // 记录启动结果
            const runningCount = Array.from(this.streamProcesses.keys()).length;
            logger.info(`Auto-start completed. Running streams: ${runningCount}`);
            
        } catch (error) {
            logger.error('Error in startAutoStartStreams:', error);
        }
    }

    // 添加检查流源地址有效性的方法
    async checkStreamSource(url) {
        try {
            logger.debug(`Checking stream source: ${url}`);
            const response = await fetch(url, {
                method: 'HEAD',
                timeout: 5000
            }).catch(() => null);

            if (!response) {
                logger.warn(`Stream source not accessible: ${url}`);
                return false;
            }

            // 检查响应状态和内容类型
            const contentType = response.headers.get('content-type');
            const isValid = response.ok && (
                contentType?.includes('video') ||
                contentType?.includes('application/octet-stream') ||
                contentType?.includes('application/x-mpegURL') ||
                contentType?.includes('application/vnd.apple.mpegurl')
            );

            logger.debug(`Stream source check result: ${isValid}, content-type: ${contentType}`);
            return isValid;
        } catch (error) {
            logger.error(`Error checking stream source: ${error.message}`);
            return false;
        }
    }

    // 修改 startStreamingWithFFmpeg 方法
    async startStreamingWithFFmpeg(streamId, streamConfig) {
        try {
            logger.info(`[${streamId}] Starting stream with FFmpeg...`);
            
            // 检查源地址有效性
            const isSourceValid = await this.checkStreamSource(streamConfig.url);
            if (!isSourceValid) {
                logger.error(`[${streamId}] Stream source is invalid: ${streamConfig.url}`);
                this.streamStatus.set(streamId, 'invalid');
                throw new Error('Stream source is invalid or not accessible');
            }

            // 检查流是否已经在运行
            if (this.streamProcesses.has(streamId)) {
                logger.warn(`[${streamId}] Stream process already exists, stopping old process`);
                await this.stopStreaming(streamId);
            }

            const args = [
                '-i', streamConfig.url,
                '-c:v', 'copy',
                '-c:a', 'aac',
                '-f', 'flv',
                `${this.config.rtmp.pushServer}${streamId}`
            ];

            return new Promise((resolve, reject) => {
                try {
                    const ffmpeg = spawn('ffmpeg', args);
                    let pullStreamStarted = false;  // 拉流是否成功
                    let pushStreamStarted = false;  // 推流是否成功
                    let errorMessages = [];
                    let lastFrameTime = Date.now();
                    let frameCount = 0;
                    let ffmpegOutput = '';

                    ffmpeg.stderr.on('data', (data) => {
                        const message = data.toString();
                        ffmpegOutput += message;
                        logger.debug(`[${streamId}] FFmpeg output: ${message.trim()}`);

                        // 检测拉流成功
                        if (!pullStreamStarted && (
                            message.includes('Input #0') || 
                            message.includes('Duration:') ||
                            message.includes('Stream #0')
                        )) {
                            pullStreamStarted = true;
                            logger.info(`[${streamId}] Pull stream successful`);
                        }

                        // 检测推流成功
                        if (pullStreamStarted && !pushStreamStarted && (
                            message.includes('Output #0') ||
                            message.includes('frame=') ||
                            message.includes('speed=')
                        )) {
                            pushStreamStarted = true;
                            logger.info(`[${streamId}] Push stream successful`);
                            
                            // 只有在拉流和推流都成功时，才更新进程信息
                            this.streamProcesses.set(streamId, {
                                ffmpeg,
                                pullStreamStarted,
                                pushStreamStarted,
                                frameCount,
                                lastFrameTime,
                                startTime: Date.now()
                            });
                            
                            // 更新状态为运行中
                            this.streamStatus.set(streamId, 'running');
                        }

                        // 更新帧计数
                        const frameMatch = message.match(/frame=\s*(\d+)/);
                        if (frameMatch) {
                            frameCount = parseInt(frameMatch[1]);
                            lastFrameTime = Date.now();
                            
                            // 更新进程信息中的帧计数
                            const processInfo = this.streamProcesses.get(streamId);
                            if (processInfo) {
                                processInfo.frameCount = frameCount;
                                processInfo.lastFrameTime = lastFrameTime;
                            }
                        }

                        // 检测错误
                        if (message.includes('Error') || 
                            message.includes('Invalid') || 
                            message.includes('Could not') ||
                            message.includes('Failed to')) {
                            errorMessages.push(message.trim());
                            logger.error(`[${streamId}] Error detected: ${message.trim()}`);
                            
                            // 如果是致命错误，立即停止
                            if (message.includes('Connection refused') ||
                                message.includes('No such file or directory') ||
                                message.includes('Invalid data found') ||
                                message.includes('Server returned 404') ||
                                message.includes('Unable to open resource')) {
                                
                                this.streamStatus.set(streamId, 'error');
                                ffmpeg.kill('SIGTERM');
                                reject(new Error(message.trim()));
                            }
                        }
                    });

                    ffmpeg.on('exit', (code, signal) => {
                        const timeSinceLastFrame = Date.now() - lastFrameTime;
                        logger.info(`[${streamId}] FFmpeg process exited with code ${code}, signal: ${signal}`);
                        logger.debug(`[${streamId}] Final status - Pull: ${pullStreamStarted}, Push: ${pushStreamStarted}, Frames: ${frameCount}`);

                        if (code !== 0 || !pullStreamStarted || !pushStreamStarted) {
                            const error = errorMessages.length > 0 ? 
                                errorMessages.join('\n') : 
                                'Stream failed to start properly';
                                
                            logger.error(`[${streamId}] Stream failed: ${error}`);
                            this.streamStatus.set(streamId, 'error');
                            this.cleanupStream(streamId);
                            reject(new Error(error));
                        } else {
                            this.cleanupStream(streamId);
                            resolve({ success: true });
                        }
                    });

                } catch (error) {
                    logger.error(`[${streamId}] Error in FFmpeg process:`, error);
                    reject(error);
                }
            });
        } catch (error) {
            logger.error(`[${streamId}] Error in startStreamingWithFFmpeg:`, error);
            throw error;
        }
    }

    // 修改 cleanupStream 方法
    async cleanupStream(streamId) {
        try {
            const processInfo = this.streamProcesses.get(streamId);
            if (processInfo) {
                try {
                    if (processInfo.ffmpeg && processInfo.ffmpeg.pid) {
                        process.kill(processInfo.ffmpeg.pid, 'SIGKILL');
                        // 等待进程完全退出
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                } catch (error) {
                    logger.debug(`[${streamId}] Error killing process: ${error.message}`);
                }
            }
            
            this.streamProcesses.delete(streamId);
            this.streamStatus.set(streamId, 'stopped');
            logger.debug(`[${streamId}] Stream cleaned up`);
        } catch (error) {
            logger.error(`[${streamId}] Error in cleanupStream:`, error);
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

    // 修改获取系统统计信息的方法
    async getSystemStats() {
        try {
            // 计算运行时间（毫秒）
            const uptime = Date.now() - this.startTime;

            // 获取活跃流数量
            const activeStreams = Array.from(this.streamProcesses.entries())
                .filter(([_, info]) => info && info.streamStarted)
                .length;

            return {
                totalStreams: this.streams.size,
                activeStreams,
                uptime,  // 返回原始毫秒值，让前端处理格式化
                traffic: this.getTrafficStats()
            };
        } catch (error) {
            logger.error('Error getting system stats:', error);
            throw error;
        }
    }

    // 添加更新流量统计的方法
    async updateTrafficStats() {
        try {
            // 获取所有流
            const streams = await this.getAllStreams();
            
            for (const stream of streams) {
                const streamPath = path.join(this.streamsPath, stream.id);
                
                try {
                    // 检查目录是否存在
                    const exists = await fs.access(streamPath)
                        .then(() => true)
                        .catch(() => false);
                    
                    if (!exists) {
                        // 如果目录不存在但流还在运行，可能需要创建目录
                        if (stream.processRunning) {
                            await fs.mkdir(streamPath, { recursive: true });
                        }
                        continue; // 跳过这个流的统计
                    }

                    // 读取目录内容
                    const files = await fs.readdir(streamPath);
                    
                    // 计算目录大小
                    let totalSize = 0;
                    for (const file of files) {
                        const filePath = path.join(streamPath, file);
                        try {
                            const stats = await fs.stat(filePath);
                            totalSize += stats.size;
                        } catch (err) {
                            // 忽略单个文件的错误
                            this.logger.debug(`Error getting file stats for ${filePath}: ${err.message}`);
                        }
                    }

                    // 更新流的统计信息
                    if (!this.trafficStats[stream.id]) {
                        this.trafficStats[stream.id] = {
                            received: 0,
                            sent: 0,
                            lastUpdate: Date.now()
                        };
                    }

                    const timeDiff = (Date.now() - this.trafficStats[stream.id].lastUpdate) / 1000; // 转换为秒
                    if (timeDiff > 0) {
                        const bytesPerSecond = totalSize / timeDiff;
                        this.trafficStats[stream.id].received = bytesPerSecond;
                        this.trafficStats[stream.id].sent = bytesPerSecond;
                        this.trafficStats[stream.id].lastUpdate = Date.now();
                    }

                } catch (err) {
                    // 将错误级别改为debug，因为这可能是正常的情况（流已停止）
                    this.logger.debug(`Error updating traffic stats for stream ${stream.id}: ${err.message}`);
                }
            }

            // 计算总流量
            let totalReceived = 0;
            let totalSent = 0;
            Object.values(this.trafficStats).forEach(stats => {
                totalReceived += stats.received;
                totalSent += stats.sent;
            });

            // 更新全局统计信息
            this.globalStats.traffic = {
                received: this.formatBytes(totalReceived),
                sent: this.formatBytes(totalSent)
            };

        } catch (err) {
            this.logger.error('Error updating global traffic stats:', err);
        }
    }

    // 修改格式化运行时间的方法
    formatUptime(ms) {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) {
            return `${days}天${hours % 24}小时${minutes % 60}分`;
        } else if (hours > 0) {
            return `${hours}小时${minutes % 60}分${seconds % 60}秒`;
        } else if (minutes > 0) {
            return `${minutes}分${seconds % 60}秒`;
        } else {
            return `${seconds}秒`;
        }
    }

    // 修改获取流量统计的方法
    getTrafficStats() {
        const stats = {
            received: this.formatBytes(this.trafficStats.received),
            sent: this.formatBytes(this.trafficStats.sent),
            lastUpdate: this.trafficStats.lastUpdate
        };
        return stats;
    }

    // 修改格式化字节的方法
    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    // 修改自启动配置的方法
    async updateAutoStart(streamId, enable) {
        try {
            if (enable) {
                this.autoStartStreams.add(streamId);
            } else {
                this.autoStartStreams.delete(streamId);
            }
            
            // 保存配置
            await this.saveAutoConfig();
            
            return { success: true };
        } catch (error) {
            logger.error(`Error updating auto-start config for stream: ${streamId}`, error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // 修改批量设置自启动的方法
    async batchUpdateAutoStart(streamIds, enable) {
        try {
            let successCount = 0;
            const errors = [];

            for (const streamId of streamIds) {
                try {
                    // 检查流是否存在
                    if (!this.streams.has(streamId)) {
                        errors.push(`流 ${streamId} 不存在`);
                        continue;
                    }

                    // 更新自启动状态
                    if (enable) {
                        this.autoStartStreams.add(streamId);
                    } else {
                        this.autoStartStreams.delete(streamId);
                    }
                    successCount++;
                } catch (error) {
                    errors.push(`流 ${streamId}: ${error.message}`);
                }
            }
            
            // 保存配置
            await this.saveAutoConfig();
            
            return { 
                success: true,
                stats: {
                    total: streamIds.length,
                    success: successCount,
                    errors: errors
                }
            };
        } catch (error) {
            logger.error('Error in batch auto-start update:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // 添加 getAllStreams 方法
    async getAllStreams() {
        try {
            // 将 Map 转换为数组并添加额外信息
            const streams = Array.from(this.streams.entries()).map(([id, stream]) => {
                const processInfo = this.streamProcesses.get(id);
                const status = this.streamStatus.get(id) || 'stopped';
                const retries = this.retryAttempts.get(id) || 0;
                
                return {
                    ...stream,
                    id,
                    processRunning: processInfo?.streamStarted || false,
                    status,
                    retryCount: retries,
                    autoStart: this.autoStartStreams.has(id)
                };
            });
            
            return streams;
        } catch (error) {
            this.logger.error('Error getting all streams:', error);
            return [];
        }
    }

    // 添加更详细的流状态检查方法
    checkStreamStatus(streamId) {
        const stream = this.streams.get(streamId);
        if (!stream) return { status: 'invalid', message: '流不存在' };

        // 检查进程状态
        const processRunning = stream.process && !stream.process.killed;
        
        // 检查最近的错误记录
        const hasRecentError = stream.lastError && 
            (Date.now() - stream.lastError.timestamp < 5000); // 5秒内的错误

        // 检查流的健康状态
        const isHealthy = stream.stats && 
            stream.stats.frames > 0 && 
            Date.now() - stream.stats.lastFrameTime < 10000; // 10秒内有新帧

        if (!processRunning) {
            return { 
                status: 'stopped',
                message: '已停止',
                processRunning: false
            };
        }

        if (hasRecentError) {
            return {
                status: 'error',
                message: stream.lastError.message,
                processRunning: true,
                error: stream.lastError
            };
        }

        if (!isHealthy) {
            return {
                status: 'unhealthy',
                message: '流可能已失效',
                processRunning: true
            };
        }

        return {
            status: 'running',
            message: '运行中',
            processRunning: true,
            stats: stream.stats
        };
    }

    // 修改启动流的方法，添加错误处理
    async startStream(streamId) {
        const stream = this.streams.get(streamId);
        if (!stream) throw new Error('Stream not found');

        // 重置错误状态
        stream.lastError = null;
        
        // 添加错误监听
        stream.process.on('error', (error) => {
            stream.lastError = {
                message: error.message,
                timestamp: Date.now()
            };
            logger.error(`Stream ${streamId} error: ${error.message}`);
        });

        stream.process.on('exit', (code) => {
            if (code !== 0) {
                stream.lastError = {
                    message: `进程退出，代码: ${code}`,
                    timestamp: Date.now()
                };
                logger.error(`Stream ${streamId} exited with code ${code}`);
            }
        });

        // 添加流状态监控
        this.monitorStream(stream);
    }

    // 添加流监控方法
    monitorStream(stream) {
        const streamId = stream.id;
        const statsInterval = setInterval(() => {
            const processInfo = this.streamProcesses.get(streamId);
            if (!processInfo || !processInfo.ffmpeg) {
                logger.debug(`[${streamId}] Stream process not found, clearing monitor`);
                clearInterval(statsInterval);
                return;
            }

            try {
                // 检查进程是否还在运行
                process.kill(processInfo.ffmpeg.pid, 0);
                
                // 检查最后一帧的时间
                const timeSinceLastFrame = Date.now() - processInfo.lastFrameTime;
                logger.debug(`[${streamId}] Monitor check - Frame count: ${processInfo.frameCount}, Time since last frame: ${timeSinceLastFrame}ms`);

                if (timeSinceLastFrame > 30000) { // 30秒没有新帧
                    logger.warn(`[${streamId}] Stream appears to be stalled - No new frames for ${timeSinceLastFrame}ms`);
                    this.streamStatus.set(streamId, 'unhealthy');
                }
            } catch (error) {
                logger.error(`[${streamId}] Error in stream monitor:`, error);
                this.cleanupStream(streamId);
                clearInterval(statsInterval);
            }
        }, 5000); // 每5秒检查一次
    }
}

module.exports = { StreamManager }; 
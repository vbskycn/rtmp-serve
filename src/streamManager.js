const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const logger = require('./utils/logger');
const axios = require('axios');
const EventEmitter = require('events');
const config = require('../config/config.json');

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
        this.config = config;  // 保存配置引用
        this.autoPlayStreams = new Set(); // 存储自动启停的流ID
        this.autoStartStreams = new Set(); // 存储自动启动的流ID
        this.streamRetries = new Map(); // 存储流的重试次数
        this.streamStatus = new Map(); // 存储流的状态
        
        // 修改配置加载逻辑
        try {
            // 首先尝试从环境变量获取版本号
            const envVersion = process.env.APP_VERSION;
            
            // 加载配置文件
            this.config = require('../config/config.json');
            
            // 如果环境变量中有版本号，优先使用环境变量的版本号
            if (envVersion && envVersion !== 'latest') {
                this.config.version = envVersion;
            }
            
            // 确保版本号存在
            if (!this.config.version) {
                this.config.version = 'unknown';
            }
            
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
        
        // 创建配置目录
        const configDir = path.dirname(this.configPath);
        if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true });
        }
        
        // 加载保存的流配置
        this.loadStreams();
        
        // 所有流默认自动启停
        for (const [id] of this.streams) {
            this.autoPlayStreams.add(id);
        }
        
        // 保存自动配置
        this.saveAutoConfig();
        
        // 每小时运行一次清理
        setInterval(() => this.cleanupUnusedFiles(), 60 * 60 * 1000);
        // 每5分钟运行一次健康检查
        setInterval(() => this.checkStreamsHealth(), 5 * 60 * 1000);
        
        // 修改流量统计初始化
        this.startTime = Date.now();
        this.totalTraffic = {
            sent: 0n,
            received: 0n
        };
        
        // 加载已保存的统计数据，但只加载流量数据，不加载启动时间
        this.loadStats();
        
        // 每秒更新流量统计
        setInterval(() => {
            this.updateTrafficStats();
            this.updateStats();
            this.emit('statsUpdated', this.getTrafficStats());
        }, 1000);
        
        // 每10秒存统计数据
        setInterval(() => {
            this.saveStats();
        }, 10000);
        
        // 直接配置心跳
        this.heartbeatConfig = {
            enabled: true,
            server: 'http://rtmp-serve.zhoujie218.top/api/heartbeat',  // 默认使用本机地址
            interval: 300000,  // 5分钟
            serverName: require('os').hostname()  // 使用主机名作为服务器标识
        };

        // 启动心跳
        if (this.heartbeatConfig.enabled) {
            this.startHeartbeat();
        }

        // 在 constructor 中添加调试日志
        logger.info('Environment version:', process.env.APP_VERSION);
        logger.info('Config file version:', require('../config/config.json').version);
        logger.info('Final config version:', this.config.version);

        // 加载保存的自动配置
        this.loadAutoConfig();
        
        // 如果是自动启动的流，在服务器启动时就开始
        setTimeout(() => {
            this.startAutoStartStreams();
        }, 5000); // 延迟5秒启动，等待系统初始化

        // 确保streams目录存在且有正确的权限
        const streamsDir = path.join(__dirname, '../streams');
        if (!fs.existsSync(streamsDir)) {
            fs.mkdirSync(streamsDir, { recursive: true, mode: 0o777 });
        } else {
            fs.chmodSync(streamsDir, 0o777);
        }
    }

    // 加载保存的流配置
    loadStreams() {
        try {
            if (fs.existsSync(this.configPath)) {
                const data = fs.readFileSync(this.configPath, 'utf8');
                const configs = JSON.parse(data);
                for (const [id, config] of Object.entries(configs)) {
                    this.streams.set(id, {
                        ...config,
                        stats: {
                            startTime: null,
                            uptime: 0,
                            errors: 0
                        }
                    });
                    this.streamStats.set(id, {
                        totalRequests: 0,
                        lastAccessed: null,
                        errors: 0,
                        uptime: 0,
                        startTime: null
                    });
                }
                logger.info(`Loaded ${this.streams.size} streams from config`);
            }
        } catch (error) {
            logger.error('Error loading streams config:', error);
        }
    }

    // 保存流配置
    async saveStreams() {
        try {
            const configs = {};
            for (const [id, config] of this.streams.entries()) {
                // 确保保存完整的流配置
                configs[id] = {
                    id: config.id,
                    name: config.name,
                    url: config.url,
                    category: config.category || '未分类',
                    kodiprop: config.kodiprop || '',
                    tvg: config.tvg || {
                        id: '',
                        name: config.name,
                        logo: '',
                        group: config.category || ''
                    }
                };
            }
            
            const configDir = path.dirname(this.configPath);
            if (!fs.existsSync(configDir)) {
                fs.mkdirSync(configDir, { recursive: true });
            }
            
            fs.writeFileSync(this.configPath, JSON.stringify(configs, null, 2));
            logger.info(`Saved ${this.streams.size} streams to config`);
            return true;
        } catch (error) {
            logger.error('Error saving streams config:', error);
            throw error;
        }
    }

    async addStream(streamData) {
        try {
            // 验证必要的字段
            if (!streamData.name || !streamData.url) {
                throw new Error('缺少必要的流信息');
            }

            // 生成或使用的streamId
            let streamId;
            if (streamData.id) {
                streamId = streamData.id;
            } else if (streamData.customId) {
                streamId = `stream_${streamData.customId}`;
            } else {
                // 生成6位随机ID
                const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
                let randomId = '';
                for (let i = 0; i < 6; i++) {
                    randomId += chars.charAt(Math.floor(Math.random() * chars.length));
                }
                streamId = `stream_${randomId}`;
            }

            // 检查是否已存在相同的流
            if (this.streams.has(streamId)) {
                // 如果存在，更新现有流的信息
                const existingStream = this.streams.get(streamId);
                existingStream.name = streamData.name;
                existingStream.url = streamData.url;
                existingStream.category = streamData.category || existingStream.category;
                if (streamData.tvg) {
                    existingStream.tvg = streamData.tvg;
                }
                logger.info(`Updated existing stream: ${streamId}`);
            } else {
                // 添加新流
                const newStream = {
                    id: streamId,
                    name: streamData.name,
                    url: streamData.url,
                    category: streamData.category || '未分类',
                    tvg: streamData.tvg || {
                        id: '',
                        name: streamData.name,
                        logo: '',
                        group: streamData.category || ''
                    },
                    stats: {
                        startTime: null,
                        uptime: 0,
                        errors: 0
                    }
                };

                // 保存到流集合
                this.streams.set(streamId, newStream);

                // 初始化统计信息
                this.streamStats.set(streamId, {
                    totalRequests: 0,
                    lastAccessed: null,
                    errors: 0,
                    uptime: 0,
                    startTime: null
                });

                logger.info(`Added new stream: ${streamId}`);
            }

            // 立即保存配置到文件
            await this.saveStreams();

            // 新增:自动设置为自动启停
            this.autoPlayStreams.add(streamId);
            await this.saveAutoConfig();

            return {
                success: true,
                streamId: streamId
            };
        } catch (error) {
            logger.error('添加流失败:', error);
            throw error;
        }
    }

    // 修改删除流的方法
    async deleteStream(streamId) {
        try {
            await this.stopStreaming(streamId);
            this.streams.delete(streamId);
            this.streamStats.delete(streamId);
            
            // 保存配置
            this.saveStreams();
            
            // 清理流文件
            const streamPath = path.join(__dirname, '../streams', streamId);
            if (fs.existsSync(streamPath)) {
                fs.rmSync(streamPath, { recursive: true });
            }
            
            logger.info(`Stream deleted: ${streamId}`);
        } catch (error) {
            logger.error(`Error deleting stream: ${streamId}`, { error });
            throw error;
        }
    }

    async getStreamUrl(streamId) {
        try {
            const stream = this.streams.get(streamId);
            if (!stream) {
                logger.warn(`Stream not found: ${streamId}`);
                return null;
            }

            // 如果流被手动停止,不要自动启动
            if (stream.manualStopped) {
                logger.info(`Stream ${streamId} was manually stopped, not auto-starting`);
                return null;
            }

            // 检查流是否正在运行
            if (!this.streamProcesses.has(streamId)) {
                logger.info(`Starting stream ${streamId} on demand`);
                await this.startStreaming(streamId);
            }

            // 添加观看者
            this.addViewer(streamId);
            return `/streams/${streamId}/playlist.m3u8`;
        } catch (error) {
            logger.error(`Error getting stream URL: ${streamId}`, error);
            return null;
        }
    }

    async startStreaming(streamId, isRtmpPush = false) {
        try {
            const stream = this.streams.get(streamId);
            if (!stream) {
                throw new Error('Stream not found');
            }

            // 更新流状态
            this.streamStatus.set(streamId, 'starting');
            this.emit('streamStatusChanged', streamId, 'starting');

            // 如果是推流模式,标记为手动启动
            if (isRtmpPush) {
                this.manuallyStartedStreams.add(streamId);
            }

            const result = await this.startStreamingWithFFmpeg(streamId, stream, isRtmpPush);
            
            if (result && !result.success) {
                throw result.error;
            }

            // 更新状态为运行中
            this.streamStatus.set(streamId, 'running');
            this.emit('streamStatusChanged', streamId, 'running');
            
            return { success: true };
        } catch (error) {
            return { success: false, error };
        }
    }

    async startStreamingWithFFmpeg(streamId, streamConfig, isManualStart = false) {
        try {
            // 确保输出目录存在
            const outputPath = path.join(__dirname, '../streams', streamId);
            if (!fs.existsSync(outputPath)) {
                fs.mkdirSync(outputPath, { recursive: true, mode: 0o777 }); // 添加权限设置
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
                path.join(outputPath, 'playlist.m3u8'),
                // RTMP 输出
                '-c:v', 'copy',
                '-c:a', 'aac',
                '-f', 'flv',
                `${this.config.rtmp.pushServer}${streamId}`
            ];

            return new Promise((resolve, reject) => {
                try {
                    // 确保目录有正确的权限
                    fs.chmodSync(outputPath, 0o777);

                    const ffmpeg = spawn('ffmpeg', args);
                    let ffmpegError = '';
                    let hasStarted = false;

                    ffmpeg.stderr.on('data', (data) => {
                        const message = data.toString();
                        ffmpegError += message;

                        // 检查是否是致命错误
                        if (message.includes('No such file or directory') ||
                            message.includes('Permission denied')) {
                            logger.error(`FFmpeg permission error for stream ${streamId}:`, message);
                            ffmpeg.kill('SIGTERM');
                            reject(new Error('Permission error'));
                            return;
                        }

                        // 记录重要的错误信息
                        if (message.includes('Error') || 
                            message.includes('Failed') ||
                            message.includes('Invalid')) {
                            logger.error(`FFmpeg stderr: ${message}`);
                        }
                    });

                    ffmpeg.on('error', (error) => {
                        logger.error(`FFmpeg spawn error for stream ${streamId}:`, error);
                        reject(error);
                    });

                    ffmpeg.on('exit', (code, signal) => {
                        if (code !== 0) {
                            const error = new Error(`FFmpeg exited with code ${code}`);
                            if (ffmpegError) {
                                logger.error(`FFmpeg stderr: ${ffmpegError}`);
                            }
                            reject(error);
                        } else if (hasStarted) {
                            resolve();
                        }
                    });

                    // 保存进程引用
                    this.streamProcesses.set(streamId, {
                        ffmpeg,
                        startTime: new Date(),
                        isManualStart: isManualStart
                    });

                    // 等待流启动
                    this.waitForStream(streamId, outputPath)
                        .then(() => {
                            hasStarted = true;
                            resolve();
                        })
                        .catch(reject);

                } catch (error) {
                    logger.error(`Error in startStreamingWithFFmpeg for stream ${streamId}:`, error);
                    reject(error);
                }
            });
        } catch (error) {
            logger.error(`Error setting up FFmpeg for stream ${streamId}:`, error);
            throw error;
        }
    }

    // 添加新的错误处理方法
    async handleStreamError(streamId, error, isManualStart) {
        try {
            logger.error(`Stream error for ${streamId}:`, error);

            // 更新重试次数
            const retryCount = (this.streamRetries.get(streamId) || 0) + 1;
            this.streamRetries.set(streamId, retryCount);

            // 更新流状态
            if (retryCount >= 3) {
                this.streamStatus.set(streamId, 'invalid');
                this.emit('streamStatusChanged', streamId, 'invalid');
                logger.error(`Stream ${streamId} marked as invalid after 3 retries`);
                
                // 停止流
                await this.stopStreaming(streamId);
            } else {
                this.streamStatus.set(streamId, 'retrying');
                this.emit('streamStatusChanged', streamId, 'retrying');
                
                // 1分钟后重试
                setTimeout(() => {
                    if (this.streams.has(streamId)) { // 确保流还存在
                        this.startStreaming(streamId, isManualStart).catch(err => {
                            logger.error(`Retry failed for stream ${streamId}:`, err);
                        });
                    }
                }, 60000);
            }
        } catch (error) {
            logger.error(`Error handling stream error for ${streamId}:`, error);
        }
    }

    // 加清理旧分的方法
    async cleanupOldSegments(outputPath) {
        try {
            const files = fs.readdirSync(outputPath);
            const now = Date.now();
            
            for (const file of files) {
                if (file.endsWith('.ts')) {
                    const filePath = path.join(outputPath, file);
                    const stats = fs.statSync(filePath);
                    
                    // 如果文件超过3分钟，删除它
                    if (now - stats.mtimeMs > 3 * 60 * 1000) {
                        fs.unlinkSync(filePath);
                        logger.debug(`Deleted old segment: ${file}`);
                    }
                }
            }
        } catch (error) {
            logger.error('Error cleaning up segments:', error);
        }
    }

    // 添加件监控方法
    monitorStreamFile(streamId, filePath) {
        const checkInterval = setInterval(() => {
            try {
                const stats = fs.statSync(filePath);
                const now = Date.now();
                const fileAge = now - stats.mtimeMs;

                // 如果文件超过30秒没有更新，重启流
                if (fileAge > 30000) {
                    logger.warn(`Stream file not updated for ${fileAge}ms, restarting: ${streamId}`);
                    this.restartStream(streamId);
                    clearInterval(checkInterval);
                }
            } catch (error) {
                logger.error(`Error monitoring stream file: ${streamId}`, { error });
                this.restartStream(streamId);
                clearInterval(checkInterval);
            }
        }, 5000); // 每5秒检查一次

        // 保存查间隔的引用，后续处理
        this.healthChecks.set(streamId, checkInterval);
    }

    // 修改重启流的方法
    async restartStream(streamId, isManualStart = false) {
        try {
            const stream = this.streams.get(streamId);
            if (!stream) {
                logger.warn(`Stream not found: ${streamId}`);
                return;
            }

            if (stream.invalid) {
                logger.info(`Skipping restart of invalid stream: ${streamId}`);
                return;
            }

            // 检查失��次数
            const failureCount = this.failureCount.get(streamId) || 0;
            if (failureCount >= 3) {
                logger.info(`Stream ${streamId} has failed too many times, marking as invalid`);
                this.markStreamAsInvalid(streamId);
                return;
            }

            // 如是手动启动，记录到集合中
            if (isManualStart) {
                this.manuallyStartedStreams.add(streamId);
                logger.info(`Stream ${streamId} marked as manually started for restart`);
            }

            logger.info(`Restarting stream: ${streamId}`);
            await this.forceStopStreaming(streamId);
            await new Promise(resolve => setTimeout(resolve, 5000));  // 增加等待时间到5秒
            await this.startStreaming(streamId, isManualStart);  // 传递 isManualStart 参数
        } catch (error) {
            logger.error(`Error restarting stream: ${streamId}`, { error });
            this.failureCount.set(streamId, (this.failureCount.get(streamId) || 0) + 1);
        }
    }

    // 添加 streamlink 作为备选方案
    async startStreamingWithStreamlink(streamId, streamConfig) {
        const { spawn } = require('child_process');
        const outputPath = path.join(__dirname, '../streams', streamId);

        const args = [
            '--player-external-http',
            '--player-continuous-http',
            '--stream-segment-threads', '1',
            '--stream-timeout', '60',
            '--retry-max', '0',
            '--retry-streams', '1',
            '--http-header',
            `X-AxDRM-Message=${streamConfig.inputstream?.adaptive?.license_key}`,
            streamConfig.url,
            'best',
            '-o',
            `${outputPath}/stream.ts`
        ];

        logger.info(`Starting streamlink with args:`, { args });

        const streamlink = spawn('streamlink', args);
        this.streamProcesses.set(streamId, streamlink);

        streamlink.stdout.on('data', (data) => {
            logger.debug(`streamlink stdout: ${data}`);
        });

        streamlink.stderr.on('data', (data) => {
            logger.error(`streamlink stderr: ${data}`);
        });

        streamlink.on('close', (code) => {
            logger.info(`streamlink process exited with code ${code}`);
            this.streamProcesses.delete(streamId);
            if (code !== 0) {
                setTimeout(() => this.startStreaming(streamId), 5000);
            }
        });
    }

    async waitForStream(streamId, outputPath) {
        return new Promise((resolve, reject) => {
            const maxAttempts = 30;
            let attempts = 0;
            
            const checkFile = () => {
                const playlistPath = path.join(outputPath, 'playlist.m3u8');
                const segmentPath = path.join(outputPath, 'segment_0.ts');
                
                if (fs.existsSync(playlistPath) && fs.existsSync(segmentPath)) {
                    // 检查文件大小
                    const stats = fs.statSync(segmentPath);
                    if (stats.size > 0) {
                        logger.info(`Stream ${streamId} started successfully`);
                        resolve();
                        return;
                    }
                }
                
                attempts++;
                if (attempts >= maxAttempts) {
                    const error = new Error(`Failed to create stream after ${maxAttempts} attempts`);
                    logger.error(`Stream ${streamId} failed to start`, { error });
                    this.stopStreaming(streamId);
                    reject(error);
                } else {
                    setTimeout(checkFile, 1000);
                }
            };
            
            checkFile();
        });
    }

    async stopStreaming(streamId) {
        try {
            const processes = this.streamProcesses.get(streamId);
            if (processes) {
                // 停止 FFmpeg 进程
                if (processes.ffmpeg) {
                    processes.ffmpeg.kill('SIGTERM');
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    
                    if (processes.ffmpeg.exitCode === null) {
                        processes.ffmpeg.kill('SIGKILL');
                    }
                }
                
                // 清理所有状态
                this.streamProcesses.delete(streamId);
                this.manuallyStartedStreams.delete(streamId);
                this.activeViewers.delete(streamId);
                
                // 清理定时器
                if (this.autoStopTimers.has(streamId)) {
                    clearTimeout(this.autoStopTimers.get(streamId));
                    this.autoStopTimers.delete(streamId);
                }
                
                // 清理文件
                const outputPath = path.join(__dirname, '../streams', streamId);
                if (fs.existsSync(outputPath)) {
                    fs.rmSync(outputPath, { recursive: true });
                }
                
                logger.info(`Stream stopped: ${streamId}`);
                return true;
            }
            return false;
        } catch (error) {
            logger.error(`Error stopping stream: ${streamId}`, error);
            throw error;
        }
    }

    async checkStreamsHealth() {
        for (const [streamId, process] of this.streamProcesses.entries()) {
            try {
                const stream = this.streams.get(streamId);
                if (stream?.invalid) {
                    continue;  // 跳过失效的流
                }

                const stats = this.streamStats.get(streamId);
                const outputPath = path.join(__dirname, '../streams', streamId, 'playlist.m3u8');
                
                if (!fs.existsSync(outputPath)) {
                    logger.warn(`Unhealthy stream detected: ${streamId}`);
                    await this.restartStream(streamId);
                    continue;
                }
                
                // 如果错误次数过多，重启流
                if (stats && stats.errors > 10) {
                    logger.warn(`Too many errors for stream: ${streamId}`);
                    await this.restartStream(streamId);
                }
            } catch (error) {
                logger.error(`Health check failed for stream: ${streamId}`, { error });
            }
        }
    }

    async cleanupUnusedFiles() {
        try {
            const streamsDir = path.join(__dirname, '../streams');
            const dirs = fs.readdirSync(streamsDir);
            
            for (const dir of dirs) {
                const streamPath = path.join(streamsDir, dir);
                const stats = fs.statSync(streamPath);
                
                // 如果目录超过24小时未被访问且不活跃则删除
                const isOld = (Date.now() - stats.atimeMs) > 24 * 60 * 60 * 1000;
                const isInactive = !this.streamProcesses.has(dir);
                
                if (isOld && isInactive) {
                    fs.rmSync(streamPath, { recursive: true });
                    logger.info(`Cleaned up unused files for stream: ${dir}`);
                }
            }
        } catch (error) {
            logger.error('Error cleaning up files', { error });
        }
    }

    getStreamStats(streamId) {
        return this.streamStats.get(streamId);
    }

    // 添加一个强制停止的方法
    async forceStopStreaming(streamId) {
        try {
            const processes = this.streamProcesses.get(streamId);
            if (processes) {
                // 使用 SIGKILL 强制终止进程
                if (processes.ffmpeg) {
                    processes.ffmpeg.kill('SIGKILL');
                }
                
                // 立即清理源
                this.streamProcesses.delete(streamId);
                
                // 清理文件
                const outputPath = path.join(__dirname, '../streams', streamId);
                if (fs.existsSync(outputPath)) {
                    fs.rmSync(outputPath, { recursive: true, force: true });
                }
                
                logger.info(`Stream force stopped: ${streamId}`);
                return true;
            }
            return false;
        } catch (error) {
            logger.error(`Error force stopping stream: ${streamId}`, error);
            throw error;
        }
    }

    // 添加标记流为失效的方法
    async markStreamAsInvalid(streamId) {
        const stream = this.streams.get(streamId);
        if (stream) {
            stream.invalid = true;
            stream.lastError = '流连接失败次数过多，已标记为失效';
            stream.lastErrorTime = new Date();
            await this.stopStreaming(streamId);  // 确保停止流
            await this.saveStreams();
            logger.warn(`Stream ${streamId} marked as invalid`);
        }
    }

    // 添加检查流状态的方法
    isStreamActive(streamId) {
        // 检查是否有进程在运行
        const hasProcess = this.streamProcesses.has(streamId);
        
        // 检查是否有最近的统计信息
        const stats = this.streamStats.get(streamId);
        const hasRecentStats = stats?.startTime && 
            (Date.now() - new Date(stats.startTime).getTime()) < 30000;  // 30秒内有活动
        
        // 检查是否有放列表文件
        const playlistPath = path.join(__dirname, '../streams', streamId, 'playlist.m3u8');
        const hasPlaylist = fs.existsSync(playlistPath);
        
        return hasProcess || hasRecentStats || hasPlaylist;
    }

    // 添加观看者
    addViewer(streamId) {
        const count = this.activeViewers.get(streamId) || 0;
        this.activeViewers.set(streamId, count + 1);
        
        // 清除自动停止定时器
        if (this.autoStopTimers.has(streamId)) {
            clearTimeout(this.autoStopTimers.get(streamId));
            this.autoStopTimers.delete(streamId);
            logger.debug(`Cleared auto-stop timer for stream ${streamId}`);
        }
    }

    // 移除观看者
    removeViewer(streamId) {
        const count = this.activeViewers.get(streamId) || 0;
        if (count > 0) {
            this.activeViewers.set(streamId, count - 1);
            
            // 如果是自动启停的流且没有观看者，1分钟后停止
            if (count - 1 === 0 && 
                this.autoPlayStreams.has(streamId) && 
                !this.manuallyStartedStreams.has(streamId)) {
                
                const timer = setTimeout(async () => {
                    const currentCount = this.activeViewers.get(streamId) || 0;
                    if (currentCount === 0) {
                        await this.stopStreaming(streamId);
                    }
                }, 60000); // 1分钟后停止
                
                this.autoStopTimers.set(streamId, timer);
            }
        }
    }

    // 添加更新统计信息的方法
    updateStats() {
        for (const [streamId, process] of this.streamProcesses.entries()) {
            const stats = this.streamStats.get(streamId);
            if (stats && process.startTime) {
                // 更新行时间
                const uptime = Date.now() - process.startTime.getTime();
                stats.uptime = uptime;
                
                // 更新流配置中的统计信息
                const stream = this.streams.get(streamId);
                if (stream && stream.stats) {
                    stream.stats.uptime = uptime;
                }
            }
        }
    }

    // 改导出配置方法以支持分类
    exportConfig() {
        const configs = [];
        const streamsByCategory = new Map();

        // 按分类分组
        for (const [id, stream] of this.streams.entries()) {
            const category = stream.category || '未分类';
            if (!streamsByCategory.has(category)) {
                streamsByCategory.set(category, []);
            }
            streamsByCategory.get(category).push(stream);
        }

        // 生成配置文件内容
        for (const [category, streams] of streamsByCategory.entries()) {
            configs.push(`${category},#genre#`); // 添加分类标记
            for (const stream of streams) {
                const playUrl = `http://${this.config.server.host}:${this.config.server.port}/play/${stream.id}`;
                configs.push(`${stream.name},${stream.url}`);
            }
            configs.push(''); // 添加空行分隔同分类
        }

        return configs.join('\n');
    }

    // 在 StreamManager 类中添加或修改 updateStream 方法
    async updateStream(streamId, streamData) {
        try {
            const stream = this.streams.get(streamId);
            if (!stream) {
                throw new Error('Stream not found');
            }

            // 更新流信息
            stream.name = streamData.name;
            stream.url = streamData.url;
            stream.category = streamData.category;

            // 如果ID发生变化
            if (streamData.customId && `stream_${streamData.customId}` !== streamId) {
                const newId = `stream_${streamData.customId}`;
                
                // 检查新ID是否已存在
                if (this.streams.has(newId)) {
                    throw new Error('新ID已存在');
                }

                // 先停止当前流
                await this.stopStreaming(streamId);

                // 使用新ID重创建流
                this.streams.delete(streamId);
                stream.id = newId;
                this.streams.set(newId, stream);

                // 更新相关的映射
                if (this.streamStats.has(streamId)) {
                    const stats = this.streamStats.get(streamId);
                    this.streamStats.delete(streamId);
                    this.streamStats.set(newId, stats);
                }

                // 移动流媒体件
                const oldPath = path.join(__dirname, '../streams', streamId);
                const newPath = path.join(__dirname, '../streams', newId);
                if (fs.existsSync(oldPath)) {
                    if (fs.existsSync(newPath)) {
                        fs.rmSync(newPath, { recursive: true, force: true });
                    }
                    fs.renameSync(oldPath, newPath);
                }

                // 更新进程映射
                if (this.streamProcesses.has(streamId)) {
                    const process = this.streamProcesses.get(streamId);
                    this.streamProcesses.delete(streamId);
                    this.streamProcesses.set(newId, process);
                }

                // 更新观看者计数
                if (this.activeViewers.has(streamId)) {
                    const viewers = this.activeViewers.get(streamId);
                    this.activeViewers.delete(streamId);
                    this.activeViewers.set(newId, viewers);
                }

                // 更新自动停止定时器
                if (this.autoStopTimers.has(streamId)) {
                    const timer = this.autoStopTimers.get(streamId);
                    clearTimeout(timer);
                    this.autoStopTimers.delete(streamId);
                }

                logger.info(`Stream ID updated from ${streamId} to ${newId}`);
            }

            // 保存更新
            await this.saveStreams();

            return {
                success: true,
                message: '流更新成功',
                newId: streamData.customId ? `stream_${streamData.customId}` : streamId
            };
        } catch (error) {
            logger.error('Error updating stream:', error);
            throw error;
        }
    }

    // 修改更新流量统计的方法
    updateTrafficStats() {
        for (const [streamId, process] of this.streamProcesses.entries()) {
            if (process && process.ffmpeg) {
                // 每个活跃流每秒接收约2MB数据
                this.totalTraffic.received += BigInt(2 * 1024 * 1024);
                
                // 每个活跃流每秒发送约1MB数据（考虑多个观看者）
                const viewers = this.activeViewers.get(streamId) || 0;
                this.totalTraffic.sent += BigInt(1024 * 1024 * (viewers + 1));
            }
        }
    }

    // 修改获取流量统计的方法
    getTrafficStats() {
        const uptime = Date.now() - this.startTime;  // 使用实际的启动时间计算运行时间
        return {
            sent: this.formatBytes(this.totalTraffic.sent),
            received: this.formatBytes(this.totalTraffic.received),
            uptime: uptime,
            activeStreams: this.streamProcesses.size
        };
    }

    // 改进格式化字节数的方法
    formatBytes(bytes) {
        if (typeof bytes === 'bigint') {
            bytes = Number(bytes);
        }
        
        if (bytes === 0) return '0 B';
        
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        // 保留两位小数
        const value = bytes / Math.pow(k, i);
        return value.toFixed(2) + ' ' + sizes[i];
    }

    // 修改保存统计数据的方法
    async saveStats() {
        try {
            const statsPath = path.join(__dirname, '../config/stats.json');
            const stats = {
                startTime: this.startTime,  // 保存实际的启动时间
                traffic: {
                    sent: this.totalTraffic.sent.toString(),
                    received: this.totalTraffic.received.toString()
                }
            };
            
            await fs.promises.writeFile(statsPath, JSON.stringify(stats, null, 2));
            logger.debug('Stats saved successfully');
        } catch (error) {
            logger.error('Error saving stats:', error);
        }
    }

    // 修改加载统计数据的方法
    async loadStats() {
        try {
            const statsPath = path.join(__dirname, '../config/stats.json');
            if (fs.existsSync(statsPath)) {
                const data = await fs.promises.readFile(statsPath, 'utf8');
                const stats = JSON.parse(data);
                
                // 只加载流量数据，不加载启动时间
                this.totalTraffic.sent = BigInt(stats.traffic.sent);
                this.totalTraffic.received = BigInt(stats.traffic.received);
                
                logger.info('Stats loaded successfully');
            }
        } catch (error) {
            logger.error('Error loading stats:', error);
            // 如果加载失败，只重置流量数据
            this.totalTraffic.sent = 0n;
            this.totalTraffic.received = 0n;
        }
    }

    // 其他方法可以通过 this.config 访问配置
    // 例如:
    getServerUrl() {
        return `http://${this.config.server.host}:${this.config.server.port}`;
    }

    getRtmpPushUrl(streamId) {
        return `${this.config.rtmp.pushServer}${streamId}`;
    }

    getRtmpPullUrl(streamId) {
        return `${this.config.rtmp.pullServer}${streamId}.flv`;
    }

    // 修改心跳方法
    async startHeartbeat() {
        const sendHeartbeat = async () => {
            try {
                // 获取完整的服务器地址（包含端口）
                const serverAddress = `${await this.getServerIp()}:${this.config.server.port}`;
                
                // 计算准确的运行时间
                const uptime = Date.now() - this.startTime;
                
                // 获取准确的流量统计
                const trafficStats = this.getTrafficStats();
                
                const stats = {
                    serverName: this.heartbeatConfig.serverName,
                    serverIp: serverAddress,
                    version: `v${this.config.version}`,
                    uptime: uptime,
                    totalStreams: this.streams.size,
                    activeStreams: this.streamProcesses.size,
                    traffic: {
                        received: trafficStats.received,
                        sent: trafficStats.sent
                    },
                    systemInfo: {
                        platform: process.platform,
                        arch: process.arch,
                        nodeVersion: process.version,
                        memory: process.memoryUsage(),
                        cpu: process.cpuUsage()
                    }
                };

                const response = await fetch(this.heartbeatConfig.server, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(stats)
                });

                if (!response.ok) {
                    throw new Error(`Heartbeat failed: ${response.statusText}`);
                }

                logger.debug('Heartbeat sent successfully');
            } catch (error) {
                logger.error('Error sending heartbeat:', error);
            }
        };

        // 立即发送第一次心跳
        await sendHeartbeat();

        // 设置定期发送心跳
        setInterval(sendHeartbeat, this.heartbeatConfig.interval);
    }

    // 获取服务器IP地址
    async getServerIp() {
        try {
            if (this.config.server.host !== 'auto') {
                return this.config.server.host;
            }

            const { networkInterfaces } = require('os');
            const nets = networkInterfaces();
            
            for (const name of Object.keys(nets)) {
                for (const net of nets[name]) {
                    // 跳过内部IP和IPv6
                    if (!net.internal && net.family === 'IPv4') {
                        return net.address;
                    }
                }
            }
            return 'unknown';
        } catch (error) {
            logger.error('Error getting server IP:', error);
            return 'unknown';
        }
    }

    // 新增方法：加载自动配置
    loadAutoConfig() {
        try {
            const autoConfigPath = path.join(__dirname, '../config/auto_config.json');
            if (fs.existsSync(autoConfigPath)) {
                const data = fs.readFileSync(autoConfigPath, 'utf8');
                if (data.trim()) {  // 检查文件是否为空
                    const config = JSON.parse(data);
                    this.autoPlayStreams = new Set(config.autoPlay || []);
                    this.autoStartStreams = new Set(config.autoStart || []);
                } else {
                    // 如果文件为空，创建默认配置
                    this.createDefaultAutoConfig(autoConfigPath);
                }
            } else {
                // 如果文件不存在，创建默认配置
                this.createDefaultAutoConfig(autoConfigPath);
            }
        } catch (error) {
            logger.error('Error loading auto config:', error);
            // 发生错误时创建默认配置
            this.createDefaultAutoConfig(path.join(__dirname, '../config/auto_config.json'));
        }
    }

    // 添加创建默认配置的方法
    createDefaultAutoConfig(configPath) {
        try {
            const defaultConfig = {
                autoPlay: [],
                autoStart: []
            };
            
            // 确保目录存在
            const configDir = path.dirname(configPath);
            if (!fs.existsSync(configDir)) {
                fs.mkdirSync(configDir, { recursive: true });
            }
            
            // 写入默认配置
            fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
            logger.info('Created default auto config file');
            
            // 初始化集合
            this.autoPlayStreams = new Set();
            this.autoStartStreams = new Set();
        } catch (error) {
            logger.error('Error creating default auto config:', error);
        }
    }

    // 新增方法：保存自动配置
    async saveAutoConfig() {
        try {
            const autoConfigPath = path.join(__dirname, '../config/auto_config.json');
            const data = {
                autoPlay: Array.from(this.autoPlayStreams),
                autoStart: Array.from(this.autoStartStreams)
            };
            await fs.promises.writeFile(autoConfigPath, JSON.stringify(data, null, 2));
        } catch (error) {
            logger.error('Error saving auto config:', error);
        }
    }

    // 新增方法：启动所有自动启动的流
    async startAutoStartStreams() {
        for (const streamId of this.autoStartStreams) {
            try {
                if (!this.streamProcesses.has(streamId)) {
                    await this.startStreaming(streamId, true);
                }
            } catch (error) {
                logger.error(`Error auto-starting stream ${streamId}:`, error);
            }
        }
    }

    // 修改获取流信息的方法,添加自动启动状态
    async getStreamInfo(streamId) {
        const stream = this.streams.get(streamId);
        if (!stream) return null;

        return {
            ...stream,
            autoStart: this.autoStartStreams.has(streamId),
            processRunning: this.streamProcesses.has(streamId),
            manuallyStarted: this.manuallyStartedStreams.has(streamId),
            status: this.streamStatus.get(streamId) || 'stopped'
        };
    }
}

module.exports = { StreamManager }; 
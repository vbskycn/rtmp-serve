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
        
        // 确保使用绝对路径
        this.rootDir = path.resolve(__dirname, '..');
        this.configPath = path.join(this.rootDir, 'config/streams.json');
        
        // 修改配置加载逻辑
        try {
            // 首先尝试从环境变量获本号
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
        
        // 修改配置目录的创建
        const configDir = path.dirname(this.configPath);
        if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true });
        }
        
        // 加载保存的流配置
        this.loadStreams();
        
        // 每小时运行一次清理
        setInterval(() => this.cleanupUnusedFiles(), 60 * 60 * 1000);
        // 每5分钟运行一次健康检查
        setInterval(() => this.checkStreamsHealth(), 5 * 60 * 1000);
        
        // 修改流量统计初始化
        this.startTime = Date.now();
        this.totalTraffic = {
            received: 0n,
            sent: 0n
        };
        
        // 添加流量统计集合
        this.trafficStats = new Map();
        
        // 每秒更新流量统计
        setInterval(() => {
            this.updateTrafficStats();
            // 触发统计更新事件
            this.emit('statsUpdated', this.getStats());
        }, 1000);
        
        // 每分钟保存统计数据
        setInterval(() => {
            this.saveStats();
        }, 60000);
        
        // 加载保存的统计数据
        this.loadStats();
        
        // 修改心跳配置
        this.heartbeatConfig = {
            enabled: true,
            server: 'https://rtmp-serve.zhoujie218.top/api/heartbeat',
            interval: 5000,  // 5秒
            timeout: 10000,  // 增加超时时间到10秒
            retryDelay: 5000,  // 添加重试延迟
            maxRetries: 3,  // 添加最大重试次数
            serverName: require('os').hostname()
        };

        // 启动心跳
        if (this.heartbeatConfig.enabled) {
            this.startHeartbeat();
        }

        // 在 constructor 中添加调试日志
        logger.info('Environment version:', process.env.APP_VERSION);
        logger.info('Config file version:', require('../config/config.json').version);
        logger.info('Final config version:', this.config.version);

        // 添加自启动流的集合
        this.autoStartStreams = new Set();
        
        // 从配置文件加载自启动流列表
        this.loadAutoStartStreams();
        
        // 启动时自动启动已配置的流
        this.startAutoStartStreams();
    }

    // 加载保存的流配置
    loadStreams() {
        try {
            logger.info('Starting to load streams...');
            if (fs.existsSync(this.configPath)) {
                logger.info(`Config file exists at: ${this.configPath}`);
                const data = fs.readFileSync(this.configPath, 'utf8');
                
                // 检查文件内容
                if (!data || !data.trim()) {
                    logger.warn('Config file is empty');
                    return;
                }
                
                try {
                    const configs = JSON.parse(data);
                    logger.info(`Successfully parsed config with ${Object.keys(configs).length} streams`);
                    
                    // 清空现有的流
                    this.streams.clear();
                    this.streamStats.clear();
                    
                    // 遍历并加载每个流
                    for (const [id, config] of Object.entries(configs)) {
                        logger.info(`Loading stream: ${id} - ${config.name}`);
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
                    logger.info(`Successfully loaded ${this.streams.size} streams`);
                    
                    // 打印加载的流的ID列表
                    const streamIds = Array.from(this.streams.keys());
                    logger.info('Loaded stream IDs:', streamIds);
                } catch (parseError) {
                    logger.error('Error parsing config JSON:', parseError);
                    logger.error('Raw config data:', data);
                    throw parseError;
                }
            } else {
                logger.warn(`Config file not found at: ${this.configPath}`);
                // 创建空配置文件
                const configDir = path.dirname(this.configPath);
                if (!fs.existsSync(configDir)) {
                    fs.mkdirSync(configDir, { recursive: true });
                }
                fs.writeFileSync(this.configPath, '{}');
                logger.info('Created new empty config file');
            }
        } catch (error) {
            logger.error('Error in loadStreams:', error);
            // 如果文件损坏，创建备份
            try {
                if (fs.existsSync(this.configPath)) {
                    const backupPath = `${this.configPath}.backup.${Date.now()}`;
                    fs.copyFileSync(this.configPath, backupPath);
                    logger.info(`Created backup at: ${backupPath}`);
                    fs.writeFileSync(this.configPath, '{}');
                    logger.info('Reset config file to empty object');
                }
            } catch (backupError) {
                logger.error('Error creating backup:', backupError);
            }
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
            // 获取流配置
            const stream = this.getStreamById(streamId);
            if (!stream) {
                logger.warn(`Stream not found: ${streamId}`);
                return null;
            }

            const actualStreamId = stream.id;

            // 检查流是否经在运行
            if (!this.streamProcesses.has(actualStreamId)) {
                logger.info(`Starting stream ${actualStreamId} on demand`);
                try {
                    // 尝试启动流
                    await this.startStreaming(actualStreamId);
                    
                    // 等待playlist文件生成
                    const playlistPath = path.join(this.rootDir, 'streams', actualStreamId, 'playlist.m3u8');
                    let attempts = 0;
                    while (!fs.existsSync(playlistPath) && attempts < 10) {
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        attempts++;
                    }
                    
                    if (!fs.existsSync(playlistPath)) {
                        throw new Error('Playlist file not generated');
                    }
                } catch (error) {
                    logger.error(`Failed to start stream ${actualStreamId}:`, error);
                    return null;
                }
            }

            // 添加观看者
            this.addViewer(actualStreamId);
            return `/streams/${actualStreamId}/playlist.m3u8`;
        } catch (error) {
            logger.error(`Error getting stream URL: ${streamId}`, error);
            return null;
        }
    }

    async startStreaming(streamId, isManualStart = false) {
        try {
            const stream = this.streams.get(streamId);
            if (!stream) {
                throw new Error('Stream not found');
            }

            // 如果是手动启动，记录到集合中
            if (isManualStart) {
                this.manuallyStartedStreams.add(streamId);
                logger.info(`Stream ${streamId} marked as manually started`);
            }

            // 初始化统计信息
            const stats = this.streamStats.get(streamId);
            if (stats) {
                stats.startTime = new Date();
                stats.uptime = 0;
                stats.errors = 0;
            }

            // 获取统计信息引用
            const configStats = stream.stats;
            
            // 更新统计信息
            const now = new Date();
            if (stats) {
                stats.startTime = now;
                stats.errors = 0;
            }
            if (configStats) {
                configStats.startTime = now;
                configStats.errors = 0;
            }

            // 使用 FFmpeg 处理流
            await this.startStreamingWithFFmpeg(streamId, stream, isManualStart);

        } catch (error) {
            logger.error(`Error starting stream: ${streamId}`, { 
                error: error.message,
                stack: error.stack 
            });
            
            // 更新错误统计
            const stats = this.streamStats.get(streamId);
            if (stats) {
                stats.errors++;
            }
            
            if (configStats) {
                configStats.errors++;
                configStats.startTime = null;
            }
            
            throw error;
        }
    }

    async startStreamingWithFFmpeg(streamId, streamConfig, isManualStart = false) {
        const { spawn } = require('child_process');
        const outputPath = path.join(this.rootDir, 'streams', streamId);
        
        if (!fs.existsSync(outputPath)) {
            fs.mkdirSync(outputPath, { recursive: true });
        }

        // 如果已经有进程在运行，先停止它
        if (this.streamProcesses.has(streamId)) {
            await this.stopStreaming(streamId);
        }

        // 构建 FFmpeg 输入参数
        const inputArgs = [
            '-hide_banner',
            '-nostats',
            '-y',
            '-fflags', '+genpts+igndts+discardcorrupt',
            '-avoid_negative_ts', 'make_zero',
            '-analyzeduration', '2000000',
            '-probesize', '1000000',
            '-rw_timeout', '5000000',
            '-thread_queue_size', '4096',
            '-reconnect', '1',
            '-reconnect_streamed', '1',
            '-reconnect_delay_max', '2',
            '-multiple_requests', '1',
            '-user_agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            '-i', streamConfig.url
        ];

        // 构建 FFmpeg 输出参数
        const outputArgs = [
            // HLS输出
            '-c:v', 'copy',
            '-c:a', 'aac',
            '-b:a', '128k',
            '-ac', '2',
            '-ar', '44100',
            '-f', 'hls',
            '-hls_time', '2',
            '-hls_list_size', '6',
            '-hls_flags', 'delete_segments+append_list+discont_start+independent_segments',
            '-hls_segment_type', 'mpegts',
            '-hls_segment_filename', `${outputPath}/segment_%d.ts`,
            `${outputPath}/playlist.m3u8`
        ];

        // 如果是手动启动，添加 RTMP 推流输出
        if (isManualStart || this.manuallyStartedStreams.has(streamId)) {
            outputArgs.push(
                '-c:v', 'copy',
                '-c:a', 'aac',
                '-f', 'flv',
                `${this.config.rtmp.pushServer}${streamId}`
            );
            // 确保流被标记为手动启动
            this.manuallyStartedStreams.add(streamId);
            logger.info(`Adding RTMP output for manually started stream: ${streamId}`);
        }

        // 合并所有参数
        const args = [...inputArgs, ...outputArgs];

        logger.info(`Starting FFmpeg for stream: ${streamId} (manual: ${isManualStart})`);
        logger.debug(`FFmpeg command: ffmpeg ${args.join(' ')}`);

        return new Promise((resolve, reject) => {
            try {
                const ffmpeg = spawn('ffmpeg', args);
                let ffmpegError = '';
                let retryCount = 0;
                const maxRetries = 3;
                const retryDelay = 5000;

                ffmpeg.stderr.on('data', (data) => {
                    const message = data.toString();
                    ffmpegError += message;

                    // 检查是否是致命错误
                    const isFatalError = 
                        message.includes('Connection timed out') ||
                        message.includes('Server returned 404') || 
                        message.includes('Failed to open segment') ||
                        message.includes('Error when loading first segment') ||
                        message.includes('Failed to reload playlist');

                    if (isFatalError) {
                        const stats = this.streamStats.get(streamId);
                        if (stats) {
                            stats.errors++;
                        }
                    }

                    // 只记录重要的错误信息
                    if (message.includes('Error') || 
                        message.includes('Failed') ||
                        message.includes('Invalid') ||
                        message.includes('timeout')) {
                        logger.error(`FFmpeg stderr: ${message}`);
                    } else if (message.includes('fps=') || message.includes('speed=')) {
                        // 忽略常规的进度信息
                        return;
                    } else {
                        logger.debug(`FFmpeg stderr: ${message}`);
                    }
                });

                ffmpeg.on('error', (error) => {
                    logger.error(`FFmpeg error for stream ${streamId}:`, error);
                    if (retryCount < maxRetries) {
                        retryCount++;
                        logger.info(`Retrying stream ${streamId} (attempt ${retryCount}/${maxRetries})`);
                        setTimeout(() => {
                            // 保持手动启动状态进行重试
                            const wasManuallyStarted = this.manuallyStartedStreams.has(streamId);
                            this.restartStream(streamId, wasManuallyStarted);
                        }, retryDelay);
                    } else {
                        logger.error(`Max retries reached for stream ${streamId}, stopping stream`);
                        this.stopStreaming(streamId);
                    }
                });

                ffmpeg.on('exit', (code) => {
                    if (code !== 0) {
                        logger.error(`FFmpeg exited with code ${code} for stream ${streamId}`);
                        logger.error(`FFmpeg stderr: ${ffmpegError}`);
                        
                        // 检查是否包含致命错误
                        if (ffmpegError.includes('Server returned 400') ||
                            ffmpegError.includes('Server returned 403') ||
                            ffmpegError.includes('Server returned 404') ||
                            ffmpegError.includes('Server returned 500')) {
                            logger.error(`Fatal error detected for stream ${streamId}, stopping stream`);
                            this.stopStreaming(streamId);
                        } else if (retryCount < maxRetries && this.activeViewers.get(streamId) > 0) {
                            // 只有在有观看者的情况下才重试
                            retryCount++;
                            logger.info(`Retrying stream ${streamId} (attempt ${retryCount}/${maxRetries})`);
                            setTimeout(() => {
                                const wasManuallyStarted = this.manuallyStartedStreams.has(streamId);
                                this.restartStream(streamId, wasManuallyStarted);
                            }, retryDelay);
                        } else {
                            logger.error(`Max retries reached or no viewers for stream ${streamId}, stopping stream`);
                            this.stopStreaming(streamId);
                        }
                    }
                });

                // 保存进程引用
                this.streamProcesses.set(streamId, {
                    ffmpeg,
                    startTime: new Date(),
                    isManualStart: isManualStart || this.manuallyStartedStreams.has(streamId)
                });

                // 等待播放表文件创建
                const checkInterval = setInterval(() => {
                    if (fs.existsSync(path.join(outputPath, 'playlist.m3u8'))) {
                        clearInterval(checkInterval);
                        logger.info(`Stream ${streamId} started successfully`);
                        resolve();
                    }
                }, 1000);

                // 设置检查超时
                setTimeout(() => {
                    clearInterval(checkInterval);
                    if (!fs.existsSync(path.join(outputPath, 'playlist.m3u8'))) {
                        logger.error(`Stream ${streamId} failed to start within timeout`);
                        this.stopStreaming(streamId);
                        reject(new Error('Stream start timeout'));
                    }
                }, 30000);

            } catch (error) {
                reject(error);
            }
        });
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

            // 检查失败次数
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
        const outputPath = path.join(this.rootDir, 'streams', streamId);

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
            const wasManuallyStarted = this.manuallyStartedStreams.has(streamId);
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
                
                // 清理进程引用
                this.streamProcesses.delete(streamId);
                
                // 清理手动启动标记
                this.manuallyStartedStreams.delete(streamId);
                
                // 重置统计信息
                const stats = this.streamStats.get(streamId);
                if (stats) {
                    stats.startTime = null;
                    stats.uptime = 0;
                    stats.errors = 0;
                }

                // 更新流配置中的状态
                const stream = this.streams.get(streamId);
                if (stream) {
                    stream.stats = {
                        ...stream.stats,
                        startTime: null,
                        lastStopped: new Date()
                    };
                }
                
                // 清理健康检查定时器
                if (this.healthChecks.has(streamId)) {
                    clearInterval(this.healthChecks.get(streamId));
                    this.healthChecks.delete(streamId);
                }

                // 清理自动停止定时器
                if (this.autoStopTimers.has(streamId)) {
                    clearTimeout(this.autoStopTimers.get(streamId));
                    this.autoStopTimers.delete(streamId);
                }

                // 清理观看者数
                this.activeViewers.delete(streamId);
                
                // 清理文件
                const outputPath = path.join(this.rootDir, 'streams', streamId);
                if (fs.existsSync(outputPath)) {
                    try {
                        const files = fs.readdirSync(outputPath);
                        for (const file of files) {
                            if (file.endsWith('.ts') || file.endsWith('.m3u8')) {
                                fs.unlinkSync(path.join(outputPath, file));
                            }
                        }
                        fs.rmdirSync(outputPath);
                    } catch (error) {
                        logger.error(`Error cleaning up files for stream ${streamId}:`, error);
                    }
                }
                
                // 保存配置
                await this.saveStreams();
                
                logger.info(`Stream stopped: ${streamId} (was manually started: ${wasManuallyStarted})`);
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
                const outputPath = path.join(this.rootDir, 'streams', streamId, 'playlist.m3u8');
                
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
            const streamsDir = path.join(this.rootDir, 'streams');
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
                const outputPath = path.join(this.rootDir, 'streams', streamId);
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
        const playlistPath = path.join(this.rootDir, 'streams', streamId, 'playlist.m3u8');
        const hasPlaylist = fs.existsSync(playlistPath);
        
        return hasProcess || hasRecentStats || hasPlaylist;
    }

    // 添加观看者
    addViewer(streamId) {
        const count = this.activeViewers.get(streamId) || 0;
        this.activeViewers.set(streamId, count + 1);
        
        // 清除自停止定时器
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
            
            // 只有不是手动启动的才置自动停止定时器
            if (count - 1 === 0 && !this.manuallyStartedStreams.has(streamId)) {
                logger.debug(`No viewers left for auto-started stream ${streamId}, starting auto-stop timer`);
                const timer = setTimeout(async () => {
                    // 再次检查是否还有观看者
                    const currentCount = this.activeViewers.get(streamId) || 0;
                    if (currentCount === 0) {
                        logger.info(`Auto-stopping inactive stream: ${streamId}`);
                        await this.stopStreaming(streamId);
                        this.autoStopTimers.delete(streamId);
                    }
                }, 3 * 60 * 1000); // 3分钟后自动停止
                
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
                    throw new Error('ID已存在');
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
                const oldPath = path.join(this.rootDir, 'streams', streamId);
                const newPath = path.join(this.rootDir, 'streams', newId);
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
        try {
            const activeStreams = Array.from(this.streamProcesses.keys());
            if (activeStreams.length === 0) return;

            for (const streamId of activeStreams) {
                const streamPath = path.join(this.rootDir, 'streams', streamId);
                if (!fs.existsSync(streamPath)) continue;

                // 计算目录大小
                const files = fs.readdirSync(streamPath);
                let totalSize = 0;
                for (const file of files) {
                    if (file.endsWith('.ts')) {
                        const filePath = path.join(streamPath, file);
                        try {
                            const stats = fs.statSync(filePath);
                            totalSize += stats.size;
                        } catch (error) {
                            // 忽略文件访问错误
                            continue;
                        }
                    }
                }

                // 更新接收流量（假设源数据比实际输出大约2倍）
                this.totalTraffic.received += BigInt(totalSize * 2);

                // 计算发送流量（基于观看者数量）
                const viewers = this.activeViewers.get(streamId) || 0;
                if (viewers > 0) {
                    this.totalTraffic.sent += BigInt(totalSize * viewers);
                }

                // 更新单个流的统计信息
                const streamStats = this.trafficStats.get(streamId) || this.initTrafficStats(streamId);
                streamStats.bytesReceived += totalSize * 2;
                streamStats.bytesSent += totalSize * viewers;
                streamStats.lastUpdate = new Date();
            }

            // 触发统计更新事件
            this.emit('statsUpdated', this.getStats());

        } catch (error) {
            logger.error('Error updating traffic stats:', error);
        }
    }

    // 修改初始化流量统计的方法
    initTrafficStats(streamId) {
        const stats = {
            startTime: new Date(),
            bytesReceived: 0,
            bytesSent: 0,
            lastUpdate: new Date(),
            segments: new Set() // 用于追踪已统计的分片
        };
        this.trafficStats.set(streamId, stats);
        return stats;
    }

    // 修改获取统计信息的方法
    getStats() {
        const now = Date.now();
        const uptime = now - this.startTime;
        
        // 计算活跃流数量
        const activeStreams = Array.from(this.streamProcesses.keys()).filter(streamId => {
            const process = this.streamProcesses.get(streamId);
            return process && process.ffmpeg && !process.ffmpeg.killed;
        });

        // 计算总观看人数
        let totalViewers = 0;
        for (const viewers of this.activeViewers.values()) {
            totalViewers += viewers;
        }

        // 计算总流量
        const totalReceived = Number(this.totalTraffic.received);
        const totalSent = Number(this.totalTraffic.sent);

        return {
            uptime: this.formatUptime(uptime),
            traffic: {
                received: this.formatBytes(totalReceived),
                sent: this.formatBytes(totalSent)
            },
            totalStreams: this.streams.size,
            activeStreams: activeStreams.length,
            totalViewers: totalViewers,
            lastUpdate: new Date().toISOString()
        };
    }

    // 修改保存统计数据的方法
    async saveStats() {
        try {
            const statsPath = path.join(this.rootDir, 'config/stats.json');
            const stats = {
                startTime: this.startTime,
                lastUpdate: new Date().toISOString(),
                totalTraffic: {
                    received: String(this.totalTraffic.received),
                    sent: String(this.totalTraffic.sent)
                },
                streams: {}
            };

            // 保存每个流的统计信息
            for (const [streamId, streamStats] of this.trafficStats) {
                stats.streams[streamId] = {
                    startTime: streamStats.startTime,
                    bytesReceived: streamStats.bytesReceived,
                    bytesSent: streamStats.bytesSent,
                    lastUpdate: streamStats.lastUpdate
                };
            }

            await fs.promises.writeFile(statsPath, JSON.stringify(stats, null, 2));
            logger.info('Stats saved successfully');
        } catch (error) {
            logger.error('Error saving stats:', error);
        }
    }

    // 修改加载统计数据的方法
    async loadStats() {
        try {
            const statsPath = path.join(this.rootDir, 'config/stats.json');
            if (fs.existsSync(statsPath)) {
                const data = await fs.promises.readFile(statsPath, 'utf8');
                if (data.trim()) {
                    const stats = JSON.parse(data);
                    
                    // 恢复总流量统计
                    if (stats.totalTraffic) {
                        this.totalTraffic.received = BigInt(stats.totalTraffic.received || '0');
                        this.totalTraffic.sent = BigInt(stats.totalTraffic.sent || '0');
                    }

                    // 恢复每个流的统计信息
                    if (stats.streams) {
                        for (const [streamId, streamStats] of Object.entries(stats.streams)) {
                            this.trafficStats.set(streamId, {
                                startTime: new Date(streamStats.startTime),
                                bytesReceived: streamStats.bytesReceived,
                                bytesSent: streamStats.bytesSent,
                                lastUpdate: new Date(streamStats.lastUpdate),
                                segments: new Set()
                            });
                        }
                    }

                    logger.info('Stats loaded successfully');
                }
            }
        } catch (error) {
            logger.error('Error loading stats:', error);
            // 重置统计数据
            this.totalTraffic.received = 0n;
            this.totalTraffic.sent = 0n;
            this.trafficStats.clear();
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
        // 如果心跳配置被禁用，直接返回
        if (!this.heartbeatConfig.enabled) {
            return;
        }

        let retryCount = 0;
        
        const sendHeartbeat = async () => {
            try {
                const publicIP = await this.getPublicIP();
                const stats = this.getStats();
                
                // 构建心跳数据
                const heartbeatData = {
                    serverName: this.heartbeatConfig.serverName,
                    serverAddress: `${publicIP}:${this.config.server.port}`,
                    serverIp: publicIP,
                    version: this.config.version,
                    uptime: stats.uptime,
                    totalStreams: stats.totalStreams,
                    activeStreams: stats.activeStreams,
                    traffic: stats.traffic,
                    systemInfo: {
                        platform: process.platform,
                        arch: process.arch,
                        nodeVersion: process.version,
                        memory: {
                            total: require('os').totalmem(),
                            free: require('os').freemem()
                        },
                        cpu: require('os').cpus()
                    },
                    timestamp: new Date().toISOString()
                };

                // 发送心跳请求，设置较短的超时时间
                await axios({
                    method: 'post',
                    url: this.heartbeatConfig.server,
                    data: heartbeatData,
                    headers: {
                        'Content-Type': 'application/json',
                        'User-Agent': 'RTMP-Proxy/1.0'
                    },
                    timeout: 3000 // 缩短超时时间到3秒
                });

                // 心跳成功，重置重试计数
                retryCount = 0;
                
                // 仅在调试模式下记录心跳成功
                if (process.env.DEBUG) {
                    logger.debug('Heartbeat sent successfully');
                }

            } catch (error) {
                // 心跳失败时不影响主程序，只在调试模式下记录错误
                if (process.env.DEBUG) {
                    logger.debug('Heartbeat failed:', {
                        server: this.heartbeatConfig.server,
                        retryCount,
                        timestamp: new Date().toISOString()
                    });
                }

                // 增加重试延迟
                retryCount++;
                if (retryCount >= this.heartbeatConfig.maxRetries) {
                    // 达到最大重试次数后，暂时禁用心跳一段时间
                    if (this.heartbeatInterval) {
                        clearInterval(this.heartbeatInterval);
                        this.heartbeatInterval = null;
                    }
                    
                    // 30分钟后重新尝试启动心跳
                    setTimeout(() => {
                        this.startHeartbeat();
                    }, 30 * 60 * 1000);
                    
                    return;
                }
            }
        };

        try {
            // 立即发送第一次心跳，但不等待结果
            sendHeartbeat().catch(() => {});

            // 设置定期发送心跳
            this.heartbeatInterval = setInterval(sendHeartbeat, this.heartbeatConfig.interval);

            // 添加进程退出时的清理
            process.once('SIGTERM', () => {
                if (this.heartbeatInterval) {
                    clearInterval(this.heartbeatInterval);
                    this.heartbeatInterval = null;
                }
            });

            process.once('SIGINT', () => {
                if (this.heartbeatInterval) {
                    clearInterval(this.heartbeatInterval);
                    this.heartbeatInterval = null;
                }
            });
        } catch (error) {
            // 心跳启动失败时不影响主程序
            if (process.env.DEBUG) {
                logger.debug('Failed to start heartbeat service:', error);
            }
        }
    }

    // 修改获取公网IP的方法
    async getPublicIP() {
        // 添加缓存
        if (this._cachedIP && (Date.now() - this._lastIPCheck) < 300000) { // 5分钟缓存
            return this._cachedIP;
        }

        try {
            // 首先检查环境变量
            if (process.env.SERVER_HOST) {
                this._cachedIP = process.env.SERVER_HOST;
                this._lastIPCheck = Date.now();
                return this._cachedIP;
            }

            const services = [
                {
                    url: 'https://api.ipify.org?format=json',
                    parser: (data) => typeof data === 'string' ? data.trim() : data.ip
                },
                {
                    url: 'https://api.ip.sb/ip',
                    parser: (data) => data.trim()
                },
                {
                    url: 'https://api64.ipify.org?format=json',
                    parser: (data) => data.ip
                }
            ];

            const axiosConfig = {
                timeout: 3000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            };

            // 使用 Promise.race 获取最快的响应
            const requests = services.map(service => 
                axios.get(service.url, axiosConfig)
                    .then(response => {
                        const ip = service.parser(response.data);
                        if (ip && /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) {
                            return ip;
                        }
                        throw new Error('Invalid IP format');
                    })
                    .catch(() => null)
            );

            const ip = await Promise.race(requests);
            
            if (ip) {
                this._cachedIP = ip;
                this._lastIPCheck = Date.now();
                logger.info(`Successfully obtained public IP: ${ip}`);
                return ip;
            }

            // 如果获取公网IP失败，使用本地IP
            const interfaces = require('os').networkInterfaces();
            for (const iface of Object.values(interfaces)) {
                for (const alias of iface) {
                    if (alias.family === 'IPv4' && !alias.internal) {
                        this._cachedIP = alias.address;
                        this._lastIPCheck = Date.now();
                        logger.info(`Using local IP: ${alias.address}`);
                        return alias.address;
                    }
                }
            }

            // 最后的后备方案
            this._cachedIP = '127.0.0.1';
            this._lastIPCheck = Date.now();
            return this._cachedIP;

        } catch (error) {
            logger.error('Error getting IP:', error);
            return process.env.SERVER_HOST || '127.0.0.1';
        }
    }

    // 添加加载自启动流配置的方法
    loadAutoStartStreams() {
        try {
            const autoStartPath = path.join(this.rootDir, 'config/autostart.json');
            if (fs.existsSync(autoStartPath)) {
                const data = fs.readFileSync(autoStartPath, 'utf8');
                if (data.trim()) {  // 检查文件是否为空
                    const autoStartList = JSON.parse(data);
                    this.autoStartStreams = new Set(autoStartList);
                } else {
                    this.autoStartStreams = new Set();
                    // 写入空数组到文件
                    fs.writeFileSync(autoStartPath, '[]');
                }
            } else {
                // 如果文件不存在，创建包含空数组的文件
                fs.writeFileSync(autoStartPath, '[]');
                this.autoStartStreams = new Set();
            }
            logger.info(`Loaded ${this.autoStartStreams.size} auto-start streams`);
        } catch (error) {
            logger.error('Error loading auto-start streams:', error);
            this.autoStartStreams = new Set();
            // 尝试重新创建文件
            try {
                fs.writeFileSync(path.join(this.rootDir, 'config/autostart.json'), '[]');
            } catch (e) {
                logger.error('Error creating autostart.json:', e);
            }
        }
    }

    // 添加保存自启动流配置的方法
    async saveAutoStartStreams() {
        try {
            const autoStartPath = path.join(this.rootDir, 'config/autostart.json');
            const autoStartList = Array.from(this.autoStartStreams);
            await fs.promises.writeFile(autoStartPath, JSON.stringify(autoStartList, null, 2));
            logger.info(`Saved ${autoStartList.length} auto-start streams`);
            return true;
        } catch (error) {
            logger.error('Error saving auto-start streams:', error);
            return false;
        }
    }

    // 添加启动自启动流的方法
    async startAutoStartStreams() {
        logger.info(`Starting ${this.autoStartStreams.size} auto-start streams...`);
        for (const streamId of this.autoStartStreams) {
            try {
                if (this.streams.has(streamId)) {
                    await this.startStreaming(streamId, true);
                    logger.info(`Auto-started stream: ${streamId}`);
                } else {
                    logger.warn(`Auto-start stream not found: ${streamId}`);
                    this.autoStartStreams.delete(streamId);
                }
            } catch (error) {
                logger.error(`Error auto-starting stream: ${streamId}`, error);
            }
        }
        await this.saveAutoStartStreams();
    }

    // 添加设置自启动状态的方法
    async setAutoStart(streamIds, autoStart) {
        let updated = false;
        for (const streamId of streamIds) {
            if (this.streams.has(streamId)) {
                if (autoStart) {
                    this.autoStartStreams.add(streamId);
                } else {
                    this.autoStartStreams.delete(streamId);
                }
                updated = true;
            }
        }
        if (updated) {
            await this.saveAutoStartStreams();
        }
        return updated;
    }

    // 添加获取自启动状态的方法
    isAutoStart(streamId) {
        return this.autoStartStreams.has(streamId);
    }

    // 添加流量统计方法
    initTrafficStats(streamId) {
        this.trafficStats.set(streamId, {
            startTime: new Date(),
            bytesReceived: 0,
            bytesSent: 0,
            lastUpdate: new Date(),
            segments: new Set() // 用于追踪已统计的分片
        });
    }

    // 更新流量统计
    updateTrafficStats(streamId, receivedBytes, sentBytes) {
        const stats = this.trafficStats.get(streamId);
        if (stats) {
            stats.bytesReceived += receivedBytes;
            stats.bytesSent += sentBytes;
            stats.lastUpdate = new Date();
        }
    }

    // 获取流的运行时间和流量统计
    getStreamStats(streamId) {
        const stats = this.trafficStats.get(streamId);
        if (!stats) return null;

        const now = new Date();
        const uptime = now - stats.startTime;
        
        return {
            uptime: this.formatUptime(uptime),
            bytesReceived: this.formatBytes(stats.bytesReceived),
            bytesSent: this.formatBytes(stats.bytesSent),
            startTime: stats.startTime.toISOString()
        };
    }

    // 格式化运行时间
    formatUptime(ms) {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        const parts = [];
        if (days > 0) parts.push(`${days}天`);
        if (hours % 24 > 0) parts.push(`${hours % 24}时`);
        if (minutes % 60 > 0) parts.push(`${minutes % 60}分`);
        if (seconds % 60 > 0) parts.push(`${seconds % 60}秒`);

        return parts.length > 0 ? parts.join('') : '刚刚启动';
    }

    // 格式化字节数
    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    // 修改停止流方法
    async stopStreaming(streamId) {
        try {
            // ... 现有的停止流代码 ...

            // 保存最终的流量统计
            const stats = this.trafficStats.get(streamId);
            if (stats) {
                const stream = this.streams.get(streamId);
                if (stream && stream.stats) {
                    stream.stats.lastTraffic = {
                        bytesReceived: stats.bytesReceived,
                        bytesSent: stats.bytesSent,
                        endTime: new Date()
                    };
                }
                this.trafficStats.delete(streamId);
            }

            // ... 其他清理代码 ...
        } catch (error) {
            logger.error(`Error stopping stream ${streamId}:`, error);
            throw error;
        }
    }

    // 保存统计信息到文件
    async saveStats() {
        try {
            const statsPath = path.join(this.rootDir, 'config/stats.json');
            const stats = {
                startTime: this.startTime,
                lastUpdate: new Date().toISOString(),
                totalTraffic: {
                    received: String(this.totalTraffic.received),
                    sent: String(this.totalTraffic.sent)
                },
                streams: {}
            };

            // 保存每个流的统计信息
            for (const [streamId, streamStats] of this.trafficStats) {
                stats.streams[streamId] = {
                    startTime: streamStats.startTime,
                    bytesReceived: streamStats.bytesReceived,
                    bytesSent: streamStats.bytesSent,
                    lastUpdate: streamStats.lastUpdate
                };
            }

            await fs.promises.writeFile(statsPath, JSON.stringify(stats, null, 2));
            logger.info('Stats saved successfully');
        } catch (error) {
            logger.error('Error saving stats:', error);
        }
    }

    // 添加获取完整统计信息的方法
    getStats() {
        const now = Date.now();
        const uptime = now - this.startTime;
        
        // 计算活跃流数量
        const activeStreams = Array.from(this.streamProcesses.keys()).filter(streamId => {
            const process = this.streamProcesses.get(streamId);
            return process && process.ffmpeg && !process.ffmpeg.killed;
        });

        // 计算总观看人数
        let totalViewers = 0;
        for (const viewers of this.activeViewers.values()) {
            totalViewers += viewers;
        }

        // 计算总流量
        const totalReceived = Number(this.totalTraffic.received);
        const totalSent = Number(this.totalTraffic.sent);

        return {
            uptime: this.formatUptime(uptime),
            traffic: {
                received: this.formatBytes(totalReceived),
                sent: this.formatBytes(totalSent)
            },
            totalStreams: this.streams.size,
            activeStreams: activeStreams.length,
            totalViewers: totalViewers,
            lastUpdate: new Date().toISOString()
        };
    }

    // 在 StreamManager 类中添加这个方法
    getStreamById(streamId) {
        // 尝试不同形式的streamId
        const possibleIds = [
            streamId,
            `stream_${streamId}`,
            streamId.startsWith('stream_') ? streamId.substring(7) : streamId
        ];

        for (const id of possibleIds) {
            const stream = this.streams.get(id);
            if (stream) {
                return stream;
            }
        }

        return null;
    }
}

module.exports = { StreamManager }; 
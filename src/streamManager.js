const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const logger = require('./utils/logger');
const axios = require('axios');
const EventEmitter = require('events');
const config = require('../config/config.json');
const fsPromises = require('fs').promises;
const { spawn } = require('child_process');

class StreamManager extends EventEmitter {
    constructor() {
        super();
        
        // 初始化根目录和其他目录
        this.rootDir = process.cwd();
        this.configDir = path.join(this.rootDir, 'config');
        this.streamsDir = path.join(this.rootDir, 'streams');
        this.logsDir = path.join(this.rootDir, 'logs');
        
        // 初始化配置文件路径
        this.configPath = path.join(this.configDir, 'streams.json');
        this.statsPath = path.join(this.configDir, 'stats.json');
        this.autoStartPath = path.join(this.configDir, 'autostart.json');
        
        // 使用配置中的名称和版本
        this.appName = config.name;
        this.version = config.version;
        this.config = config;
        
        // 初始化所有必要的 Map 和 Set
        this.streams = new Map();
        this.streamProcesses = new Map();
        this.retryStatus = new Map();
        this.retryCounters = new Map();
        this.streamStats = new Map();
        this.healthChecks = new Map();
        this.serverPorts = new Map();
        this.failureCount = new Map();
        this.activeViewers = new Map();
        this.autoStopTimers = new Map();
        this.manuallyStartedStreams = new Set();
        this.autoStartStreams = new Set();

        // 确保所有必要的目录存在
        this.ensureDirectories();
        
        // 加载流配置并立即启动所有流
        this.loadStreams();
        this.loadStats();
        this.loadAutoStartStreams();
        
        // 确保在所有配置加载完成后启动流
        setImmediate(() => {
            this.startAllStreams().catch(error => {
                logger.error('Error starting all streams:', error);
            });
        });

        // 添加检查源可用性的方法
        this.checkStreamSource = async (url) => {
            try {
                const response = await axios.head(url, { timeout: 5000 });
                return response.status === 200;
            } catch (error) {
                logger.warn(`Stream source check failed for ${url}:`, error.message);
                return true; // 暂时返回 true，避免因检查失败而阻止流启动
            }
        };

        // 添加构建 FFmpeg 参数的方法
        this.buildFFmpegArgs = (stream, outputDir) => {
            return [
                '-i', stream.url,
                '-c', 'copy',
                '-f', 'flv',
                `${this.config.rtmp.pushServer}${stream.id}`
            ];
        };

        // 添加进程监控设置方法
        this.setupProcessMonitoring = (streamId, process) => {
            process.stdout.on('data', (data) => {
                logger.debug(`FFmpeg stdout [${streamId}]: ${data}`);
            });

            process.stderr.on('data', (data) => {
                logger.debug(`FFmpeg stderr [${streamId}]: ${data}`);
            });

            process.on('close', (code) => {
                logger.info(`FFmpeg process exited with code ${code} [${streamId}]`);
                this.handleStreamExit(streamId, code);
            });
        };

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
        
        // 修改心跳配置
        this.heartbeatConfig = {
            enabled: true,
            server: `https://${config.name}.zhoujie218.top/api/heartbeat`,
            interval: 5000,
            timeout: 10000,
            retryDelay: 5000,
            maxRetries: 3,
            serverName: require('os').hostname(),
            appName: config.name,
            version: config.version
        };

        // 启动心跳
        if (this.heartbeatConfig.enabled) {
            this.startHeartbeat();
        }

        // 在 constructor 中添加调试日志
        logger.info(`Starting ${config.name} version ${config.version}`);
        logger.info('Environment version:', process.env.APP_VERSION);
        logger.info('Config file version:', config.version);
        logger.info('Final config version:', this.config.version);

        // 添加自启动流的集合
        this.autoStartStreams = new Set();
        
        // 从配置文件加载自启动流列表
        this.loadAutoStartStreams();
        
        // 启动时自动启动已配置的流
        this.startAutoStartStreams();

        // 修改重试配置
        this.retryConfig = {
            immediate: {
                attempts: 3,        // 立即重试3次
                interval: 20000     // 20秒内
            },
            recovery: {
                intervals: [
                    5 * 60 * 1000,   // 5分钟后
                    20 * 60 * 1000,  // 20分钟后
                    20 * 60 * 1000   // 之后每20分钟
                ]
            }
        };

        this.configStats = {
            startTime: Date.now(),
            uptime: 0,
            errors: 0
        };

        this.streamsDir = path.join(this.rootDir, 'streams');
        this.ensureDirectories();
    }

    async ensureDirectories() {
        const dirs = [this.configDir, this.streamsDir, this.logsDir];
        
        for (const dir of dirs) {
            try {
                await fsPromises.mkdir(dir, { recursive: true });
                logger.info(`Directory created/verified: ${dir}`);
            } catch (error) {
                logger.error(`Error creating directory ${dir}:`, error);
            }
        }
    }

    async prepareStreamDirectory(streamId) {
        if (!streamId || typeof streamId !== 'string') {
            throw new Error('Invalid stream ID');
        }

        const streamDir = path.join(this.streamsDir, streamId);
        
        try {
            await fsPromises.mkdir(streamDir, { recursive: true });
            logger.info(`Created stream directory: ${streamDir}`);
            return streamDir;
        } catch (error) {
            logger.error(`Failed to create stream directory: ${streamDir}`, error);
            throw error;
        }
    }

    // 修改加载流的方法
    async loadStreams() {
        logger.info('Starting to load streams...');
        try {
            if (fs.existsSync(this.configPath)) {
                logger.info(`Config file exists at: ${this.configPath}`);
                const data = fs.readFileSync(this.configPath, 'utf8');
                const streams = JSON.parse(data);
                
                // 加载所有流到 Map 中
                streams.forEach(stream => {
                    this.streams.set(stream.id, stream);
                });
                
                logger.info(`Successfully loaded ${streams.length} streams`);
            } else {
                logger.warn(`Config file not found at: ${this.configPath}`);
                logger.info('Created new empty config file');
                fs.writeFileSync(this.configPath, JSON.stringify([], null, 2));
            }
        } catch (error) {
            logger.error('Error loading streams:', error);
        }
    }

    // 修改启动所有流的方法,移除失效流检查
    async startAllStreams() {
        const streams = Array.from(this.streams.values());
        logger.info(`Starting all ${streams.length} streams...`);

        const startPromises = streams.map(async (stream) => {
            try {
                await this.startStreaming(stream.id);
                logger.info(`Successfully started stream: ${stream.id}`);
            } catch (error) {
                logger.error(`Failed to start stream ${stream.id}:`, error);
                // 错误交给重试机制处理
            }
        });

        await Promise.all(startPromises);
        logger.info(`Finished starting all streams`);
    }

    // 修改 startStreaming 方法
    async startStreaming(streamId) {
        try {
            const stream = this.streams.get(streamId);
            if (!stream) {
                throw new Error(`Stream ${streamId} not found`);
            }

            // 检查流是否已经在运行
            if (this.streamProcesses.has(streamId)) {
                logger.info(`Stream ${streamId} is already running`);
                return { success: true };
            }

            // 初始化重试状态
            if (!this.retryStatus.has(streamId)) {
                this.retryStatus.set(streamId, {
                    immediateRetries: 0,
                    recoveryAttempts: 0,
                    isInRecovery: false
                });
            }

            // 初始化重试计数器
            if (!this.retryCounters.has(streamId)) {
                this.retryCounters.set(streamId, {
                    total: 0,
                    lastRetryTime: null
                });
            }

            // 启动流进程
            const result = await this.startStreamProcess(streamId);
            if (!result.success) {
                await this.handleStreamError(streamId, result.error);
            }

            return result;
        } catch (error) {
            logger.error(`Error starting stream ${streamId}:`, error);
            await this.handleStreamError(streamId, error);
            throw error;
        }
    }

    async startStreamProcess(streamId) {
        const stream = this.streams.get(streamId);
        if (!stream) {
            return { success: false, error: 'Stream not found' };
        }

        try {
            // 检查源是否可用
            const sourceAvailable = await this.checkStreamSource(stream.url);
            if (!sourceAvailable) {
                throw new Error('Stream source not available');
            }

            // 准备输出目录
            const outputDir = path.join(this.streamsDir, streamId);
            await this.ensureAndCleanDirectory(outputDir);

            // 获取推流地址
            const outputUrl = `${this.config.rtmp.pushServer}${streamId}`;

            // 启动 FFmpeg 进程
            const ffmpeg = this.spawnFFmpeg(streamId, stream.url, outputUrl);
            
            // 保存进程引用
            this.streamProcesses.set(streamId, {
                ffmpeg,
                startTime: Date.now(),
                lastSegmentTime: Date.now()
            });

            // 更新流状态
            stream.processRunning = true;
            stream.manuallyStarted = true;
            stream.lastStartTime = Date.now();

            // 初始化或更新统计信息
            if (!this.streamStats.has(streamId)) {
                this.streamStats.set(streamId, {
                    startTime: Date.now(),
                    uptime: 0,
                    errors: 0,
                    restarts: 0
                });
            }

            logger.info(`Started FFmpeg process for stream ${streamId}`);
            return { success: true };
        } catch (error) {
            logger.error(`Failed to start stream ${streamId}:`, error);
            return { success: false, error };
        }
    }

    // 添加新的辅助方法
    async ensureAndCleanDirectory(outputPath) {
        try {
            await fsPromises.mkdir(outputPath, { recursive: true });
            
            // 清理旧文件
            const files = await fsPromises.readdir(outputPath);
            for (const file of files) {
                if (file.endsWith('.ts') || file.endsWith('.m3u8')) {
                    try {
                        await fsPromises.unlink(path.join(outputPath, file));
                    } catch (err) {
                        logger.warn(`Failed to delete file ${file}: ${err.message}`);
                    }
                }
            }
        } catch (error) {
            logger.error(`Error preparing directory ${outputPath}:`, error);
            throw error;
        }
    }

    monitorOutputDirectory(outputPath, streamId) {
        const checkInterval = setInterval(() => {
            fs.readdir(outputPath, (err, files) => {
                if (err) {
                    logger.error(`Error reading directory ${outputPath}:`, err);
                    return;
                }

                // 检查分片文件数量
                const segments = files.filter(f => f.endsWith('.ts'));
                if (segments.length > 10) {
                    // 删除旧的分片文件
                    segments.slice(0, -10).forEach(segment => {
                        fs.unlink(path.join(outputPath, segment), err => {
                            if (err) logger.warn(`Failed to delete old segment ${segment}:`, err);
                        });
                    });
                }
            });
        }, 5000); // 每5秒检查一次

        // 保存检查间隔引用
        this.healthChecks.set(streamId, checkInterval);
    }

    setupProcessMonitoring(streamId, ffmpeg, lastSegmentTime) {
        const monitor = setInterval(() => {
            const process = this.streamProcesses.get(streamId);
            if (!process || !process.ffmpeg) {
                clearInterval(monitor);
                return;
            }

            // 检查进程是否还活着
            if (process.ffmpeg.killed || !process.ffmpeg.pid) {
                clearInterval(monitor);
                this.handleStreamError(streamId, new Error('Process died'));
                return;
            }

            // 检查最后分片时间
            const now = Date.now();
            if (now - process.lastSegmentTime > 30000) { // 30秒没有新分片
                logger.warn(`No new segments for stream ${streamId} in 30s, restarting...`);
                this.restartStream(streamId, process.isManualStart);
                clearInterval(monitor);
            }
        }, 5000); // 每5秒检查一次
    }

    waitForPlaylist(outputPath, resolve, reject) {
        const playlistPath = path.join(outputPath, 'playlist.m3u8');
        let attempts = 0;
        const maxAttempts = 30; // 30秒超时
        
        const checkPlaylist = setInterval(() => {
            if (fs.existsSync(playlistPath)) {
                clearInterval(checkPlaylist);
                resolve();
            } else if (++attempts >= maxAttempts) {
                clearInterval(checkPlaylist);
                reject(new Error('Playlist creation timeout'));
            }
        }, 1000);
    }

    // 修改错误处理方法
    async handleStreamError(streamId, error) {
        const status = this.retryStatus.get(streamId);
        const counter = this.retryCounters.get(streamId);
        
        logger.error(`Stream ${streamId} error:`, error);

        // 更新重试计数
        counter.total++;
        counter.lastRetryTime = Date.now();

        if (!status.isInRecovery) {
            // 处理即时重试(20秒内3次)
            if (status.immediateRetries < this.retryConfig.immediate.attempts) {
                status.immediateRetries++;
                logger.info(`Immediate retry ${status.immediateRetries}/3 for stream ${streamId}`);
                
                setTimeout(async () => {
                    try {
                        await this.startStreamProcess(streamId);
                        logger.info(`Immediate retry ${status.immediateRetries} succeeded for stream ${streamId}`);
                        // 重试成功,重置状态
                        this.resetRetryStatus(streamId);
                    } catch (error) {
                        logger.error(`Immediate retry ${status.immediateRetries} failed for stream ${streamId}:`, error);
                        // 失败继续交给重试机制处理
                    }
                }, 2000); // 2秒后重试
                
                return;
            }

            // 立即重试全部失败,进入恢复模式
            status.isInRecovery = true;
            status.immediateRetries = 0;
            status.recoveryAttempts = 0;
        }

        // 处理恢复重试
        const interval = this.getRecoveryInterval(status.recoveryAttempts);
        status.recoveryAttempts++;

        logger.info(`Scheduling recovery attempt for stream ${streamId} in ${interval/1000/60} minutes`);
        
        setTimeout(async () => {
            try {
                // 进入恢复重试时也使用立即重试机制
                status.immediateRetries = 0;
                status.isInRecovery = true;
                
                // 开始新一轮立即重试
                await this.startStreamProcess(streamId);
                logger.info(`Recovery attempt succeeded for stream ${streamId}`);
                // 重试成功,重置状态
                this.resetRetryStatus(streamId);
            } catch (error) {
                logger.error(`Recovery attempt failed for stream ${streamId}:`, error);
                // 失败继续交给重试机制处理
            }
        }, interval);
    }

    // 修改获取恢复间隔的方法
    getRecoveryInterval(attemptCount) {
        const intervals = this.retryConfig.recovery.intervals;
        if (attemptCount < intervals.length) {
            return intervals[attemptCount];
        }
        return intervals[intervals.length - 1]; // 使用最后一个间隔(20分钟)持续重试
    }

    // 修改重置重试状态的方法
    resetRetryStatus(streamId) {
        this.retryStatus.set(streamId, {
            immediateRetries: 0,
            recoveryAttempts: 0,
            isInRecovery: false
        });
        
        // 重置重试计数器
        this.retryCounters.set(streamId, {
            total: 0,
            lastRetryTime: null
        });

        logger.info(`Reset retry status for stream ${streamId}`);
    }

    handleStreamExit(streamId, code, error, retryCount, maxRetries) {
        if (code !== 0) {
            logger.error(`Stream ${streamId} exited with code ${code}`);
            if (error) logger.error(`Stream error: ${error}`);
            
            if (retryCount < maxRetries) {
                setTimeout(() => {
                    const wasManuallyStarted = this.manuallyStartedStreams.has(streamId);
                    this.restartStream(streamId, wasManuallyStarted);
                }, 5000);
            } else {
                this.stopStreaming(streamId);
            }
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

            // 获取重试状态
            const status = this.retryStatus.get(streamId) || {
                immediateRetries: 0,
                recoveryAttempts: 0,
                lastErrorTime: 0,
                isInRecovery: false
            };

            // 如果正在恢复模式，记录尝试
            if (status.isInRecovery) {
                logger.info(`Recovery attempt for stream ${streamId}`);
            }

            logger.info(`Restarting stream: ${streamId} (manual: ${isManualStart})`);
            await this.forceStopStreaming(streamId);
            await new Promise(resolve => setTimeout(resolve, 5000));  // 等待5秒
            await this.startStreaming(streamId, isManualStart);

        } catch (error) {
            logger.error(`Error restarting stream: ${streamId}`, error);
            // 如果重启失败，交给错误处理机制
            this.handleStreamError(streamId, error);
        }
    }

    // 添加 streamlink 作为备选方案
    async startStreamingWithStreamlink(streamId, streamConfig) {
        const { spawn } = require('child_process');
        const outputPath = path.join(this.streamsDir, streamId);

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
            // 清理重试状态
            this.retryCounters.delete(streamId);
            this.retryStatus.delete(streamId);
            
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
                const outputPath = path.join(this.streamsDir, streamId);
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
                const outputPath = path.join(this.streamsDir, streamId, 'playlist.m3u8');
                
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
            const streamsDir = path.join(this.streamsDir);
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
                const outputPath = path.join(this.streamsDir, streamId);
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
        const playlistPath = path.join(this.streamsDir, streamId, 'playlist.m3u8');
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
                const oldPath = path.join(this.streamsDir, streamId);
                const newPath = path.join(this.streamsDir, newId);
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
                const streamPath = path.join(this.streamsDir, streamId);
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
            const statsPath = path.join(this.configDir, 'stats.json');
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

            await fsPromises.writeFile(statsPath, JSON.stringify(stats, null, 2));
            logger.info('Stats saved successfully');
        } catch (error) {
            logger.error('Error saving stats:', error);
        }
    }

    // 修改加载统计数据的方法
    async loadStats() {
        try {
            if (fs.existsSync(this.statsPath)) {
                const data = await fsPromises.readFile(this.statsPath, 'utf8');
                const stats = JSON.parse(data);
                this.streamStats = new Map(Object.entries(stats));
                logger.info('Stats loaded successfully');
            } else {
                logger.info('No existing stats file found, creating new one');
                await this.saveStats();
            }
        } catch (error) {
            logger.error('Error loading stats:', error);
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
    async loadAutoStartStreams() {
        try {
            if (fs.existsSync(this.autoStartPath)) {
                const data = await fsPromises.readFile(this.autoStartPath, 'utf8');
                const autoStartStreams = JSON.parse(data);
                this.autoStartStreams = new Set(autoStartStreams);
                logger.info(`Loaded ${this.autoStartStreams.size} auto-start streams`);
            } else {
                logger.info('Creating new auto-start streams file');
                await fsPromises.writeFile(this.autoStartPath, '[]');
            }
        } catch (error) {
            logger.error('Error loading auto-start streams:', error);
        }
    }

    // 添加保存自启动流配置的方法
    async saveAutoStartStreams() {
        try {
            const autoStartPath = path.join(this.configDir, 'autostart.json');
            const autoStartList = Array.from(this.autoStartStreams);
            await fsPromises.writeFile(autoStartPath, JSON.stringify(autoStartList, null, 2));
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

    // 添加恢复调度方法
    async scheduleStreamRecovery(streamId) {
        const status = this.retryStatus.get(streamId);
        if (!status) return;

        const stream = this.streams.get(streamId);
        if (!stream) return;

        // 检查是否达到最大恢复尝试次数
        if (this.retryConfig.maxRecoveryAttempts > 0 && 
            status.recoveryAttempts >= this.retryConfig.maxRecoveryAttempts) {
            logger.error(`Stream ${streamId} reached maximum recovery attempts, giving up`);
            return;
        }

        status.recoveryAttempts++;
        logger.info(`Scheduling recovery attempt ${status.recoveryAttempts} for stream ${streamId} in ${this.retryConfig.recoveryDelay/1000} seconds`);

        // 设置恢复定时器
        setTimeout(async () => {
            try {
                // 尝试检查源是否可用
                const isSourceAvailable = await this.checkStreamSource(stream.url);
                
                if (isSourceAvailable) {
                    logger.info(`Stream source for ${streamId} is available, attempting recovery`);
                    const wasManuallyStarted = this.manuallyStartedStreams.has(streamId);
                    await this.restartStream(streamId, wasManuallyStarted);
                    
                    // 重置重试状态
                    status.isInRecovery = false;
                    status.recoveryAttempts = 0;
                    status.immediateRetries = 0;
                    
                } else {
                    logger.warn(`Stream source for ${streamId} is still unavailable`);
                    // 继续调度下一次恢复
                    this.scheduleStreamRecovery(streamId);
                }
            } catch (error) {
                logger.error(`Error during recovery attempt for stream ${streamId}:`, error);
                // 继续调度下一次恢复
                this.scheduleStreamRecovery(streamId);
            }
        }, this.retryConfig.recoveryDelay);
    }

    // 添加源可用性检查方法
    async checkStreamSource(url) {
        try {
            // 对于 HTTP/HTTPS 流
            if (url.startsWith('http')) {
                const response = await axios.head(url, {
                    timeout: 5000,
                    validateStatus: null
                });
                return response.status >= 200 && response.status < 400;
            }
            
            // 对于 RTMP 流，可以尝试建立连接
            if (url.startsWith('rtmp')) {
                // 使用 ffprobe 检查
                return new Promise((resolve) => {
                    const ffprobe = spawn('ffprobe', [
                        '-v', 'quiet',
                        '-print_format', 'json',
                        '-show_format',
                        '-i', url,
                        '-timeout', '5000000'  // 5秒超时
                    ]);

                    let output = '';
                    ffprobe.stdout.on('data', (data) => {
                        output += data.toString();
                    });

                    ffprobe.on('exit', (code) => {
                        resolve(code === 0);
                    });

                    // 设置超时
                    setTimeout(() => {
                        ffprobe.kill();
                        resolve(false);
                    }, 5000);
                });
            }

            // 其他类型的流
            return true;  // 默认假设可用，让重试机制来验证

        } catch (error) {
            logger.error(`Error checking stream source ${url}:`, error);
            return false;
        }
    }

    // 添加获取重试信息的方法
    getRetryInfo(streamId) {
        const status = this.retryStatus.get(streamId) || {
            immediateRetries: 0,
            recoveryAttempts: 0,
            isInRecovery: false
        };
        
        const counter = this.retryCounters.get(streamId) || {
            total: 0,
            lastRetryTime: null
        };

        return {
            immediateRetries: status.immediateRetries,
            recoveryAttempts: status.recoveryAttempts,
            isInRecovery: status.isInRecovery,
            totalRetries: counter.total,
            lastRetryTime: counter.lastRetryTime
        };
    }

    // 添加 spawnFFmpeg 函数
    spawnFFmpeg(streamId, inputUrl, outputUrl) {
        const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
        const ffmpeg = spawn(ffmpegPath, [
            '-i', inputUrl,
            '-c', 'copy',
            '-f', 'flv',
            outputUrl
        ]);

        ffmpeg.stdout.on('data', (data) => {
            logger.debug(`FFmpeg stdout [${streamId}]: ${data}`);
        });

        ffmpeg.stderr.on('data', (data) => {
            logger.debug(`FFmpeg stderr [${streamId}]: ${data}`);
        });

        ffmpeg.on('close', (code) => {
            logger.info(`FFmpeg process exited with code ${code} [${streamId}]`);
            this.handleStreamExit(streamId, code);
        });

        return ffmpeg;
    }

    // 修改添加流的方法,添加后自动启动
    async addStream(streamData) {
        try {
            // 生成唯一ID
            const streamId = `stream_${Math.random().toString(36).substr(2, 6)}`;
            
            // 构建流对象
            const stream = {
                id: streamId,
                name: streamData.name,
                url: streamData.url,
                category: streamData.category || '未分类',
                tvg: streamData.tvg || {
                    id: '',
                    name: streamData.name,
                    logo: '',
                    group: streamData.category || '未分类'
                },
                processRunning: false,
                manuallyStarted: false,
                invalid: false,
                retryInfo: {
                    immediateRetries: 0,
                    recoveryAttempts: 0,
                    isInRecovery: false,
                    totalRetries: 0,
                    lastRetryTime: null
                }
            };

            // 添加到流集合
            this.streams.set(streamId, stream);
            
            // 初始化重试状态
            this.retryStatus.set(streamId, {
                immediateRetries: 0,
                recoveryAttempts: 0,
                isInRecovery: false
            });

            // 初始化重试计数器
            this.retryCounters.set(streamId, {
                total: 0,
                lastRetryTime: null
            });

            // 保存配置
            await this.saveStreams();

            // 创建流目录
            await this.prepareStreamDirectory(streamId);

            logger.info(`Added new stream: ${streamId}`);

            // 自动启动新添加的流
            try {
                await this.startStreaming(streamId);
                logger.info(`Successfully started new stream: ${streamId}`);
            } catch (error) {
                logger.error(`Error starting new stream ${streamId}:`, error);
            }

            return {
                success: true,
                stream
            };
        } catch (error) {
            logger.error('Error adding stream:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // 保存流配置
    async saveStreams() {
        try {
            const streams = Array.from(this.streams.values());
            await fsPromises.writeFile(
                this.configPath,
                JSON.stringify(streams, null, 2)
            );
            logger.info(`Saved ${streams.length} streams to config`);
        } catch (error) {
            logger.error('Error saving streams:', error);
            throw error;
        }
    }
}

module.exports = { StreamManager }; 
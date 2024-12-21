const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const logger = require('./utils/logger');
const axios = require('axios');
const EventEmitter = require('events');

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
        
        // 创建配置目录
        const configDir = path.dirname(this.configPath);
        if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true });
        }
        
        // 加载保存的流配置
        this.loadStreams();
        
        // 每小时运行一次清理
        setInterval(() => this.cleanupUnusedFiles(), 60 * 60 * 1000);
        // 每5分钟运行一���健康检查
        setInterval(() => this.checkStreamsHealth(), 5 * 60 * 1000);
        
        // 加载配置
        this.config = require('../config/config.json');
        
        // 每秒更新一次统计信息
        setInterval(() => this.updateStats(), 1000);
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
                configs[id] = {
                    name: config.name,
                    url: config.url,
                    category: config.category,
                    kodiprop: config.kodiprop,
                    tvg: config.tvg
                };
            }
            
            // 确保配置目录存在
            const configDir = path.dirname(this.configPath);
            if (!fs.existsSync(configDir)) {
                fs.mkdirSync(configDir, { recursive: true });
            }
            
            // 写入配置文件
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

            // 使用传入的ID或生成新ID
            const streamId = streamData.id || streamData.customId ? 
                           `stream_${streamData.customId}` : 
                           generateStreamId(streamData.name, streamData.url);

            // 检查ID是否已存在
            if (this.streams.has(streamId)) {
                // 如果已存在，更新现有流
                const existingStream = this.streams.get(streamId);
                existingStream.name = streamData.name;
                existingStream.url = streamData.url;
                existingStream.category = streamData.category || '未分类';
                if (streamData.tvg) {
                    existingStream.tvg = streamData.tvg;
                }
            } else {
                // 添加新流
                this.streams.set(streamId, {
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
                });

                // 初始化统计信息
                this.streamStats.set(streamId, {
                    totalRequests: 0,
                    lastAccessed: null,
                    errors: 0,
                    uptime: 0,
                    startTime: null
                });
            }

            // 保存配置
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
            const stream = this.streams.get(streamId);
            if (!stream) {
                logger.warn(`Stream not found: ${streamId}`);
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

    async startStreaming(streamId) {
        try {
            if (this.streamProcesses.has(streamId)) {
                return;
            }

            const streamConfig = this.streams.get(streamId);
            if (!streamConfig) {
                throw new Error('Stream not found');
            }

            // 初始化统计信息
            const stats = this.streamStats.get(streamId);
            if (stats) {
                stats.startTime = new Date();
                stats.uptime = 0;
                stats.errors = 0;
            }

            // 获取统计信息引用
            const configStats = streamConfig.stats;
            
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
            await this.startStreamingWithFFmpeg(streamId, streamConfig);

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

    async startStreamingWithFFmpeg(streamId, streamConfig) {
        const { spawn } = require('child_process');
        const outputPath = path.join(__dirname, '../streams', streamId);
        
        if (!fs.existsSync(outputPath)) {
            fs.mkdirSync(outputPath, { recursive: true });
        }

        // 如果已经有进程在运行，先停止它
        if (this.streamProcesses.has(streamId)) {
            await this.stopStreaming(streamId);
        }

        // 构建 FFmpeg 输入参数
        const inputArgs = [
            '-hide_banner',          // 隐藏 banner
            '-reconnect', '1',       // 断开时重连
            '-reconnect_streamed', '1',
            '-reconnect_delay_max', '5',
            '-rw_timeout', '5000000',  // 读写超时
            '-timeout', '5000000',     // 连接超时
            '-fflags', '+genpts+igndts+discardcorrupt',  // 容错处理
            '-analyzeduration', '2000000',  // 分析时长
            '-probesize', '1000000',   // 探测大小
            '-user_agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            '-headers', 'Accept: */*\r\n',
            '-i', streamConfig.url
        ];

        // 构建 FFmpeg 输出参数
        const outputArgs = [
            '-c:v', 'copy',           // 复制视频流
            '-c:a', 'aac',           // 转换音频为 AAC
            '-b:a', '128k',          // 音频比特率
            '-ac', '2',              // 双声道
            '-ar', '44100',          // 音频采样率
            '-f', 'hls',             // HLS 格式
            '-hls_time', '2',        // 每个分片2秒
            '-hls_list_size', '6',   // 保留6个分片（约12秒）
            '-hls_flags', 'delete_segments+append_list+discont_start+independent_segments',  // HLS 标志
            '-hls_segment_type', 'mpegts',  // 分片类型
            '-hls_segment_filename', `${outputPath}/segment_%d.ts`,  // 分片文件名
            '-method', 'PUT',        // 使用 PUT 方法写入文件
            '-max_muxing_queue_size', '1024',  // 最大复用队列
            '-y',                    // 覆盖输出文件
            `${outputPath}/playlist.m3u8`  // 播放列表路径
        ];

        // 合并所有参数
        const args = [...inputArgs, ...outputArgs];

        logger.info(`Starting FFmpeg for stream: ${streamId}`);
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
                            this.restartStream(streamId);
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
                        } else if (retryCount < maxRetries) {
                            retryCount++;
                            logger.info(`Retrying stream ${streamId} (attempt ${retryCount}/${maxRetries})`);
                            setTimeout(() => {
                                this.restartStream(streamId);
                            }, retryDelay);
                        } else {
                            logger.error(`Max retries reached for stream ${streamId}, stopping stream`);
                            this.stopStreaming(streamId);
                        }
                    }
                });

                // 保存进程引用
                this.streamProcesses.set(streamId, {
                    ffmpeg,
                    startTime: new Date()
                });

                // 等待播放列表文件创建
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

        // 保存检查间隔的引用，以便后续清理
        this.healthChecks.set(streamId, checkInterval);
    }

    // 修改重启流的方法
    async restartStream(streamId) {
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

            logger.info(`Restarting stream: ${streamId}`);
            await this.forceStopStreaming(streamId);
            await new Promise(resolve => setTimeout(resolve, 5000));  // 增加等待时间到5秒
            await this.startStreaming(streamId);
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
            // 清除自动停止定时器
            if (this.autoStopTimers.has(streamId)) {
                clearTimeout(this.autoStopTimers.get(streamId));
                this.autoStopTimers.delete(streamId);
            }
            
            // 清除观看者计数
            this.activeViewers.delete(streamId);
            
            const processes = this.streamProcesses.get(streamId);
            if (processes) {
                // 停止 FFmpeg 进程
                if (processes.ffmpeg) {
                    processes.ffmpeg.kill('SIGTERM');
                }
                
                // 等待进程完全退出
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                // 清理流程序引用
                this.streamProcesses.delete(streamId);
                
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
                
                // 清理文件
                const outputPath = path.join(__dirname, '../streams', streamId);
                if (fs.existsSync(outputPath)) {
                    // 删除所有分片文件
                    const files = fs.readdirSync(outputPath);
                    for (const file of files) {
                        if (file.endsWith('.ts') || file.endsWith('.m3u8')) {
                            fs.unlinkSync(path.join(outputPath, file));
                        }
                    }
                }
                
                // 保存配置以更新状态
                await this.saveStreams();
                
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
                
                // 如果目录超过24小时未被访问且不活跃，则删除
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
        
        // 检查是否有播放列表文件
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
            
            // 如果没有观看者，启动自动停止定时器
            if (count - 1 === 0) {
                logger.debug(`No viewers left for stream ${streamId}, starting auto-stop timer`);
                const timer = setTimeout(async () => {
                    logger.info(`Auto-stopping inactive stream: ${streamId}`);
                    await this.stopStreaming(streamId);  // 使用 await 确保完全停止
                    this.autoStopTimers.delete(streamId);
                    
                    // 强制刷新状态
                    const stats = this.streamStats.get(streamId);
                    if (stats) {
                        stats.startTime = null;
                        stats.lastStopped = new Date();
                    }
                    
                    // 触发状态更新事件
                    this.emit('streamStatusChanged', streamId, 'stopped');
                }, this.config.stream.autoStopTimeout);
                
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

    // 修改导出配置方法以支持分类
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

    // 在 StreamManager 类中添加
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

                // 使用新ID重新创建流
                this.streams.delete(streamId);
                stream.id = newId;
                this.streams.set(newId, stream);

                // 更新相关的映射
                if (this.streamStats.has(streamId)) {
                    const stats = this.streamStats.get(streamId);
                    this.streamStats.delete(streamId);
                    this.streamStats.set(newId, stats);
                }
            }

            // 保存更新
            await this.saveStreams();

            return {
                success: true,
                message: '流更新成功'
            };
        } catch (error) {
            logger.error('Error updating stream:', error);
            throw error;
        }
    }
}

module.exports = { StreamManager }; 
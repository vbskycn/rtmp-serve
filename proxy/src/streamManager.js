const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const logger = require('./utils/logger');
const axios = require('axios');

class StreamManager {
    constructor() {
        this.streams = new Map();
        this.activeStreams = new Map();
        this.streamProcesses = new Map();
        this.streamStats = new Map();
        this.healthChecks = new Map();
        this.configPath = path.join(__dirname, '../config/streams.json');
        
        // 创建配置目录
        const configDir = path.dirname(this.configPath);
        if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true });
        }
        
        // 加载保存的流配置
        this.loadStreams();
        
        // 每小时运行一次清理
        setInterval(() => this.cleanupUnusedFiles(), 60 * 60 * 1000);
        // 每分钟运行一次健康检查
        setInterval(() => this.checkStreamsHealth(), 60 * 1000);
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
                // 只保存必要的配置信息，不保存运行时状态
                configs[id] = {
                    name: config.name,
                    url: config.url,
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
            if (!streamData.id || !streamData.name || !streamData.url) {
                throw new Error('缺少必要的流信息');
            }

            // 添加流到管理器
            this.streams.set(streamData.id, {
                ...streamData,
                stats: {
                    startTime: null,
                    uptime: 0,
                    errors: 0
                }
            });

            // 保存配置
            await this.saveStreams();

            // 启动流
            await this.startStreaming(streamData.id);

            return true;
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

    async getStreamUrl(id) {
        const stream = this.streams.get(id);
        if (!stream) {
            logger.warn(`Stream not found: ${id}`);
            return null;
        }
        
        // 更新访问统计
        const stats = this.streamStats.get(id) || { totalRequests: 0 };
        stats.totalRequests++;
        stats.lastAccessed = new Date();
        this.streamStats.set(id, stats);
        
        return stream.url;
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
            if (!streamConfig.stats) {
                streamConfig.stats = {
                    startTime: null,
                    uptime: 0,
                    errors: 0
                };
            }

            if (!this.streamStats.has(streamId)) {
                this.streamStats.set(streamId, {
                    totalRequests: 0,
                    lastAccessed: null,
                    errors: 0,
                    uptime: 0,
                    startTime: null
                });
            }

            const stats = this.streamStats.get(streamId);
            const configStats = streamConfig.stats;
            
            const now = new Date();
            stats.startTime = now;
            configStats.startTime = now;
            stats.errors = 0;
            configStats.errors = 0;

            // 检查是否是 DASH/MPD 流
            const isDash = streamConfig.url.includes('.mpd') || 
                          streamConfig.kodiprop?.includes('manifest_type=mpd') ||
                          streamConfig.url.includes('/dash/') ||
                          streamConfig.url.includes('dash-');

            if (isDash) {
                logger.info(`Detected DASH stream, using yt-dlp for: ${streamId}`);
                await this.startStreamingWithYtdlp(streamId, streamConfig);
                return;
            }

            // 检查流的可访问性
            try {
                const response = await axios.head(streamConfig.url, {
                    timeout: 5000,
                    maxRedirects: 5,
                    validateStatus: null,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                    }
                });

                if (response.status === 404) {
                    throw new Error('Stream URL returned 404 Not Found');
                }

                if (response.status >= 400) {
                    throw new Error(`Stream URL returned status ${response.status}`);
                }

                // 如果有重定向，使用最终的 URL
                if (response.request?.res?.responseUrl) {
                    streamConfig.url = response.request.res.responseUrl;
                }
            } catch (error) {
                logger.error(`Error checking stream URL: ${streamId}`, { error });
                // 如果 URL 检查失败，尝试使用 yt-dlp
                logger.info(`Falling back to yt-dlp for: ${streamId}`);
                await this.startStreamingWithYtdlp(streamId, streamConfig);
                return;
            }

            const outputPath = path.join(__dirname, '../streams', streamId);
            if (!fs.existsSync(outputPath)) {
                fs.mkdirSync(outputPath, { recursive: true });
            }

            // FFmpeg 输入选项
            const inputOptions = [
                '-reconnect', '1',
                '-reconnect_streamed', '1',
                '-reconnect_delay_max', '5',
                '-timeout', '15000000',
                '-allowed_extensions', 'ALL',
                '-y',
                '-nostdin',
                '-loglevel', 'warning',  // 改为 warning 级别减少日志
                '-protocol_whitelist', 'file,http,https,tcp,tls,crypto,data',
                '-re',
                '-fflags', '+genpts+igndts',
                '-analyzeduration', '15000000',
                '-probesize', '15000000'
            ];

            // 如果有 license key，添加相关头信息
            if (streamConfig.kodiprop?.includes('license_key')) {
                const licenseKey = streamConfig.kodiprop.match(/license_key=([^#\n]*)/)?.[1];
                if (licenseKey) {
                    inputOptions.push(
                        '-headers', 
                        `X-AxDRM-Message: ${licenseKey}\r\nContent-Type: application/dash+xml\r\n`
                    );
                }
            }

            // 修改输出选项
            const outputOptions = [
                '-c:v', 'copy',
                '-c:a', 'copy',
                '-f', 'hls',
                '-hls_time', '2',
                '-hls_list_size', '6',
                '-hls_flags', 'delete_segments+append_list+independent_segments',
                '-hls_segment_type', 'mpegts',
                '-hls_segment_filename', `${outputPath}/segment_%d.ts`,
                '-max_muxing_queue_size', '2048',
                '-avoid_negative_ts', 'make_zero'
            ];

            logger.info(`Starting stream with options:`, {
                streamId,
                inputOptions,
                outputOptions,
                url: streamConfig.url,
                manifestType,
                licenseKey: licenseKey ? '(present)' : '(not present)'
            });

            // 创建新的 ffmpeg 进程
            const process = ffmpeg(streamConfig.url)
                .inputOptions(inputOptions)
                .outputOptions(outputOptions)
                .output(`${outputPath}/playlist.m3u8`)
                .on('start', (commandLine) => {
                    logger.info(`FFmpeg command: ${commandLine}`);
                })
                .on('stderr', (stderrLine) => {
                    // 记录所有输出以便调试
                    logger.debug(`FFmpeg output: ${stderrLine}`);
                    
                    if (stderrLine.includes('Error') || 
                        stderrLine.includes('Failed') || 
                        stderrLine.includes('SIGSEGV') ||
                        stderrLine.includes('Invalid') ||
                        stderrLine.includes('No such')) {
                        logger.error(`FFmpeg stderr: ${stderrLine}`);
                    }
                })
                .on('error', (err) => {
                    logger.error(`Stream ${streamId} error:`, { 
                        error: err.message,
                        stack: err.stack,
                        ffmpegError: err.toString()
                    });
                    
                    if (stats) stats.errors++;
                    if (configStats) configStats.errors++;
                    
                    this.streamProcesses.delete(streamId);
                    
                    if (err.message.includes('SIGSEGV')) {
                        logger.info('Attempting to use yt-dlp as fallback');
                        this.startStreamingWithYtdlp(streamId, streamConfig);
                    } else {
                        const retryDelay = 5000;
                        setTimeout(() => this.startStreaming(streamId), retryDelay);
                    }
                });

            process.run();
            this.streamProcesses.set(streamId, process);
            logger.info(`Stream started: ${streamId}`);

            await this.waitForStream(streamId, outputPath);

        } catch (error) {
            logger.error(`Error starting stream: ${streamId}`, { 
                error: error.message,
                stack: error.stack 
            });
            
            // 更新错误统计
            const stats = this.streamStats.get(streamId);
            const configStats = this.streams.get(streamId)?.stats;
            
            if (stats) {
                stats.errors++;
                stats.startTime = null;
            }
            
            if (configStats) {
                configStats.errors++;
                configStats.startTime = null;
            }
            
            throw error;
        }
    }

    async startStreamingWithYtdlp(streamId, streamConfig, licenseKey) {
        const { spawn } = require('child_process');
        const outputPath = path.join(__dirname, '../streams', streamId);
        
        if (!fs.existsSync(outputPath)) {
            fs.mkdirSync(outputPath, { recursive: true });
        }

        // 构建 yt-dlp 参数
        const args = [
            '--verbose',                    // 添加详细输出
            '--no-check-certificates',
            '--allow-unplayable-formats',
            '--no-part',
            '--no-mtime',
            '--live-from-start',
            '--no-playlist-reverse',
            '--force-generic-extractor',
            '--concurrent-fragments', '1',
        ];

        // 添加 DRM 解密头
        if (streamConfig.inputstream?.adaptive?.license_key) {
            args.push(
                '--add-header',
                `X-AxDRM-Message: ${streamConfig.inputstream.adaptive.license_key}`,
                '--add-header',
                'Content-Type: application/dash+xml'
            );
        }

        // 添加 User-Agent
        args.push(
            '--add-header',
            'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        );

        // 设置格式和输出
        args.push(
            '--format', 'best',
            '--no-check-formats',
            '--retries', 'infinite',
            '--fragment-retries', 'infinite',
            '--stream-types', 'dash,hls',
            '--live-from-start',
            '--no-part',
            '--no-mtime',
            '--no-progress',
            '--quiet',
            '--no-warnings',
            '--output', '-'  // 输出到标准输出
        );

        // 添加源 URL
        args.push(streamConfig.url);

        logger.info(`Starting yt-dlp with args:`, { args });

        // 启动 yt-dlp 进程
        const ytdlp = spawn('yt-dlp', args);
        
        // 启动 FFmpeg 进程来处理 yt-dlp 的输出
        const ffmpeg = spawn('ffmpeg', [
            '-i', 'pipe:0',
            '-c:v', 'copy',
            '-c:a', 'copy',
            '-f', 'hls',
            '-hls_time', '2',
            '-hls_list_size', '6',
            '-hls_flags', 'delete_segments+append_list+independent_segments',
            '-hls_segment_type', 'mpegts',
            '-hls_segment_filename', `${outputPath}/segment_%d.ts`,
            `${outputPath}/playlist.m3u8`
        ]);

        // 连接进程
        ytdlp.stdout.pipe(ffmpeg.stdin);

        // 错误处理
        ytdlp.stderr.on('data', (data) => {
            const message = data.toString();
            logger.debug(`yt-dlp stderr: ${message}`);
        });

        ffmpeg.stderr.on('data', (data) => {
            const message = data.toString();
            logger.debug(`ffmpeg stderr: ${message}`);
        });

        // 保存程引用
        this.streamProcesses.set(streamId, {
            ytdlp,
            ffmpeg
        });

        // 理进程结束
        ytdlp.on('close', (code) => {
            logger.info(`yt-dlp process exited with code ${code}`);
            if (code !== 0) {
                logger.error(`yt-dlp failed for stream: ${streamId}`);
                this.restartStream(streamId);
            }
        });

        ffmpeg.on('close', (code) => {
            logger.info(`ffmpeg process exited with code ${code}`);
            if (code !== 0) {
                logger.error(`ffmpeg failed for stream: ${streamId}`);
                this.restartStream(streamId);
            }
        });

        // 等待文件创建
        return new Promise((resolve, reject) => {
            const maxAttempts = 30;
            let attempts = 0;
            const checkFile = () => {
                const playlistPath = path.join(outputPath, 'playlist.m3u8');
                if (fs.existsSync(playlistPath)) {
                    const stats = fs.statSync(playlistPath);
                    if (stats.size > 0) {
                        logger.info(`Stream ${streamId} started successfully`);
                        resolve();
                        return;
                    }
                }
                attempts++;
                if (attempts >= maxAttempts) {
                    reject(new Error('Failed to create stream file'));
                } else {
                    setTimeout(checkFile, 1000);
                }
            };
            checkFile();
        });
    }

    // 添加文件监控方法
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

    // 添加重启流的方法
    async restartStream(streamId) {
        try {
            await this.stopStreaming(streamId);
            await this.startStreaming(streamId);
            logger.info(`Stream restarted: ${streamId}`);
        } catch (error) {
            logger.error(`Error restarting stream: ${streamId}`, { error });
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
                if (processes.ytdlp) {
                    processes.ytdlp.kill();
                }
                if (processes.ffmpeg) {
                    processes.ffmpeg.kill();
                }
                this.streamProcesses.delete(streamId);
                
                const stats = this.streamStats.get(streamId);
                if (stats && stats.startTime) {
                    stats.uptime += (new Date() - stats.startTime);
                    stats.startTime = null;
                }
                
                logger.info(`Stream stopped: ${streamId}`);
            }
        } catch (error) {
            logger.error(`Error stopping stream: ${streamId}`, { error });
            throw error;
        }
    }

    async checkStreamsHealth() {
        for (const [streamId, process] of this.streamProcesses.entries()) {
            try {
                const stats = this.streamStats.get(streamId);
                const outputPath = path.join(__dirname, '../streams', streamId, 'playlist.m3u8');
                
                // 检查文件是否存在且最近5分钟内有更新
                const fileStats = fs.statSync(outputPath);
                const isHealthy = (Date.now() - fileStats.mtimeMs) < 5 * 60 * 1000;
                
                if (!isHealthy) {
                    logger.warn(`Unhealthy stream detected: ${streamId}`);
                    await this.restartStream(streamId);
                }
                
                // 如果错误次数过多，也重启流
                if (stats.errors > 5) {
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
}

module.exports = { StreamManager }; 
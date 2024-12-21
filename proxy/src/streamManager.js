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
        this.serverPorts = new Map();
        
        // 创建配置目录
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
                
                // 等待端口分配
                let attempts = 0;
                while (!this.serverPorts.has(streamId) && attempts < 10) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                    attempts++;
                }
            }

            // 获取端口
            const port = this.serverPorts.get(streamId);
            if (!port) {
                logger.error(`Port not found for stream: ${streamId}`);
                return null;
            }

            return `http://127.0.0.1:${port}`;
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

            // 默认使用 yt-dlp 处理所有流
            logger.info(`Using yt-dlp for stream: ${streamId}`);
            await this.startStreamingWithYtdlp(streamId, streamConfig);

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

    async startStreamingWithYtdlp(streamId, streamConfig) {
        const { spawn } = require('child_process');
        const net = require('net');
        
        // 如果已经有进程在运行，先停止它
        if (this.streamProcesses.has(streamId)) {
            await this.stopStreaming(streamId);
        }

        // 先创建服务器并获取端口
        const server = net.createServer();
        const port = await new Promise((resolve) => {
            server.listen(0, '127.0.0.1', () => {
                const port = server.address().port;
                resolve(port);
            });
        });

        // 保存端口信息
        this.serverPorts.set(streamId, port);
        logger.info(`Created stream server on port ${port} for stream ${streamId}`);

        // 解析 license_key
        let licenseKey = null;
        if (streamConfig.kodiprop?.includes('license_key')) {
            licenseKey = streamConfig.kodiprop.match(/license_key=([^#\n]*)/)?.[1];
        }

        // 先用 yt-dlp 获取真实地址
        const realUrl = await new Promise((resolve, reject) => {
            const args = [
                '--no-check-certificates',
                '--no-warnings',
                '--quiet',
                '--get-url',
                '--allow-unplayable-formats',
                '--format', 'v5000000_33'
            ];

            if (licenseKey) {
                args.push(
                    '--add-header',
                    `X-AxDRM-Message: ${licenseKey}`,
                    '--add-header',
                    'Content-Type: application/dash+xml',
                    '--add-header',
                    'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                );
            }

            args.push(streamConfig.url);

            logger.debug(`yt-dlp args for URL resolution: ${args.join(' ')}`);

            const ytdlp = spawn('yt-dlp', args);
            let url = '';
            let error = '';

            ytdlp.stdout.on('data', (data) => {
                url += data.toString();
            });

            ytdlp.stderr.on('data', (data) => {
                error += data.toString();
                logger.debug(`yt-dlp stderr during URL resolution: ${data.toString()}`);
            });

            ytdlp.on('close', (code) => {
                if (code === 0 && url.trim()) {
                    logger.info(`Successfully resolved real URL for stream ${streamId}`);
                    resolve(url.trim());
                } else {
                    logger.error(`Failed to resolve URL with error: ${error}`);
                    reject(new Error(`Failed to get real URL: ${error}`));
                }
            });
        });

        logger.info(`Got real URL for stream ${streamId}`);

        return new Promise((resolve, reject) => {
            try {
                const clients = new Set();
                
                server.on('connection', (socket) => {
                    clients.add(socket);
                    logger.debug(`New client connected to stream ${streamId}`);

                    // 发送 HTTP 响应头
                    socket.write('HTTP/1.1 200 OK\r\n');
                    socket.write('Content-Type: video/mp2t\r\n');
                    socket.write('Cache-Control: no-cache\r\n');
                    socket.write('Connection: keep-alive\r\n');
                    socket.write('Access-Control-Allow-Origin: *\r\n');
                    socket.write('\r\n');

                    socket.on('close', () => {
                        clients.delete(socket);
                        logger.debug(`Client disconnected from stream ${streamId}`);
                    });

                    socket.on('error', (error) => {
                        logger.error(`Client socket error for stream ${streamId}:`, error);
                        clients.delete(socket);
                    });
                });

                // 使用 FFmpeg 处理流
                const ffmpeg = spawn('ffmpeg', [
                    '-reconnect', '1',
                    '-reconnect_streamed', '1',
                    '-reconnect_delay_max', '5',
                    '-headers', [
                        `X-AxDRM-Message: ${licenseKey}`,
                        'Content-Type: application/dash+xml',
                        'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                    ].join('\r\n'),
                    '-i', realUrl,
                    '-c:v', 'copy',
                    '-c:a', 'copy',
                    '-f', 'mpegts',
                    '-mpegts_flags', '+resend_headers',
                    '-mpegts_copyts', '1',
                    '-mpegts_flags', '+initial_discontinuity',
                    '-avoid_negative_ts', 'make_zero',
                    '-max_delay', '5000000',
                    '-muxdelay', '0.1',
                    '-flush_packets', '1',
                    'pipe:1'
                ]);

                let ffmpegError = '';

                ffmpeg.stdout.on('data', (data) => {
                    for (const client of clients) {
                        try {
                            if (!client.destroyed) {
                                if (!client.headerSent) {
                                    client.write('HTTP/1.1 200 OK\r\n');
                                    client.write('Content-Type: video/mp2t\r\n');
                                    client.write('Cache-Control: no-cache\r\n');
                                    client.write('Connection: keep-alive\r\n');
                                    client.write('Access-Control-Allow-Origin: *\r\n');
                                    client.write('\r\n');
                                    client.headerSent = true;
                                }
                                client.write(data);
                            }
                        } catch (error) {
                            logger.error(`Error sending data to client for stream ${streamId}:`, error);
                            clients.delete(client);
                        }
                    }
                });

                ffmpeg.stderr.on('data', (data) => {
                    const message = data.toString();
                    if (message.includes('Error') || 
                        message.includes('Invalid') || 
                        message.includes('Failed') ||
                        message.includes('No such')) {
                        logger.error(`ffmpeg stderr: ${message}`);
                    } else {
                        logger.debug(`ffmpeg stderr: ${message}`);
                    }
                });

                ffmpeg.on('error', (error) => {
                    logger.error(`ffmpeg error for stream ${streamId}:`, error);
                    this.restartStream(streamId);
                });

                ffmpeg.on('exit', (code) => {
                    if (code !== 0) {
                        logger.error(`ffmpeg exited with code ${code} for stream ${streamId}`);
                        logger.error(`ffmpeg stderr: ${ffmpegError}`);
                        this.restartStream(streamId);
                    }
                });

                // 保存进程和服务器引用
                this.streamProcesses.set(streamId, {
                    ffmpeg,
                    server,
                    clients,
                    port,
                    startTime: new Date()
                });

                resolve();
            } catch (error) {
                reject(error);
            }
        });
    }

    // 添加清理旧分的方法
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
        }, 5000); // 每5���检查一次

        // 保存检查间隔的引用，以便后续清理
        this.healthChecks.set(streamId, checkInterval);
    }

    // 修改重启流的方法
    async restartStream(streamId) {
        try {
            logger.info(`Restarting stream: ${streamId}`);
            await this.stopStreaming(streamId);
            // 增加延迟时间
            await new Promise(resolve => setTimeout(resolve, 5000));
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
                    processes.ytdlp.kill('SIGTERM');
                }
                if (processes.server) {
                    processes.server.close();
                    for (const client of processes.clients) {
                        client.destroy();
                    }
                }
                this.streamProcesses.delete(streamId);
                this.serverPorts.delete(streamId);
                logger.info(`Stream stopped: ${streamId}`);
            }
        } catch (error) {
            logger.error(`Error stopping stream: ${streamId}`, error);
        }
    }

    async checkStreamsHealth() {
        for (const [streamId, process] of this.streamProcesses.entries()) {
            try {
                const stats = this.streamStats.get(streamId);
                const outputPath = path.join(__dirname, '../streams', streamId, 'playlist.m3u8');
                
                // 只有在文件不存在时才认为流不健康
                if (!fs.existsSync(outputPath)) {
                    logger.warn(`Unhealthy stream detected: ${streamId}`);
                    await this.restartStream(streamId);
                    continue;
                }
                
                // 如果错误次数过多，重启流
                if (stats && stats.errors > 10) {  // 增加错误容忍度
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
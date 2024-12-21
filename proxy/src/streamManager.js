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
        
        // 每小时运行一次清理
        setInterval(() => this.cleanupUnusedFiles(), 60 * 60 * 1000);
        // 每分钟运行一次健康检查
        setInterval(() => this.checkStreamsHealth(), 60 * 1000);
    }

    async addStream(id, config) {
        try {
            // 解析 KODIPROP 属性
            if (config.kodiprop) {
                const props = config.kodiprop.split('\n');
                for (const prop of props) {
                    if (prop.startsWith('#KODIPROP:')) {
                        const [key, value] = prop.substring(10).split('=');
                        if (!config.inputstream) {
                            config.inputstream = { adaptive: {} };
                        }
                        const parts = key.split('.');
                        if (parts.length === 3 && parts[0] === 'inputstream' && parts[1] === 'adaptive') {
                            config.inputstream.adaptive[parts[2]] = value;
                        }
                    }
                }
            }

            // 检查是否是 MPD 流
            const isMPD = config.url.includes('.mpd') || 
                         config.manifest_type === 'mpd' ||
                         config.inputstream?.adaptive?.manifest_type === 'mpd';

            if (isMPD) {
                logger.info(`Detected MPD stream: ${id}`);
                if (!config.inputstream) {
                    config.inputstream = { adaptive: {} };
                }
                config.inputstream.adaptive.manifest_type = 'mpd';
            }

            // 如果有 license_key，确保它被正确设置
            if (config.license_key && !config.inputstream?.adaptive?.license_key) {
                if (!config.inputstream) {
                    config.inputstream = { adaptive: {} };
                }
                config.inputstream.adaptive.license_key = config.license_key;
            }

            this.streams.set(id, config);
            this.streamStats.set(id, {
                totalRequests: 0,
                lastAccessed: null,
                errors: 0,
                uptime: 0,
                startTime: null
            });
            logger.info(`Stream added: ${id}`, { streamId: id, config });
        } catch (error) {
            logger.error(`Error adding stream: ${id}`, { error });
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

            const outputPath = path.join(__dirname, '../streams', streamId);
            if (!fs.existsSync(outputPath)) {
                fs.mkdirSync(outputPath, { recursive: true });
            }

            const stats = this.streamStats.get(streamId);
            stats.startTime = new Date();
            stats.errors = 0;

            // 修改 inputOptions，添加更多的错误处理选项
            const inputOptions = [
                '-reconnect', '1',
                '-reconnect_streamed', '1',
                '-reconnect_delay_max', '5',
                '-timeout', '15000000',
                '-allowed_extensions', 'ALL',
                '-y',
                '-nostdin',
                '-xerror',
                '-loglevel', 'warning',
                '-rw_timeout', '15000000',
                '-user_agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            ];

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
                '-max_muxing_queue_size', '1024',
                '-avoid_negative_ts', 'make_zero'
            ];

            // 检查是否是 MPD 流
            const isMPD = streamConfig.url.includes('.mpd') || 
                         streamConfig.manifest_type === 'mpd' ||
                         streamConfig.inputstream?.adaptive?.manifest_type === 'mpd';

            if (isMPD) {
                inputOptions.push(
                    '-protocol_whitelist', 'file,http,https,tcp,tls,crypto',
                    '-re',
                    '-fflags', '+genpts',
                    '-headers', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36\r\n'
                );

                // 如果有 clearkey
                if (streamConfig.license_key || streamConfig.inputstream?.adaptive?.license_key) {
                    const licenseKey = streamConfig.license_key || 
                                     streamConfig.inputstream?.adaptive?.license_key;
                    
                    if (licenseKey) {
                        const [keyId, key] = licenseKey.split(':');
                        if (keyId && key) {
                            // 使用新的解密选项格式
                            inputOptions.push(
                                '-decryption_keys', `${keyId}:${key}`
                            );
                        }
                    }
                }

                // 获取实际的 MPD URL（处理重定向）
                try {
                    logger.info(`Fetching MPD manifest for stream: ${streamId}`);
                    const response = await axios.get(streamConfig.url, {
                        maxRedirects: 5,
                        validateStatus: null,
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                        }
                    });
                    
                    // 检查是否有重定向
                    if (response.status === 302 || response.headers.location) {
                        const redirectUrl = response.headers.location;
                        logger.info(`Stream redirected to: ${redirectUrl}`);
                        streamConfig.url = redirectUrl;
                    } else if (response.request?.res?.responseUrl !== streamConfig.url) {
                        streamConfig.url = response.request.res.responseUrl;
                        logger.info(`Updated stream URL to: ${streamConfig.url}`);
                    }
                    
                    // 如果是 MPD 内容，记录一下
                    if (response.headers['content-type']?.includes('application/dash+xml')) {
                        logger.info(`Valid MPD content received for stream: ${streamId}`);
                    }

                    // 添加额外的 MPD 相关选项
                    inputOptions.push(
                        '-live_start_index', '0',
                        '-strict', 'experimental'
                    );

                } catch (error) {
                    logger.error(`Error fetching MPD manifest: ${streamId}`, { 
                        error: error.message,
                        response: error.response?.data,
                        status: error.response?.status
                    });
                    throw new Error(`Failed to fetch MPD manifest: ${error.message}`);
                }
            }

            // 如果是加密流，添加解密选项
            if (streamConfig.inputstream?.adaptive?.license_type === 'clearkey') {
                outputOptions.push(
                    '-encryption_scheme', 'none',
                    '-hls_enc', '0'
                );
            }

            // 如果是HLS流，添加特殊处理
            if (streamConfig.url.includes('.m3u8') || streamConfig.url.includes('hls')) {
                inputOptions.push(
                    '-live_start_index', '-1'  // 从最新的片段开始
                );
            }

            logger.info(`Starting stream with options:`, {
                streamId,
                inputOptions,
                outputOptions,
                url: streamConfig.url
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
                    if (stderrLine.includes('Error') || 
                        stderrLine.includes('Failed') || 
                        stderrLine.includes('SIGSEGV')) {
                        logger.error(`FFmpeg stderr: ${stderrLine}`);
                        // 如果检测到严重错误，立即重启流
                        this.restartStream(streamId);
                    }
                })
                .on('progress', (progress) => {
                    logger.debug(`Stream progress: ${streamId}`, progress);
                })
                .on('end', () => {
                    logger.info(`Stream ${streamId} ended`);
                    this.streamProcesses.delete(streamId);
                    // 流结束后延迟重启
                    setTimeout(() => this.startStreaming(streamId), 5000);
                })
                .on('error', (err) => {
                    logger.error(`Stream ${streamId} error:`, { 
                        error: err.message,
                        stack: err.stack,
                        ffmpegError: err.toString()
                    });
                    stats.errors++;
                    this.streamProcesses.delete(streamId);
                    
                    // 根据错误类型决定重试时间
                    const retryDelay = err.message.includes('SIGSEGV') ? 30000 : 5000;
                    setTimeout(() => this.startStreaming(streamId), retryDelay);
                });

            process.run();
            this.streamProcesses.set(streamId, process);
            logger.info(`Stream started: ${streamId}`);

            // ��待检查流是否成功启动
            await this.waitForStream(streamId, outputPath);

        } catch (error) {
            logger.error(`Error starting stream: ${streamId}`, { 
                error: error.message,
                stack: error.stack 
            });
            // 如果启动失败，30秒后重试
            setTimeout(() => this.startStreaming(streamId), 30000);
            throw error;
        }
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
            const process = this.streamProcesses.get(streamId);
            if (process) {
                process.kill();
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

    async restartStream(streamId) {
        try {
            await this.stopStreaming(streamId);
            await this.startStreaming(streamId);
            logger.info(`Stream restarted: ${streamId}`);
        } catch (error) {
            logger.error(`Error restarting stream: ${streamId}`, { error });
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
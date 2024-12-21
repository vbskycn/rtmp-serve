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

            // 检查流的类型并设置适当的参数
            const inputOptions = [];
            const outputOptions = [
                '-c:v copy',
                '-c:a copy',
                '-f hls',
                '-hls_time 4',
                '-hls_list_size 3',
                '-hls_flags delete_segments+append_list',
                '-hls_segment_type mpegts',
                '-hls_playlist_type event',
                `-hls_segment_filename ${outputPath}/segment_%d.ts`
            ];

            // 如果是MPD流，添加特殊处理
            if (streamConfig.url.includes('.mpd') || streamConfig.url.includes('manifest_type=mpd')) {
                inputOptions.push(
                    '-protocol_whitelist', 'file,http,https,tcp,tls,crypto',
                    '-re',
                    '-fflags', '+genpts'
                );
            }

            logger.info(`Starting stream with options:`, {
                streamId,
                inputOptions,
                outputOptions
            });

            const process = ffmpeg(streamConfig.url)
                .inputOptions(inputOptions)
                .outputOptions(outputOptions)
                .output(`${outputPath}/playlist.m3u8`)
                .on('start', (commandLine) => {
                    logger.info(`FFmpeg command: ${commandLine}`);
                })
                .on('progress', (progress) => {
                    logger.debug(`Stream progress: ${streamId}`, progress);
                })
                .on('end', () => {
                    logger.info(`Stream ${streamId} ended`);
                    this.streamProcesses.delete(streamId);
                })
                .on('error', (err) => {
                    logger.error(`Stream ${streamId} error:`, { 
                        error: err.message,
                        stack: err.stack,
                        ffmpegError: err.toString()
                    });
                    stats.errors++;
                    this.streamProcesses.delete(streamId);
                });

            process.run();
            this.streamProcesses.set(streamId, process);
            logger.info(`Stream started: ${streamId}`);

            // 等待检查流是否成功启动
            await this.waitForStream(streamId, outputPath);

        } catch (error) {
            logger.error(`Error starting stream: ${streamId}`, { 
                error: error.message,
                stack: error.stack 
            });
            throw error;
        }
    }

    async waitForStream(streamId, outputPath) {
        return new Promise((resolve, reject) => {
            const maxAttempts = 10;
            let attempts = 0;
            
            const checkFile = () => {
                const playlistPath = path.join(outputPath, 'playlist.m3u8');
                if (fs.existsSync(playlistPath)) {
                    logger.info(`Stream ${streamId} playlist file created successfully`);
                    resolve();
                } else {
                    attempts++;
                    if (attempts >= maxAttempts) {
                        const error = new Error(`Failed to create stream after ${maxAttempts} attempts`);
                        logger.error(`Stream ${streamId} failed to start`, { error });
                        this.stopStreaming(streamId);
                        reject(error);
                    } else {
                        setTimeout(checkFile, 1000);
                    }
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
                
                // 如果目录超过24小时未被访问且��不活跃，则删除
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
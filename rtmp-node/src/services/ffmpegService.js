const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

class FFmpegService {
    constructor() {
        this.processes = new Map();
        this.logDir = path.join(__dirname, '../../logs');
        
        // 确保日志目录存在
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }
    }

    async startStream(stream) {
        if (this.processes.has(stream.id)) {
            throw new Error('流已经在运行');
        }

        const logFile = path.join(this.logDir, `${stream.id}.log`);
        const logStream = fs.createWriteStream(logFile, { flags: 'a' });

        const args = this.buildFFmpegArgs(stream);
        const process = spawn('ffmpeg', args);

        process.stdout.pipe(logStream);
        process.stderr.pipe(logStream);

        this.processes.set(stream.id, {
            process,
            logStream,
            startTime: Date.now()
        });

        return new Promise((resolve, reject) => {
            process.on('error', (error) => {
                this.handleStreamError(stream.id, error);
                reject(error);
            });

            // 等待进程启动
            setTimeout(() => {
                if (process.exitCode === null) {
                    resolve();
                } else {
                    reject(new Error('启动失败'));
                }
            }, 1000);
        });
    }

    async stopStream(id) {
        const processInfo = this.processes.get(id);
        if (!processInfo) {
            return;
        }

        return new Promise((resolve) => {
            processInfo.process.on('exit', () => {
                processInfo.logStream.end();
                this.processes.delete(id);
                resolve();
            });

            processInfo.process.kill('SIGTERM');
        });
    }

    getStreamStatus(id) {
        const processInfo = this.processes.get(id);
        if (!processInfo) {
            return { status: 'stopped' };
        }

        return {
            status: 'running',
            uptime: Date.now() - processInfo.startTime,
            pid: processInfo.process.pid
        };
    }

    buildFFmpegArgs(stream) {
        const args = [
            '-i', stream.sourceUrl,
            '-c:v', stream.config?.videoCodec || 'copy',
            '-c:a', stream.config?.audioCodec || 'copy'
        ];

        if (stream.config?.videoBitrate) {
            args.push('-b:v', stream.config.videoBitrate);
        }

        if (stream.config?.audioBitrate) {
            args.push('-b:a', stream.config.audioBitrate);
        }

        if (stream.config?.frameRate) {
            args.push('-r', stream.config.frameRate);
        }

        args.push(
            '-f', 'flv',
            stream.pushUrl
        );

        return args;
    }

    handleStreamError(id, error) {
        console.error(`Stream ${id} error:`, error);
        this.processes.delete(id);
    }

    async getStreamMetrics(id) {
        const processInfo = this.processes.get(id);
        if (!processInfo) {
            return null;
        }

        // 这里可以添加更多的指标收集逻辑
        return {
            uptime: Date.now() - processInfo.startTime,
            pid: processInfo.process.pid
        };
    }
}

module.exports = new FFmpegService(); 
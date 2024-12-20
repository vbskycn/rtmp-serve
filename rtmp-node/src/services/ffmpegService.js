const ffmpeg = require('fluent-ffmpeg');
const winston = require('winston');
const config = require('config');

class FFmpegService {
  constructor() {
    this.activeStreams = new Map();
    this.retryAttempts = new Map();
    this.maxRetries = config.get('ffmpeg.maxRetries') || 3;
    this.setupLogger();
  }

  setupLogger() {
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      transports: [
        new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
        new winston.transports.File({ filename: 'logs/combined.log' })
      ]
    });
  }

  async startStream(stream) {
    if (this.activeStreams.has(stream.id)) {
      throw new Error('流已经在运行中');
    }

    const command = ffmpeg(stream.sourceUrl);
    
    // 应用转码配置
    if (stream.config) {
      if (stream.config.videoBitrate) {
        command.videoBitrate(stream.config.videoBitrate);
      }
      if (stream.config.audioBitrate) {
        command.audioBitrate(stream.config.audioBitrate);
      }
      if (stream.config.videoCodec) {
        command.videoCodec(stream.config.videoCodec);
      }
      if (stream.config.audioCodec) {
        command.audioCodec(stream.config.audioCodec);
      }
      if (stream.config.size) {
        command.size(stream.config.size);
      }
    }

    command
      .output(stream.pushUrl)
      .on('start', (commandLine) => {
        this.logger.info(`Stream ${stream.id} started: ${commandLine}`);
        this.updateStreamStatus(stream.id, 'running');
      })
      .on('error', (err) => {
        this.logger.error(`Stream ${stream.id} error: ${err.message}`);
        this.handleStreamError(stream);
      })
      .on('end', () => {
        this.logger.info(`Stream ${stream.id} ended`);
        this.activeStreams.delete(stream.id);
        this.updateStreamStatus(stream.id, 'stopped');
      });

    // 添加流状态监控
    command.on('progress', (progress) => {
      this.updateStreamMetrics(stream.id, progress);
    });

    this.activeStreams.set(stream.id, {
      command,
      startTime: Date.now(),
      metrics: {
        fps: 0,
        bitrate: 0,
        speed: 0,
        frames: 0
      }
    });

    command.run();
  }

  async handleStreamError(stream) {
    const attempts = this.retryAttempts.get(stream.id) || 0;
    
    if (attempts < this.maxRetries) {
      this.logger.info(`Retrying stream ${stream.id}, attempt ${attempts + 1}`);
      this.retryAttempts.set(stream.id, attempts + 1);
      
      setTimeout(() => {
        this.startStream(stream);
      }, 5000); // 5秒后重试
    } else {
      this.logger.error(`Stream ${stream.id} failed after ${attempts} retries`);
      this.activeStreams.delete(stream.id);
      this.retryAttempts.delete(stream.id);
      this.updateStreamStatus(stream.id, 'error');
    }
  }

  updateStreamMetrics(streamId, progress) {
    const streamData = this.activeStreams.get(streamId);
    if (streamData) {
      streamData.metrics = {
        fps: progress.frames,
        bitrate: progress.bitrate,
        speed: progress.speed,
        frames: progress.frames
      };
    }
  }

  getStreamStatus(streamId) {
    const streamData = this.activeStreams.get(streamId);
    if (!streamData) return null;

    return {
      uptime: Date.now() - streamData.startTime,
      ...streamData.metrics
    };
  }

  async stopStream(stream) {
    const streamData = this.activeStreams.get(stream.id);
    if (streamData) {
      streamData.command.kill('SIGKILL');
      this.activeStreams.delete(stream.id);
      this.retryAttempts.delete(stream.id);
    }
  }
}

module.exports = FFmpegService; 
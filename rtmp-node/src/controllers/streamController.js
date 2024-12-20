const StreamService = require('../services/ffmpegService');
const fs = require('fs').promises;
const path = require('path');

const streamService = new StreamService();
const STREAMS_FILE = path.join(__dirname, '../../data/streams.json');

class StreamController {
  async getAllStreams(req, res) {
    try {
      const streams = await this.loadStreams();
      res.json(streams);
    } catch (error) {
      res.status(500).json({ error: '获取流列表失败' });
    }
  }

  async addStream(req, res) {
    try {
      const { name, sourceUrl, pushUrl, config } = req.body;
      const streams = await this.loadStreams();
      
      const newStream = {
        id: Date.now().toString(),
        name,
        sourceUrl,
        pushUrl,
        config,
        status: 'stopped'
      };

      streams.push(newStream);
      await this.saveStreams(streams);
      
      res.json(newStream);
    } catch (error) {
      res.status(500).json({ error: '添加流失败' });
    }
  }

  async startStream(req, res) {
    try {
      const { id } = req.params;
      const streams = await this.loadStreams();
      const stream = streams.find(s => s.id === id);
      
      if (!stream) {
        return res.status(404).json({ error: '未找到指定的流' });
      }

      await streamService.startStream(stream);
      stream.status = 'running';
      await this.saveStreams(streams);
      
      res.json(stream);
    } catch (error) {
      res.status(500).json({ error: '启动流失败' });
    }
  }

  async stopStream(req, res) {
    try {
      const { id } = req.params;
      const streams = await this.loadStreams();
      const stream = streams.find(s => s.id === id);
      
      if (!stream) {
        return res.status(404).json({ error: '未找到指定的流' });
      }

      await streamService.stopStream(stream);
      stream.status = 'stopped';
      await this.saveStreams(streams);
      
      res.json(stream);
    } catch (error) {
      res.status(500).json({ error: '停止流失败' });
    }
  }

  async loadStreams() {
    try {
      const data = await fs.readFile(STREAMS_FILE, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      return [];
    }
  }

  async saveStreams(streams) {
    await fs.writeFile(STREAMS_FILE, JSON.stringify(streams, null, 2));
  }
}

module.exports = new StreamController(); 
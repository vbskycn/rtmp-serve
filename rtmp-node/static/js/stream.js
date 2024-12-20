class StreamManager {
  constructor() {
    this.baseUrl = '/api';
    this.checkAuth();
    this.initEventListeners();
    this.loadStreams();
    this.startMonitoring();
  }

  checkAuth() {
    const token = localStorage.getItem('token');
    if (!token) {
      window.location.href = '/login.html';
      return;
    }
    this.token = token;
  }

  async fetchWithAuth(url, options = {}) {
    const headers = {
      'Authorization': `Bearer ${this.token}`,
      ...options.headers
    };
    
    const response = await fetch(url, { ...options, headers });
    
    if (response.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login.html';
      return;
    }
    
    return response;
  }

  async loadStreams() {
    try {
      const response = await this.fetchWithAuth(`${this.baseUrl}/streams`);
      const streams = await response.json();
      this.updateStreamTable(streams);
      this.updateStats(streams);
    } catch (error) {
      console.error('加载流列表失败:', error);
    }
  }

  startMonitoring() {
    setInterval(() => {
      this.updateStreamMetrics();
    }, 5000); // 每5秒更新一次
  }

  async updateStreamMetrics() {
    try {
      const response = await this.fetchWithAuth(`${this.baseUrl}/streams/metrics`);
      const metrics = await response.json();
      this.updateMetricsDisplay(metrics);
    } catch (error) {
      console.error('更新指标失败:', error);
    }
  }

  updateMetricsDisplay(metrics) {
    metrics.forEach(metric => {
      const row = document.querySelector(`tr[data-stream-id="${metric.id}"]`);
      if (row) {
        const statusCell = row.querySelector('.stream-status');
        const metricsCell = row.querySelector('.stream-metrics');
        
        statusCell.textContent = metric.status;
        statusCell.className = `stream-status ${metric.status}`;
        
        if (metric.status === 'running') {
          metricsCell.innerHTML = `
            FPS: ${metric.fps} | 
            比特率: ${metric.bitrate}kb/s | 
            速度: ${metric.speed}x
          `;
        } else {
          metricsCell.innerHTML = '-';
        }
      }
    });
  }

  async addStream(streamData) {
    try {
      const response = await fetch(`${this.baseUrl}/streams`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(streamData)
      });
      
      if (response.ok) {
        this.loadStreams();
      }
    } catch (error) {
      console.error('添加流失败:', error);
    }
  }

  async startStream(id) {
    try {
      await fetch(`${this.baseUrl}/streams/${id}/start`, { method: 'POST' });
      this.loadStreams();
    } catch (error) {
      console.error('启动流失败:', error);
    }
  }

  async stopStream(id) {
    try {
      await fetch(`${this.baseUrl}/streams/${id}/stop`, { method: 'POST' });
      this.loadStreams();
    } catch (error) {
      console.error('停止流失败:', error);
    }
  }

  async deleteStream(id) {
    try {
      const response = await this.fetchWithAuth(`${this.baseUrl}/streams/${id}`, {
        method: 'DELETE'
      });
      
      if (response.ok) {
        this.loadStreams();
      }
    } catch (error) {
      console.error('删除流失败:', error);
    }
  }

  initEventListeners() {
    // 添加流按钮事件
    document.getElementById('addStreamBtn').addEventListener('click', () => {
      // 实现添加流的逻辑
    });

    // 批量操作按钮事件
    document.querySelectorAll('.action-btn[data-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const action = e.target.dataset.action;
        this.handleBatchAction(action);
      });
    });

    // 刷新按钮事件
    document.querySelector('.refresh-btn').addEventListener('click', () => {
      this.loadStreams();
    });

    // 搜索输入事件
    document.getElementById('searchInput').addEventListener('input', (e) => {
      this.filterStreams(e.target.value);
    });
  }

  updateStreamTable(streams) {
    const tbody = document.getElementById('streamTableBody');
    tbody.innerHTML = '';

    streams.forEach(stream => {
      const tr = document.createElement('tr');
      tr.dataset.streamId = stream.id;
      
      tr.innerHTML = `
        <td><input type="checkbox" class="stream-select"></td>
        <td>${stream.name}</td>
        <td>${stream.sourceUrl}</td>
        <td>${stream.pushUrl}</td>
        <td>${stream.config ? JSON.stringify(stream.config) : '-'}</td>
        <td class="stream-status ${stream.status}">${stream.status}</td>
        <td class="stream-metrics">-</td>
        <td>
          <button class="btn-action start" ${stream.status === 'running' ? 'disabled' : ''}>
            <i class="fas fa-play"></i>
          </button>
          <button class="btn-action stop" ${stream.status === 'stopped' ? 'disabled' : ''}>
            <i class="fas fa-stop"></i>
          </button>
          <button class="btn-action delete">
            <i class="fas fa-trash"></i>
          </button>
        </td>
      `;

      // 添加按钮事件监听器
      tr.querySelector('.btn-action.start').addEventListener('click', () => this.startStream(stream.id));
      tr.querySelector('.btn-action.stop').addEventListener('click', () => this.stopStream(stream.id));
      tr.querySelector('.btn-action.delete').addEventListener('click', () => this.deleteStream(stream.id));

      tbody.appendChild(tr);
    });
  }

  // ... 其他方法实现
}

// 初始化
const streamManager = new StreamManager(); 
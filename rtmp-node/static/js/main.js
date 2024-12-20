// 全局配置
const CONFIG = {
    API_BASE_URL: '/api',
    WS_URL: `ws://${location.host}/ws`,
    REFRESH_INTERVAL: 5000,
    PAGE_SIZES: [10, 20, 50],
    STREAM_STATUSES: {
        RUNNING: 'running',
        ERROR: 'error',
        STOPPED: 'stopped'
    }
};

// 工具函数
const utils = {
    showToast(message, type = 'success') {
        const toast = document.getElementById('toast');
        toast.textContent = message;
        toast.className = `toast toast-${type}`;
        toast.style.display = 'block';
        setTimeout(() => toast.style.display = 'none', 3000);
    },

    showLoading() {
        document.getElementById('loadingOverlay').style.display = 'block';
    },

    hideLoading() {
        document.getElementById('loadingOverlay').style.display = 'none';
    },

    showModal(id) {
        document.getElementById(id).style.display = 'block';
    },

    closeModal(id) {
        document.getElementById(id).style.display = 'none';
    },

    formatDate(date) {
        return new Date(date).toLocaleString();
    },

    formatSize(bytes) {
        const units = ['B', 'KB', 'MB', 'GB'];
        let size = bytes;
        let unitIndex = 0;
        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
        }
        return `${size.toFixed(2)} ${units[unitIndex]}`;
    },

    debounce(func, wait) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }
};

// 系统监控
class SystemMonitor {
    constructor() {
        this.initWebSocket();
        this.startMonitoring();
    }

    initWebSocket() {
        this.ws = new WebSocket(CONFIG.WS_URL);
        this.ws.onmessage = this.handleWebSocketMessage.bind(this);
    }

    handleWebSocketMessage(event) {
        const data = JSON.parse(event.data);
        switch (data.type) {
            case 'metrics':
                this.updateMetrics(data.data);
                break;
            case 'error':
                utils.showToast(data.message, 'error');
                break;
        }
    }

    updateMetrics(metrics) {
        document.getElementById('cpuUsage').textContent = `${metrics.cpu.toFixed(1)}%`;
        document.getElementById('memUsage').textContent = `${metrics.memory.toFixed(1)}%`;
        document.getElementById('netSpeed').textContent = utils.formatSize(metrics.network.bytesPerSecond) + '/s';
    }

    startMonitoring() {
        setInterval(() => this.fetchMetrics(), CONFIG.REFRESH_INTERVAL);
    }

    async fetchMetrics() {
        try {
            const response = await fetch(`${CONFIG.API_BASE_URL}/system/metrics`);
            const data = await response.json();
            this.updateMetrics(data);
        } catch (error) {
            console.error('获取系统指标失败:', error);
        }
    }
}

// 配置管理
class ConfigManager {
    constructor() {
        this.configs = [];
        this.loadConfigs();
        this.initEventListeners();
    }

    async loadConfigs() {
        try {
            const response = await fetch(`${CONFIG.API_BASE_URL}/configs`);
            this.configs = await response.json();
            this.updateConfigList();
        } catch (error) {
            utils.showToast('加载配置失败', 'error');
        }
    }

    updateConfigList() {
        const configList = document.querySelector('.config-list');
        if (!configList) return;

        configList.innerHTML = this.configs.map(config => `
            <div class="config-item">
                <div class="config-info">
                    <h3>${config.name}</h3>
                    <p>${config.description || '无描述'}</p>
                </div>
                <div class="config-actions">
                    <button class="btn btn-sm btn-info" onclick="configManager.editConfig('${config.id}')">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-sm btn-danger" onclick="configManager.deleteConfig('${config.id}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `).join('');
    }

    initEventListeners() {
        document.getElementById('configManagerBtn')?.addEventListener('click', () => {
            utils.showModal('configModal');
        });

        document.getElementById('addConfigBtn')?.addEventListener('click', () => {
            this.showConfigEditor();
        });
    }

    // ... 其他配置管理方法
}

// 流管理器
class StreamManager {
    constructor() {
        this.streams = [];
        this.selectedIds = new Set();
        this.currentPage = 1;
        this.pageSize = 10;
        this.filter = 'all';
        this.searchText = '';

        this.initEventListeners();
        this.loadStreams();
    }

    // ... stream.js 中的其他方法
}

// 初始化应用
document.addEventListener('DOMContentLoaded', () => {
    window.systemMonitor = new SystemMonitor();
    window.configManager = new ConfigManager();
    window.streamManager = new StreamManager();
});

// 全局事件处理
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('close-modal')) {
        const modal = e.target.closest('.modal');
        if (modal) utils.closeModal(modal.id);
    }
});

// 登出处理
document.getElementById('logoutBtn')?.addEventListener('click', () => {
    localStorage.removeItem('token');
    location.href = '/login.html';
}); 
// 配置常量
const CONFIG = {
    API_BASE_URL: '',
    REFRESH_INTERVAL: 5000,
    PAGE_SIZES: [10, 20, 50],
    DEFAULT_PAGE_SIZE: 10,
    STREAM_STATUSES: {
        RUNNING: 'running',
        ERROR: 'error',
        STOPPED: 'stopped'
    },
    VIDEO_CODECS: ['copy', 'h264', 'h265'],
    AUDIO_CODECS: ['copy', 'aac', 'mp3'],
    DEFAULT_VIDEO_BITRATE: '2000k',
    DEFAULT_AUDIO_BITRATE: '128k'
};

// API 端点
const API = {
    STREAMS: '/api/streams',
    STREAM_STATUS: (id) => `/api/streams/${id}/status`,
    STREAM_DETAIL: (id) => `/api/streams/${id}`,
    SYSTEM_STATS: '/api/stats'
};

// 错误消息
const MESSAGES = {
    CONFIRM_DELETE: '确定要删除这个流吗？',
    ERROR_FETCH: '获取数据失败',
    ERROR_ADD: '添加流失败',
    ERROR_DELETE: '删除流失败',
    SUCCESS_ADD: '添加流成功',
    SUCCESS_DELETE: '删除流成功'
};

// 转码配置相关
const DEFAULT_CONFIGS = [
    {
        id: 'default-high',
        name: '高清配置',
        videoCodec: 'h264',
        videoBitrate: '2500k',
        videoSize: '1920x1080',
        framerate: '30',
        audioCodec: 'aac',
        audioBitrate: '128k'
    },
    // ... 其他默认配置
];

let configs = [];

function initConfigs() {
    try {
        let storedConfigs = localStorage.getItem('transcodeConfigs');
        if (!storedConfigs) {
            console.log('未找到存储的配置，使用默认配置');
            localStorage.setItem('transcodeConfigs', JSON.stringify(DEFAULT_CONFIGS));
            configs = DEFAULT_CONFIGS;
        } else {
            configs = JSON.parse(storedConfigs);
            console.log('已加载配置:', configs.length, '个');
        }
    } catch (error) {
        console.error('配置初始化失败:', error);
        configs = DEFAULT_CONFIGS;
    }
}

function saveConfig() {
    const configName = document.getElementById('configName').value;
    if (!configName) {
        alert('请输入配置名称');
        return;
    }
    
    const config = {
        id: Date.now().toString(),
        name: configName,
        videoCodec: document.getElementById('videoCodec').value,
        videoBitrate: document.getElementById('videoBitrate').value,
        videoSize: document.getElementById('videoSize').value,
        framerate: document.getElementById('framerate').value,
        audioCodec: document.getElementById('audioCodec').value,
        audioBitrate: document.getElementById('audioBitrate').value
    };
    
    try {
        configs.push(config);
        localStorage.setItem('transcodeConfigs', JSON.stringify(configs));
        alert('配置保存成功');
        document.getElementById('configPanel').style.display = 'none';
        updateStreamConfigSelect();
    } catch (error) {
        console.error('保存配置失败:', error);
        alert('保存配置失败: ' + error.message);
    }
}

class ConfigManager {
    constructor() {
        this.baseUrl = '/api';
        this.configs = [];
        this.initEventListeners();
        this.loadConfigs();
    }

    async loadConfigs() {
        try {
            const response = await fetch(`${this.baseUrl}/configs`);
            this.configs = await response.json();
            this.updateConfigList();
            this.updateConfigSelects();
        } catch (error) {
            showToast('加载配置失败', 'error');
        }
    }

    updateConfigList() {
        const configList = document.querySelector('.config-list');
        configList.innerHTML = '';

        this.configs.forEach(config => {
            const configItem = document.createElement('div');
            configItem.className = 'config-item';
            configItem.innerHTML = `
                <div class="config-info">
                    <h3>${config.name}</h3>
                    <p>${config.description || '无描述'}</p>
                </div>
                <div class="config-actions">
                    <button class="btn btn-sm btn-default" onclick="editConfig(${config.id})">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-sm btn-danger" onclick="deleteConfig(${config.id})">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            `;
            configList.appendChild(configItem);
        });
    }

    updateConfigSelects() {
        const selects = document.querySelectorAll('select[name="configId"]');
        const options = this.configs.map(config => 
            `<option value="${config.id}">${config.name}</option>`
        ).join('');

        selects.forEach(select => {
            select.innerHTML = '<option value="">使用默认配置</option>' + options;
        });
    }

    async addConfig(configData) {
        try {
            const response = await fetch(`${this.baseUrl}/configs`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(configData)
            });

            if (response.ok) {
                await this.loadConfigs();
                showToast('添加配置成功');
                closeModal('configModal');
            }
        } catch (error) {
            showToast('添加配置失败', 'error');
        }
    }

    async updateConfig(id, configData) {
        try {
            const response = await fetch(`${this.baseUrl}/configs/${id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(configData)
            });

            if (response.ok) {
                await this.loadConfigs();
                showToast('更新配置成功');
            }
        } catch (error) {
            showToast('更新配置失败', 'error');
        }
    }

    async deleteConfig(id) {
        if (!confirm('确定要删除此配置吗？')) return;

        try {
            const response = await fetch(`${this.baseUrl}/configs/${id}`, {
                method: 'DELETE'
            });

            if (response.ok) {
                await this.loadConfigs();
                showToast('删除配置成功');
            }
        } catch (error) {
            showToast('删除配置失败', 'error');
        }
    }

    initEventListeners() {
        // 添加配置按钮
        document.getElementById('addConfigBtn').addEventListener('click', () => {
            showConfigEditor();
        });

        // 配置表单提交
        document.getElementById('configForm')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            const configData = Object.fromEntries(formData.entries());
            
            if (configData.id) {
                await this.updateConfig(configData.id, configData);
            } else {
                await this.addConfig(configData);
            }
        });
    }
}

// 初始化配置管理器
const configManager = new ConfigManager();
</rewritten_file> 
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
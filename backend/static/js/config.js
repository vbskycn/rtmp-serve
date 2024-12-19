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
// 工具函数
function copyToClipboard(text) {
    navigator.clipboard.writeText(text)
        .then(() => alert('已复制到剪贴板'))
        .catch(err => console.error('复制失败:', err));
}

function handleResponse(response) {
    return response.json().then(data => {
        if (data.status === 'success') {
            alert(data.message || '操作成功');
            return data;
        }
        throw new Error(data.message || '操作失败');
    });
}

function handleError(error) {
    console.error('Error:', error);
    alert(error.message || '操作失败');
}

function formatDate(date) {
    return new Date(date).toLocaleString();
}

function formatDuration(duration) {
    const parts = duration.split(':');
    return `${parts[0]}小时${parts[1]}分${parts[2]}秒`;
}

function getStatusBadge(status) {
    const badges = {
        running: '<span class="badge success">运行中</span>',
        error: '<span class="badge error">错误</span>',
        stopped: '<span class="badge warning">已停止</span>'
    };
    return badges[status] || '<span class="badge">未知</span>';
}

function getActionButtons(stream) {
    const buttons = [];
    
    if (stream.status === 'running') {
        buttons.push(`<button onclick="stopStream('${stream.id}')" class="action-btn warning">
            <i class="fas fa-stop"></i> 停止
        </button>`);
    } else {
        buttons.push(`<button onclick="startStream('${stream.id}')" class="action-btn success">
            <i class="fas fa-play"></i> 启动
        </button>`);
    }
    
    buttons.push(`
        <button onclick="showStreamDetail('${stream.id}')" class="action-btn info">
            <i class="fas fa-info-circle"></i> 详情
        </button>
        <button onclick="deleteStream('${stream.id}')" class="action-btn danger">
            <i class="fas fa-trash"></i> 删除
        </button>
    `);
    
    return buttons.join('');
}

function getCodecInfo(stream) {
    return `视频: ${stream.video_codec} ${stream.video_bitrate}<br>
            音频: ${stream.audio_codec} ${stream.audio_bitrate}`;
}

function getPlayUrl(stream) {
    return `${stream.output_url}${stream.key}`;
}

// 导出配置
function exportConfig() {
    const config = {
        streams: streams,
        version: '1.0'
    };
    
    const blob = new Blob([JSON.stringify(config, null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `stream_config_${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// 显示确认对话框
function showConfirm(message) {
    return confirm(message);
}

// 显示加载中
function showLoading() {
    // 实现加载提示
}

// 隐藏加载中
function hideLoading() {
    // 实现隐藏加载提示
} 
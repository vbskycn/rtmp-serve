// 流管理相关
const REMOTE_PUSH_URL = 'rtmp://ali.push.yximgs.com/live/';
const LOCAL_RTMP_URL = 'rtmp://localhost:1935/live/';
const REMOTE_PULL_URL = 'http://ali.hlspull.yximgs.com/live/';
const LOCAL_PULL_URL = 'http://localhost:8080/live/';

// 全局变量
let currentPage = 1;
let pageSize = 10;
let streams = [];

// 添加调试函数
function debug(message) {
    console.log(`[Debug] ${message}`);
}

// 显示加载中
function showLoading() {
    const loading = document.createElement('div');
    loading.className = 'loading-overlay';
    loading.innerHTML = '<div class="loading-spinner"></div>';
    document.body.appendChild(loading);
}

// 隐藏加载中
function hideLoading() {
    const loading = document.querySelector('.loading-overlay');
    if (loading) {
        loading.remove();
    }
}

// 关闭模态框
function closeModal(modal) {
    if (typeof modal === 'string') {
        modal = document.querySelector(modal);
    }
    if (modal && modal.parentNode) {
        modal.parentNode.removeChild(modal);
    }
}

// 显示配置面板
function showConfigPanel() {
    debug('显示配置面��');
    const formHtml = `
        <div class="modal-content">
            <div class="modal-header">
                <h2>转码配置</h2>
                <span class="close" onclick="closeModal(this.closest('.modal'))">&times;</span>
            </div>
            <div class="config-form">
                <div class="form-group">
                    <label>配置名称：</label>
                    <input type="text" id="configName" required>
                </div>
                <div class="form-group">
                    <label>视频编码：</label>
                    <select id="videoCodec">
                        <option value="copy">直接复制</option>
                        <option value="h264">H.264</option>
                        <option value="h265">H.265</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>视频码率：</label>
                    <input type="text" id="videoBitrate" placeholder="例如：2000k">
                </div>
                <div class="form-group">
                    <label>音频编码：</label>
                    <select id="audioCodec">
                        <option value="copy">直接复制</option>
                        <option value="aac">AAC</option>
                        <option value="mp3">MP3</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>音频码率：</label>
                    <input type="text" id="audioBitrate" placeholder="例如：128k">
                </div>
                <div class="modal-actions">
                    <button type="button" class="action-btn primary" onclick="saveConfig()">保存</button>
                    <button type="button" class="action-btn" onclick="closeModal(this.closest('.modal'))">取消</button>
                </div>
            </div>
        </div>
    `;
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = formHtml;
    document.body.appendChild(modal);
}

// 显示批量添加表单
function showBatchAddForm() {
    debug('显示批量添加表单');
    const formHtml = `
        <div class="modal-content">
            <div class="modal-header">
                <h2>批量添加流</h2>
                <span class="close" onclick="closeModal(this.closest('.modal'))">&times;</span>
            </div>
            <div class="batch-form">
                <div class="form-group">
                    <label>源地址列表（每行一个）：</label>
                    <textarea id="batchSourceUrls" rows="10" required></textarea>
                </div>
                <div class="form-group">
                    <label>输出类型：</label>
                    <select id="batchOutputUrlType" onchange="updateBatchOutputUrl()">
                        <option value="local">本地</option>
                        <option value="remote">远程</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>转码配置：</label>
                    <select id="batchStreamConfig"></select>
                </div>
                <div class="modal-actions">
                    <button type="button" class="action-btn primary" onclick="addBatchStreams()">添加</button>
                    <button type="button" class="action-btn" onclick="closeModal(this.closest('.modal'))">取消</button>
                </div>
            </div>
        </div>
    `;
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = formHtml;
    document.body.appendChild(modal);
}

// 更新输出地址
function updateOutputUrl() {
    const type = document.getElementById('outputUrlType').value;
    const outputUrl = type === 'remote' ? REMOTE_PUSH_URL : LOCAL_RTMP_URL;
    document.getElementById('outputUrl').value = outputUrl;
}

function updateBatchOutputUrl() {
    const type = document.getElementById('batchOutputUrlType').value;
    return type === 'remote' ? REMOTE_PUSH_URL : LOCAL_RTMP_URL;
}

// 添加单个流
function addStream() {
    debug('添加新流');
    const streamKey = document.getElementById('streamKey').value;
    if (!streamKey) {
        alert('请输入推流密钥');
        return;
    }
    
    const data = {
        id: streamKey,
        name: document.getElementById('streamName').value || streamKey,
        sourceUrl: document.getElementById('sourceUrl').value,
        outputUrl: document.getElementById('outputUrl').value,
        key: streamKey,
        configId: document.getElementById('streamConfig').value
    };
    
    debug('发送数据:', data);
    
    fetch('/api/streams', {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest'  // 添加AJAX标识
        },
        credentials: 'same-origin',  // 包含cookie
        body: JSON.stringify(data)
    })
    .then(response => {
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
    })
    .then(data => {
        debug('响应数据:', data);
        if (data.status === 'success') {
            hideAddForm();
            refreshStreamList();
            alert('添加成功');
        } else {
            throw new Error(data.message || '添加失败');
        }
    })
    .catch(error => {
        console.error('Error:', error);
        alert('添加失败: ' + error.message);
    });
}

// 批量添加流
function addBatchStreams() {
    const urls = document.getElementById('batchSourceUrls').value.split('\n').filter(url => url.trim());
    const outputUrl = updateBatchOutputUrl();
    const configId = document.getElementById('batchStreamConfig').value;
    
    const streams = urls.map(url => {
        const key = url.split('/').pop().replace(/\.[^/.]+$/, '');
        return {
            id: key,
            name: key,
            sourceUrl: url.trim(),
            outputUrl: outputUrl,
            key: key,
            configId: configId
        };
    });
    
    fetch('/api/streams/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(streams)
    })
    .then(handleResponse)
    .then(() => {
        hideBatchAddForm();
        refreshStreamList();
    })
    .catch(handleError);
}

// 刷新流列表
async function refreshStreamList() {
    try {
        showLoading();
        const response = await fetch('/api/streams');
        const data = await response.json();
        streams = data;
        updateStreamTable();
        updateStats();
        hideLoading();
    } catch (error) {
        console.error('Failed to refresh streams:', error);
        hideLoading();
        alert('获取流列表失败');
    }
}

// 更新流表格
function updateStreamTable() {
    const tbody = document.getElementById('streamTableBody');
    if (!tbody) {
        console.error('找不到流表格体元素');
        return;
    }
    
    tbody.innerHTML = '';
    streams.forEach(stream => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><input type="checkbox" class="stream-select" value="${stream.id}"></td>
            <td>${stream.name}</td>
            <td>${stream.source_url}</td>
            <td>${stream.output_url}</td>
            <td>${getPlayUrl(stream)}</td>
            <td>${getCodecInfo(stream)}</td>
            <td>${getStatusBadge(stream.status || 'stopped')}</td>
            <td>${getActionButtons(stream)}</td>
        `;
        tbody.appendChild(tr);
    });
}

// 启动流
async function startStream(id) {
    try {
        showLoading();
        const response = await fetch(`/api/streams/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'start' })
        });
        
        const data = await response.json();
        if (data.status === 'success') {
            await refreshStreamList();
            showSuccess('启动成功');
        } else {
            throw new Error(data.message || '启动失败');
        }
    } catch (error) {
        console.error('Failed to start stream:', error);
        alert(error.message || '启动失败');
    } finally {
        hideLoading();
    }
}

// 停止流
async function stopStream(id) {
    if (!confirm('确定要停止这个流吗？')) {
        return;
    }
    
    try {
        showLoading();
        const response = await fetch(`/api/streams/${id}`, {
            method: 'DELETE'
        });
        
        const data = await response.json();
        if (data.status === 'success') {
            await refreshStreamList();
            showSuccess('停止成功');
        } else {
            throw new Error(data.message || '停止失败');
        }
    } catch (error) {
        console.error('Failed to stop stream:', error);
        alert(error.message || '停止失败');
    } finally {
        hideLoading();
    }
}

// 搜索流
function searchStreams(keyword) {
    const tbody = document.getElementById('streamTableBody');
    const rows = tbody.getElementsByTagName('tr');
    
    keyword = keyword.toLowerCase();
    for (let row of rows) {
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(keyword) ? '' : 'none';
    }
}

// 筛选流
function filterStreams(status) {
    const tbody = document.getElementById('streamTableBody');
    const rows = tbody.getElementsByTagName('tr');
    
    for (let row of rows) {
        if (status === 'all') {
            row.style.display = '';
        } else {
            const statusCell = row.querySelector('td:nth-child(7)');
            const hasStatus = statusCell.textContent.toLowerCase().includes(status);
            row.style.display = hasStatus ? '' : 'none';
        }
    }
    
    // 更新筛选按钮状态
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-filter') === status);
    });
}

// 批量操作
function batchAction(action) {
    const selectedStreams = Array.from(document.querySelectorAll('.stream-select:checked'))
        .map(checkbox => checkbox.value);
        
    if (selectedStreams.length === 0) {
        alert('请选择要操作的流');
        return;
    }
    
    const actions = {
        start: '启动',
        stop: '停止',
        delete: '删除'
    };
    
    if (!confirm(`确定要${actions[action]}选中的 ${selectedStreams.length} 个流吗？`)) {
        return;
    }
    
    const promises = selectedStreams.map(streamId => {
        const url = `/api/streams/${streamId}`;
        const method = action === 'delete' ? 'DELETE' : 'PUT';
        const body = action === 'start' ? JSON.stringify({ action: 'start' }) : null;
        
        return fetch(url, { 
            method, 
            headers: { 'Content-Type': 'application/json' },
            body 
        })
        .then(response => response.json())
        .then(result => ({ streamId, result }));
    });
    
    Promise.all(promises)
        .then(results => {
            const success = results.filter(r => r.result.status === 'success').length;
            alert(`操作完成：${success}/${selectedStreams.length} 个操作成功`);
            refreshStreamList();
        })
        .catch(handleError);
}

// 导出配置
function exportStreams() {
    fetch('/api/streams')
        .then(response => response.json())
        .then(streams => {
            const data = JSON.stringify(streams, null, 2);
            const blob = new Blob([data], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'streams.json';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        })
        .catch(handleError);
}

// 全选/取消全选
function toggleAllStreams(checkbox) {
    const checkboxes = document.querySelectorAll('.stream-select');
    checkboxes.forEach(box => box.checked = checkbox.checked);
}

// 获取状态文本
function getStatusText(status) {
    const statusMap = {
        'running': '运行中',
        'stopped': '已停止',
        'error': '错误',
        'restarting': '重启中'
    };
    return statusMap[status] || '未知';
}

// 页面加载时初始化
document.addEventListener('DOMContentLoaded', function() {
    debug('页面加载完成，开始初始化...');
    
    // 添加流按钮
    const addBtn = document.getElementById('addStreamBtn');
    if (addBtn) {
        addBtn.addEventListener('click', function(e) {
            e.preventDefault();
            showAddForm();
        });
    }
    
    // 批量添加按钮
    const batchAddBtn = document.getElementById('batchAddBtn');
    if (batchAddBtn) {
        batchAddBtn.addEventListener('click', function(e) {
            e.preventDefault();
            showBatchAddForm();
        });
    }
    
    // 转码配置按钮
    const configBtn = document.getElementById('configBtn');
    if (configBtn) {
        configBtn.addEventListener('click', function(e) {
            e.preventDefault();
            showConfigPanel();
        });
    }
    
    // 导出配置按钮
    const exportBtn = document.getElementById('exportBtn');
    if (exportBtn) {
        exportBtn.addEventListener('click', function(e) {
            e.preventDefault();
            exportStreams();
        });
    }
    
    // 批量操作按钮
    document.querySelectorAll('.panel-section button[data-action]').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.preventDefault();
            batchAction(this.dataset.action);
        });
    });
    
    // 筛选按钮
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.preventDefault();
            filterStreams(this.dataset.filter);
        });
    });
    
    // 搜索输入框
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('input', function(e) {
            searchStreams(e.target.value);
        });
    }
    
    // 刷新按钮
    const refreshBtn = document.querySelector('.refresh-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', function(e) {
            e.preventDefault();
            refreshStreamList();
        });
    }
    
    // 初始化数据
    refreshStreamList();
    
    debug('初始化完成');
});

// 添加调试功能
function debug(...args) {
    console.log('[Debug]', ...args);
}

// 错误处理
function handleError(error) {
    console.error('[Error]', error);
    alert(error.message || '操作失败');
}

// 成功提示
function showSuccess(message) {
    alert(message);
}

// 提交添加流表单
function submitAddStream() {
    const streamKey = document.getElementById('streamKey').value;
    if (!streamKey) {
        alert('请输入推流密钥');
        return;
    }
    
    const data = {
        id: streamKey,
        name: document.getElementById('streamName').value || streamKey,
        sourceUrl: document.getElementById('sourceUrl').value,
        outputUrl: document.getElementById('outputUrl').value,
        key: streamKey
    };
    
    fetch('/api/streams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    })
    .then(response => response.json())
    .then(result => {
        if (result.status === 'success') {
            closeModal(document.querySelector('.modal'));
            refreshStreamList();
            showSuccess('添加成功');
        } else {
            throw new Error(result.message || '添加失败');
        }
    })
    .catch(error => {
        console.error('Error:', error);
        alert(error.message || '添加失败');
    });
}
</rewritten_file> 
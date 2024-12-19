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

// 显示/隐藏表单
function showAddForm() {
    debug('显示添加表单');
    const form = document.getElementById('addStreamForm');
    if (!form) {
        console.error('找不到添加表单元素');
        return;
    }
    form.style.display = 'block';
    updateStreamConfigSelect();
}

function hideAddForm() {
    document.getElementById('addStreamForm').style.display = 'none';
}

function showBatchAddForm() {
    document.getElementById('batchAddForm').style.display = 'block';
    updateStreamConfigSelect();
}

function hideBatchAddForm() {
    document.getElementById('batchAddForm').style.display = 'none';
}

function showConfigPanel() {
    const panel = document.getElementById('configPanel');
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
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
function refreshStreamList() {
    fetch('/api/streams')
        .then(response => response.json())
        .then(streams => {
            const tbody = document.getElementById('streamTableBody');
            tbody.innerHTML = '';
            streams.forEach(stream => {
                const playUrl = `${stream.outputUrl === REMOTE_PUSH_URL ? 
                    REMOTE_PULL_URL : LOCAL_PULL_URL}${stream.key}.flv`;
                
                const row = `
                    <tr>
                        <td>
                            <input type="checkbox" class="stream-select" value="${stream.id}">
                        </td>
                        <td>${stream.name || stream.id}</td>
                        <td>
                            ${stream.sourceUrl}
                            <button class="copy-btn" onclick="copyToClipboard('${stream.sourceUrl}')">复制</button>
                        </td>
                        <td>
                            ${stream.outputUrl}${stream.key}
                            <button class="copy-btn" onclick="copyToClipboard('${stream.outputUrl}${stream.key}')">复制</button>
                        </td>
                        <td>
                            <button class="copy-btn" onclick="copyToClipboard('${playUrl}')">复制播放地址</button>
                        </td>
                        <td>
                            <select onchange="updateStreamConfig('${stream.id}', this.value)">
                                <option value="default-copy" ${(!stream.configId || stream.configId === 'default-copy') ? 'selected' : ''}>
                                    原画配置
                                </option>
                                ${configs.filter(c => c.id !== 'default-copy').map(config => `
                                    <option value="${config.id}" ${stream.configId === config.id ? 'selected' : ''}>
                                        ${config.name}
                                    </option>
                                `).join('')}
                            </select>
                        </td>
                        <td class="status-${stream.status || 'stopped'}">${getStatusText(stream.status)}</td>
                        <td>
                            <button class="action-btn edit-btn" onclick="editStream('${stream.id}')">编辑</button>
                            <button class="action-btn delete-btn" onclick="deleteStream('${stream.id}')">删除</button>
                        </td>
                    </tr>
                `;
                tbody.insertAdjacentHTML('beforeend', row);
            });
        })
        .catch(handleError);
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
            alert(`操作完成：${success}/${selectedStreams.length} 个流操作成功`);
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
    console.log('DOM加载完成，初始化事件监听');
    initEventListeners();
    refreshStreamList();
});

// 自动刷新状态
setInterval(refreshStreamList, 30000);

// 初始化事件监听
function initEventListeners() {
    // 添加流按钮
    const addBtn = document.querySelector('button[onclick="showAddForm()"]');
    if (addBtn) {
        addBtn.onclick = function(e) {
            e.preventDefault();
            showAddForm();
        };
    }

    // 批量添加按钮
    const batchAddBtn = document.querySelector('button[onclick="showBatchAddForm()"]');
    if (batchAddBtn) {
        batchAddBtn.onclick = function(e) {
            e.preventDefault();
            showBatchAddForm();
        };
    }

    // 配置按钮
    const configBtn = document.querySelector('button[onclick="showConfigPanel()"]');
    if (configBtn) {
        configBtn.onclick = function(e) {
            e.preventDefault();
            showConfigPanel();
        };
    }

    // 搜索输入框
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.onkeyup = function(e) {
            searchStreams(e.target.value);
        };
    }

    // 筛选按钮
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.onclick = function(e) {
            e.preventDefault();
            filterStreams(btn.getAttribute('data-filter'));
        };
    });
}

// 刷新流列表
async function refreshStreamList() {
    try {
        const response = await fetch('/api/streams');
        streams = await response.json();
        updateStreamTable();
        updateStats();
    } catch (error) {
        console.error('Failed to fetch streams:', error);
        showError('获取流列表失败');
    }
}

// 更新流表格
function updateStreamTable() {
    const tbody = document.getElementById('streamTableBody');
    tbody.innerHTML = '';
    
    const filteredStreams = filterAndSearchStreams();
    const paginatedStreams = paginateStreams(filteredStreams);
    
    paginatedStreams.forEach(stream => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><input type="checkbox" value="${stream.id}"></td>
            <td>${stream.name}</td>
            <td>${stream.source_url}</td>
            <td>${stream.output_url}${stream.key}</td>
            <td>${getPlayUrl(stream)}</td>
            <td>${getCodecInfo(stream)}</td>
            <td>${getStatusBadge(stream.status)}</td>
            <td>${getActionButtons(stream)}</td>
        `;
        tbody.appendChild(tr);
    });
    
    updatePagination(filteredStreams.length);
}

// 添加流
async function addStream(data) {
    try {
        const response = await fetch('/api/streams', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });
        
        if (!response.ok) {
            throw new Error('添加流失败');
        }
        
        await refreshStreamList();
        showSuccess('添加流成功');
    } catch (error) {
        console.error('Failed to add stream:', error);
        showError(error.message);
    }
}

// 删除流
async function deleteStream(id) {
    if (!confirm('确定要删除这个流吗？')) {
        return;
    }
    
    try {
        const response = await fetch(`/api/streams/${id}`, {
            method: 'DELETE'
        });
        
        if (!response.ok) {
            throw new Error('删除流失败');
        }
        
        await refreshStreamList();
        showSuccess('删除流成功');
    } catch (error) {
        console.error('Failed to delete stream:', error);
        showError(error.message);
    }
}

// 更新统计信息
function updateStats() {
    const stats = {
        running: streams.filter(s => s.status === 'running').length,
        error: streams.filter(s => s.status === 'error').length,
        stopped: streams.filter(s => s.status === 'stopped').length
    };
    
    document.getElementById('runningStreams').textContent = stats.running;
    document.getElementById('errorStreams').textContent = stats.error;
    document.getElementById('stoppedStreams').textContent = stats.stopped;
}

// 添加错误提示功能
function showError(message) {
    // 实现错误提示
    alert(message);
}

function showSuccess(message) {
    // 实现成功提示
    alert(message);
}
</rewritten_file> 
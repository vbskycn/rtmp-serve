// 格式化运行时间
function formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    const remainingHours = hours % 24;
    const remainingMinutes = minutes % 60;

    let result = '';
    if (days > 0) result += `${days}天`;
    if (remainingHours > 0) result += `${remainingHours}时`;
    if (remainingMinutes > 0) result += `${remainingMinutes}分`;
    if (result === '') result = '刚刚启动';

    return result;
}

// 复制到剪贴板
function copyToClipboard(text) {
    const input = document.createElement('input');
    input.style.position = 'fixed';
    input.style.opacity = 0;
    input.value = text;
    document.body.appendChild(input);
    
    input.select();
    input.setSelectionRange(0, 99999);
    
    try {
        document.execCommand('copy');
        showToast('已复制到剪贴板');
    } catch (err) {
        console.error('复制失败:', err);
        alert('复制失败');
    } finally {
        document.body.removeChild(input);
    }
}

// 显示进度模态框
function showProgressModal(title) {
    const modal = document.createElement('div');
    modal.className = 'modal fade show';
    modal.style.display = 'block';
    modal.style.backgroundColor = 'rgba(0,0,0,0.5)';
    modal.innerHTML = `
        <div class="modal-dialog modal-dialog-centered">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title">${title}</h5>
                </div>
                <div class="modal-body">
                    <div class="progress mb-3" style="height: 20px;">
                        <div class="progress-bar progress-bar-striped progress-bar-animated" 
                             role="progressbar" style="width: 0%"></div>
                    </div>
                    <div id="progressStats" class="text-center">
                        <div class="text-info">准备处理...</div>
                    </div>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    return modal;
}

// 更新进度模态框
function updateProgressModal(modal, stats) {
    const { success, failed, total, current } = stats;
    const progress = ((current || success) / total * 100).toFixed(1);
    
    const progressBar = modal.querySelector('.progress-bar');
    progressBar.style.width = `${progress}%`;
    progressBar.style.backgroundColor = success > 0 ? '#28a745' : '#dc3545';
    
    const statsDiv = modal.querySelector('#progressStats');
    statsDiv.innerHTML = `
        <div class="text-center">
            <div class="h5 mb-2">处理进度: ${current || (success + (failed || 0))}/${total}</div>
            <div class="text-success">成功: ${success}</div>
            ${failed ? `<div class="text-danger">失败: ${failed}</div>` : ''}
            ${current < total ? '<div class="text-info mt-2">正在处理中...</div>' : 
                              '<div class="text-success mt-2">处理完成!</div>'}
        </div>
    `;
}

// 显示提示消息
function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'alert alert-success position-fixed bottom-0 end-0 m-3';
    toast.style.zIndex = '9999';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
}

// 更新统计元素
function updateStatElement(elementId, newValue) {
    const element = document.getElementById(elementId);
    if (!element) return;
    
    if (element.textContent !== String(newValue)) {
        element.style.transition = 'opacity 0.3s';
        element.style.opacity = '0';
        setTimeout(() => {
            element.textContent = newValue;
            element.style.opacity = '1';
        }, 300);
    }
}

// 加载流列表
async function loadStreams() {
    try {
        const response = await fetch('/api/streams');
        const streams = await response.json();
        
        // 验证流数据的完整性
        const validStreams = streams.filter(stream => {
            if (!stream.name) {
                console.warn(`Stream ${stream.id} has no name`);
                stream.name = '未命名流';
            }
            return true;
        });

        // 更新统计数据
        updateStatElement('totalStreams', validStreams.length);
        updateStatElement('activeStreams', validStreams.filter(s => 
            s.processRunning || s.stats?.startTime
        ).length);

        // 按分类分组
        const groupedStreams = {};
        validStreams.forEach(stream => {
            const category = stream.category || '未分类';
            if (!groupedStreams[category]) {
                groupedStreams[category] = [];
            }
            groupedStreams[category].push(stream);
        });

        const tbody = document.querySelector('#streamTable');
        
        // 检查是否需要完全重新渲染
        const needsFullRerender = checkIfNeedsFullRerender(tbody, groupedStreams);
        
        if (needsFullRerender) {
            const newTbody = document.createElement('tbody');
            newTbody.id = 'streamTable';
            renderFullTable(newTbody, groupedStreams);
            
            tbody.style.transition = 'opacity 0.3s';
            tbody.style.opacity = '0';
            
            setTimeout(() => {
                tbody.parentNode.replaceChild(newTbody, tbody);
                requestAnimationFrame(() => {
                    newTbody.style.opacity = '1';
                });
            }, 300);
        } else {
            updateExistingRows(tbody, groupedStreams);
        }
    } catch (error) {
        console.error('Error loading streams:', error);
    }
}

// 检查是否需要完全重新渲染
function checkIfNeedsFullRerender(tbody, groupedStreams) {
    const currentIds = Array.from(tbody.querySelectorAll('tr[data-stream-id]'))
        .map(row => row.dataset.streamId);
    
    const newIds = Object.values(groupedStreams)
        .flat()
        .map(stream => stream.id);
    
    if (currentIds.length !== newIds.length) return true;
    return !currentIds.every((id, index) => id === newIds[index]);
}

// 更新现有行
function updateExistingRows(tbody, groupedStreams) {
    Object.values(groupedStreams)
        .flat()
        .forEach(stream => {
            const row = tbody.querySelector(`tr[data-stream-id="${stream.id}"]`);
            if (row) {
                updateRowElements(row, stream);
            }
        });
}

// 更新行元素
function updateRowElements(row, stream) {
    // 更新状态
    const statusSpan = row.querySelector('.status');
    if (statusSpan) {
        let statusClass = '';
        let statusText = '';
        let statusStyle = '';
        
        if (stream.status === 'invalid') {
            statusClass = 'error';
            statusText = '已失效';
            statusStyle = 'background-color: #dc3545;';
        } else if (stream.processRunning && stream.status === 'running') {
            statusClass = 'active';
            statusText = '运行中';
            statusStyle = 'background-color: #28a745;';
        } else {
            statusClass = 'inactive';
            statusText = '已停止';
            statusStyle = 'background-color: #6c757d;';
        }
        
        if (statusSpan.textContent !== statusText) {
            statusSpan.className = `status ${statusClass}`;
            statusSpan.style = statusStyle;
            statusSpan.textContent = statusText;
        }
    }

    // 更新其他元素...
    // (保留原有的更新逻辑)
} 
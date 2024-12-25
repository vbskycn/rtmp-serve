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
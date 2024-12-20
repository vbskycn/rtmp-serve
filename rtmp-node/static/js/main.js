document.addEventListener('DOMContentLoaded', function() {
    // 初始化事件监听
    initEventListeners();
    // 加载初始数据
    loadStreamList();
    // 开始定时更新系统信息
    startSystemInfoUpdate();
});

function initEventListeners() {
    // 添加流按钮
    document.getElementById('addStreamBtn').addEventListener('click', () => {
        document.getElementById('addStreamModal').style.display = 'block';
    });

    // 关闭模态框
    document.querySelectorAll('.close-modal').forEach(button => {
        button.addEventListener('click', () => {
            document.getElementById('addStreamModal').style.display = 'none';
        });
    });

    // 添加流表单提交
    document.getElementById('addStreamForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const streamData = {
            name: formData.get('name'),
            sourceUrl: formData.get('sourceUrl'),
            transcodeConfig: formData.get('transcodeConfig')
        };

        try {
            const response = await fetch('/api/streams', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(streamData)
            });

            if (response.ok) {
                document.getElementById('addStreamModal').style.display = 'none';
                loadStreamList(); // 重新加载列表
            } else {
                alert('添加失败，请重试');
            }
        } catch (error) {
            console.error('添加流失败:', error);
            alert('添加失败，请检查网络连接');
        }
    });

    // 筛选按钮
    document.querySelectorAll('.filter-btn').forEach(button => {
        button.addEventListener('click', (e) => {
            document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
            e.target.classList.add('active');
            loadStreamList(e.target.dataset.status);
        });
    });

    // 刷新按钮
    document.getElementById('refreshBtn').addEventListener('click', () => {
        loadStreamList();
    });

    // 退出按钮
    document.getElementById('logoutBtn').addEventListener('click', async () => {
        try {
            await fetch('/api/auth/logout', { method: 'POST' });
            window.location.href = '/login';
        } catch (error) {
            console.error('退出失败:', error);
        }
    });
}

async function loadStreamList(status = 'all') {
    try {
        const response = await fetch(`/api/streams?status=${status}`);
        const data = await response.json();
        
        updateStreamTable(data.streams);
        updateStatusCounts(data.counts);
    } catch (error) {
        console.error('加载流列表失败:', error);
    }
}

function updateStreamTable(streams) {
    const tbody = document.getElementById('streamTableBody');
    tbody.innerHTML = '';

    streams.forEach(stream => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><input type="checkbox" value="${stream.id}"></td>
            <td>${stream.name}</td>
            <td>${stream.sourceUrl}</td>
            <td>${stream.pushUrl || '-'}</td>
            <td>${stream.playUrl || '-'}</td>
            <td>${stream.transcodeConfig || '无'}</td>
            <td><span class="status-${stream.status}">${getStatusText(stream.status)}</span></td>
            <td>
                ${getActionButtons(stream)}
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function getStatusText(status) {
    const statusMap = {
        running: '运行中',
        stopped: '已停止',
        error: '异���'
    };
    return statusMap[status] || status;
}

function getActionButtons(stream) {
    if (stream.status === 'running') {
        return `<button onclick="stopStream('${stream.id}')">停止</button>`;
    }
    return `<button onclick="startStream('${stream.id}')">启动</button>`;
}

function updateStatusCounts(counts) {
    document.getElementById('runningCount').textContent = counts.running || 0;
    document.getElementById('errorCount').textContent = counts.error || 0;
    document.getElementById('stoppedCount').textContent = counts.stopped || 0;
}

async function startSystemInfoUpdate() {
    setInterval(async () => {
        try {
            const response = await fetch('/api/system/info');
            const data = await response.json();
            
            document.getElementById('cpuUsage').textContent = `${data.cpu}%`;
            document.getElementById('memoryUsage').textContent = `${data.memory}%`;
            document.getElementById('networkSpeed').textContent = `${data.network} MB/s`;
        } catch (error) {
            console.error('更新系统信息失败:', error);
        }
    }, 5000); // 每5秒更新一次
}

async function startStream(id) {
    try {
        const response = await fetch(`/api/streams/${id}/start`, { method: 'POST' });
        if (response.ok) {
            loadStreamList();
        } else {
            alert('启动失败，请重试');
        }
    } catch (error) {
        console.error('启动流失败:', error);
    }
}

async function stopStream(id) {
    try {
        const response = await fetch(`/api/streams/${id}/stop`, { method: 'POST' });
        if (response.ok) {
            loadStreamList();
        } else {
            alert('停止失败，请重试');
        }
    } catch (error) {
        console.error('停止流失败:', error);
    }
} 
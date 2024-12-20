class StreamManager {
    constructor() {
        this.streams = [];
        this.selectedIds = new Set();
        this.currentPage = 1;
        this.pageSize = 10;
        this.totalPages = 1;
        this.currentFilter = 'all';
        this.searchText = '';
        
        this.initWebSocket();
        this.initEventListeners();
        this.loadStreams();
        addLoadingOverlay();
    }

    initWebSocket() {
        this.ws = new WebSocket(`ws://${location.host}/ws`);
        
        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            switch (data.type) {
                case 'stream_status':
                    this.handleStreamStatusUpdate(data.data);
                    break;
                case 'metrics':
                    this.updateMetricsDisplay(data.data);
                    break;
                case 'error':
                    showToast(data.data.message, 'error');
                    break;
            }
        };
    }

    initEventListeners() {
        // 添加流按钮
        document.getElementById('addStreamBtn').addEventListener('click', () => {
            showModal('addStreamModal');
        });

        // 提交添加流表单
        document.getElementById('submitAddStream').addEventListener('click', () => {
            this.handleAddStream();
        });

        // 批量导入按钮
        document.getElementById('batchImportBtn').addEventListener('click', () => {
            showModal('batchImportModal');
        });

        // 提交批量导入
        document.getElementById('submitImport').addEventListener('click', () => {
            this.handleBatchImport();
        });

        // 批量操作按钮
        document.getElementById('batchStartBtn').addEventListener('click', () => {
            this.handleBatchAction('start');
        });
        document.getElementById('batchStopBtn').addEventListener('click', () => {
            this.handleBatchAction('stop');
        });
        document.getElementById('batchDeleteBtn').addEventListener('click', () => {
            this.handleBatchAction('delete');
        });

        // 导出按钮
        document.getElementById('exportBtn').addEventListener('click', () => {
            this.exportStreams();
        });

        // 筛选按钮
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.handleFilter(e.target.dataset.status);
            });
        });

        // 搜索输入
        document.getElementById('searchInput').addEventListener('input', 
            debounce((e) => this.handleSearch(e.target.value), 300)
        );

        // 分页控制
        document.getElementById('pageSize').addEventListener('change', (e) => {
            this.pageSize = parseInt(e.target.value);
            this.currentPage = 1;
            this.updateStreamTable();
        });

        document.getElementById('prevPage').addEventListener('click', () => {
            if (this.currentPage > 1) {
                this.currentPage--;
                this.updateStreamTable();
            }
        });

        document.getElementById('nextPage').addEventListener('click', () => {
            if (this.currentPage < this.totalPages) {
                this.currentPage++;
                this.updateStreamTable();
            }
        });

        // 全选框
        document.getElementById('selectAll').addEventListener('change', (e) => {
            this.handleSelectAll(e.target.checked);
        });

        // 添加导入类型切换处理
        document.getElementById('importType')?.addEventListener('change', (e) => {
            const textImport = document.getElementById('textImport');
            const fileImport = document.getElementById('fileImport');
            if (e.target.value === 'text') {
                textImport.style.display = 'block';
                fileImport.style.display = 'none';
            } else {
                textImport.style.display = 'none';
                fileImport.style.display = 'block';
            }
        });

        // 清空导入表单
        document.getElementById('batchImportBtn')?.addEventListener('click', () => {
            const textarea = document.querySelector('#textImport textarea');
            const fileInput = document.querySelector('#fileImport input[type="file"]');
            if (textarea) textarea.value = '';
            if (fileInput) fileInput.value = '';
        });
    }

    async loadStreams() {
        try {
            showLoading();
            const response = await fetch('/api/streams');
            const data = await response.json();
            
            if (data.status === 'success') {
                this.streams = data.data;
                this.updateStreamTable();
                this.updateStats();
            } else {
                showToast(data.message || '加载失败', 'error');
            }
        } catch (error) {
            showToast('加载流列表失败', 'error');
            console.error(error);
        } finally {
            hideLoading();
        }
    }

    updateStreamTable() {
        const tbody = document.getElementById('streamList');
        tbody.innerHTML = '';

        // 应用筛选和搜索
        let filteredStreams = this.streams.filter(stream => {
            const matchesFilter = this.currentFilter === 'all' || stream.status === this.currentFilter;
            const matchesSearch = !this.searchText || 
                stream.name.toLowerCase().includes(this.searchText.toLowerCase()) ||
                stream.sourceUrl.toLowerCase().includes(this.searchText.toLowerCase());
            return matchesFilter && matchesSearch;
        });

        // 计算分页
        this.totalPages = Math.ceil(filteredStreams.length / this.pageSize);
        document.getElementById('currentPage').textContent = this.currentPage;
        document.getElementById('totalPages').textContent = this.totalPages;

        // 获取当前页数据
        const start = (this.currentPage - 1) * this.pageSize;
        const pageStreams = filteredStreams.slice(start, start + this.pageSize);

        // 渲染表格
        pageStreams.forEach(stream => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>
                    <input type="checkbox" class="stream-select" value="${stream.id}"
                        ${this.selectedIds.has(stream.id) ? 'checked' : ''}>
                </td>
                <td>${stream.name}</td>
                <td>${stream.sourceUrl}</td>
                <td>${stream.pushUrl}</td>
                <td>${stream.config?.name || '默认配置'}</td>
                <td>
                    <span class="status-tag status-${stream.status}">
                        ${this.getStatusText(stream.status)}
                    </span>
                </td>
                <td class="action-buttons">
                    ${this.getActionButtons(stream)}
                </td>
            `;

            this.addStreamRowListeners(tr);
            tbody.appendChild(tr);
        });

        // 更新批量操作按钮状态
        this.updateBatchButtons();
    }

    getStatusText(status) {
        const statusMap = {
            running: '运行中',
            stopped: '已停止',
            error: '错误'
        };
        return statusMap[status] || status;
    }

    getActionButtons(stream) {
        const buttons = [];
        
        if (stream.status === 'running') {
            buttons.push(`
                <button class="btn btn-sm btn-warning" data-action="stop" title="停止">
                    <i class="fas fa-stop"></i>
                </button>
            `);
        } else {
            buttons.push(`
                <button class="btn btn-sm btn-success" data-action="start" title="启动">
                    <i class="fas fa-play"></i>
                </button>
            `);
        }

        buttons.push(`
            <button class="btn btn-sm btn-info" data-action="edit" title="编辑">
                <i class="fas fa-edit"></i>
            </button>
            <button class="btn btn-sm btn-danger" data-action="delete" title="删除">
                <i class="fas fa-trash"></i>
            </button>
        `);

        return buttons.join('');
    }

    addStreamRowListeners(tr) {
        // 复选框事件
        const checkbox = tr.querySelector('.stream-select');
        if (checkbox) {
            checkbox.addEventListener('change', (e) => {
                const id = e.target.value;
                if (e.target.checked) {
                    this.selectedIds.add(id);
                } else {
                    this.selectedIds.delete(id);
                }
                this.updateBatchButtons();
            });
        }

        // 操作按钮事件
        tr.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const action = e.target.closest('[data-action]').dataset.action;
                const id = e.target.closest('tr').querySelector('.stream-select').value;
                this.handleStreamAction(action, id);
            });
        });
    }

    async handleStreamAction(action, id) {
        try {
            showLoading();
            let url = `/api/streams/${id}`;
            let method = 'POST';

            switch (action) {
                case 'start':
                    url += '/start';
                    break;
                case 'stop':
                    url += '/stop';
                    break;
                case 'delete':
                    method = 'DELETE';
                    if (!confirm('确定要删除这个流吗？')) {
                        return;
                    }
                    break;
                case 'edit':
                    this.showEditModal(id);
                    return;
            }

            const response = await fetch(url, { method });
            const data = await response.json();

            if (data.status === 'success') {
                showToast('操作成功');
                await this.loadStreams();
            } else {
                showToast(data.message || '操作失败', 'error');
            }
        } catch (error) {
            showToast('操作失败', 'error');
            console.error(error);
        } finally {
            hideLoading();
        }
    }

    async handleAddStream() {
        try {
            const form = document.getElementById('addStreamForm');
            const formData = new FormData(form);
            const streamData = {
                name: formData.get('name'),
                sourceUrl: formData.get('sourceUrl'),
                pushUrl: formData.get('pushUrl'),
                configId: formData.get('configId') || null
            };

            // 验证表单
            if (!streamData.name || !streamData.sourceUrl || !streamData.pushUrl) {
                utils.showToast('请填写所有必填字段', 'error');
                return;
            }

            utils.showLoading();
            const response = await fetch('/api/streams', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(streamData)
            });

            const data = await response.json();
            if (data.status === 'success') {
                utils.showToast('添加成功');
                utils.closeModal('addStreamModal');
                form.reset();
                await this.loadStreams();
            } else {
                utils.showToast(data.message || '添加失败', 'error');
            }
        } catch (error) {
            console.error('添加流失败:', error);
            utils.showToast('添加失败', 'error');
        } finally {
            utils.hideLoading();
        }
    }

    async handleBatchImport() {
        try {
            const importType = document.getElementById('importType').value;
            let streamDataList = [];

            if (importType === 'text') {
                const textarea = document.querySelector('#textImport textarea');
                streamDataList = this.parseImportText(textarea.value);
            } else {
                const fileInput = document.querySelector('#fileImport input[type="file"]');
                if (!fileInput.files.length) {
                    utils.showToast('请选择文件', 'error');
                    return;
                }
                streamDataList = await this.parseImportFile(fileInput.files[0]);
            }

            if (!streamDataList.length) {
                utils.showToast('没有有效的导入数据', 'error');
                return;
            }

            utils.showLoading();
            const results = await this.importStreams(streamDataList);
            
            // 显示导入结果
            const successCount = results.filter(r => r.status === 'success').length;
            const failCount = results.length - successCount;
            
            utils.showToast(`导入完成: ${successCount}个成功, ${failCount}个失败`);
            if (successCount > 0) {
                utils.closeModal('batchImportModal');
                await this.loadStreams();
            }
        } catch (error) {
            console.error('批量导入失败:', error);
            utils.showToast('批量导入失败', 'error');
        } finally {
            utils.hideLoading();
        }
    }

    parseImportText(text) {
        const lines = text.trim().split('\n');
        return lines.map(line => {
            const [name, sourceUrl, pushUrl, configId] = line.split(',').map(s => s.trim());
            if (!name || !sourceUrl || !pushUrl) return null;
            return { name, sourceUrl, pushUrl, configId };
        }).filter(data => data !== null);
    }

    async parseImportFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const text = e.target.result;
                    resolve(this.parseImportText(text));
                } catch (error) {
                    reject(error);
                }
            };
            reader.onerror = reject;
            reader.readAsText(file);
        });
    }

    async importStreams(streamDataList) {
        const results = [];
        for (const streamData of streamDataList) {
            try {
                const response = await fetch('/api/streams', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(streamData)
                });
                const result = await response.json();
                results.push({
                    name: streamData.name,
                    status: result.status,
                    message: result.message
                });
            } catch (error) {
                results.push({
                    name: streamData.name,
                    status: 'error',
                    message: error.message
                });
            }
        }
        return results;
    }

    // ... 更多方法实现
}

// 初始化
const streamManager = new StreamManager(); 
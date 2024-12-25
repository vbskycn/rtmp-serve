// 启动推流
async function startRtmpPush(streamId) {
    try {
        const response = await fetch(`/api/streams/${streamId}/start`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ rtmpPush: true })
        });
        
        if (!response.ok) {
            throw new Error('Network response was not ok');
        }

        const result = await response.json();
        if (!result.success) {
            throw new Error(result.error || '启动推流失败');
        }
        
        loadStreams();
        showToast('推流已启动');
    } catch (error) {
        console.error('Error starting RTMP push:', error);
        alert('启动推流失败: ' + error.message);
    }
}

// 停止流
async function stopStream(streamId) {
    try {
        const response = await fetch(`/api/streams/${streamId}/stop`, {
            method: 'POST'
        });
        const result = await response.json();
        if (result.success) {
            showToast('流已停止');
            loadStreams();
        } else {
            throw new Error(result.error || '停止失败');
        }
    } catch (error) {
        console.error('Error stopping stream:', error);
        alert('停止流失败: ' + error.message);
    }
}

// 删除流
async function deleteStream(streamId) {
    if (!confirm('确定要删除这个流吗？')) {
        return;
    }

    try {
        const response = await fetch(`/api/streams/${streamId}`, {
            method: 'DELETE'
        });
        const result = await response.json();
        if (result.success) {
            showToast('流已删除');
            loadStreams();
        } else {
            throw new Error(result.error || '删除失败');
        }
    } catch (error) {
        console.error('Error deleting stream:', error);
        alert('删除流失败: ' + error.message);
    }
}

// 编辑流
async function editStream(streamId) {
    try {
        const response = await fetch(`/api/streams/${streamId}`);
        const stream = await response.json();
        
        document.getElementById('editStreamId').value = streamId;
        document.getElementById('editStreamCategory').value = stream.category || '';
        document.getElementById('editStreamName').value = stream.name;
        document.getElementById('editStreamUrl').value = stream.url;
        
        const modal = new bootstrap.Modal(document.getElementById('editStreamModal'));
        modal.show();
    } catch (error) {
        console.error('Error loading stream details:', error);
        alert('加载流信息失败');
    }
}

// 批量启动推流
async function batchStartRtmpPush() {
    const selectedStreams = getSelectedStreams();
    if (!selectedStreams.length) {
        alert('请先选择要操作的流');
        return;
    }

    if (!confirm(`确定要启动选中的 ${selectedStreams.length} 个流吗？`)) return;

    const modal = showProgressModal('批量启动推流');
    let success = 0;
    let failed = 0;
    const errors = [];

    try {
        const batchSize = 4;
        for (let i = 0; i < selectedStreams.length; i += batchSize) {
            const batch = selectedStreams.slice(i, Math.min(i + batchSize, selectedStreams.length));
            await Promise.all(batch.map(async streamId => {
                try {
                    const response = await fetch(`/api/streams/${streamId}/start`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ rtmpPush: true })
                    });
                    const result = await response.json();
                    if (result.success) {
                        success++;
                    } else {
                        throw new Error(result.error || '启动失败');
                    }
                } catch (error) {
                    failed++;
                    errors.push(`${streamId}: ${error.message}`);
                }
                updateProgressModal(modal, { success, failed, total: selectedStreams.length });
            }));
            if (i + batchSize < selectedStreams.length) {
                await new Promise(resolve => setTimeout(resolve, 1500));
            }
        }
    } catch (error) {
        console.error('Batch start error:', error);
    } finally {
        setTimeout(() => {
            modal.remove();
            loadStreams();
            if (errors.length > 0) {
                alert(`批量启动完成\n成功: ${success}\n失败: ${failed}\n\n失败详情:\n${errors.join('\n')}`);
            } else {
                showToast(`批量启动完成: ${success}个成功`);
            }
        }, 1000);
    }
}

// 批量停止
async function batchStop() {
    const selectedStreams = getSelectedStreams();
    if (!selectedStreams.length) {
        alert('请先选择要操作的流');
        return;
    }

    if (!confirm(`确定要停止选中的 ${selectedStreams.length} 个流吗？`)) return;

    const modal = showProgressModal('批量停止');
    let success = 0;
    let failed = 0;
    const errors = [];

    try {
        const batchSize = 10;
        for (let i = 0; i < selectedStreams.length; i += batchSize) {
            const batch = selectedStreams.slice(i, Math.min(i + batchSize, selectedStreams.length));
            await Promise.all(batch.map(async streamId => {
                try {
                    const response = await fetch(`/api/streams/${streamId}/stop`, {
                        method: 'POST'
                    });
                    const result = await response.json();
                    if (result.success) {
                        success++;
                    } else {
                        throw new Error(result.error || '停止失败');
                    }
                } catch (error) {
                    failed++;
                    errors.push(`${streamId}: ${error.message}`);
                }
                updateProgressModal(modal, { success, failed, total: selectedStreams.length });
            }));
            if (i + batchSize < selectedStreams.length) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    } catch (error) {
        console.error('Batch stop error:', error);
    } finally {
        setTimeout(() => {
            modal.remove();
            loadStreams();
            if (errors.length > 0) {
                alert(`批量停止完成\n成功: ${success}\n失败: ${failed}\n\n失败详情:\n${errors.join('\n')}`);
            } else {
                showToast(`批量停止完成: ${success}个成功`);
            }
        }, 1000);
    }
}

// 批量删除
async function batchDelete() {
    const selectedStreams = getSelectedStreams();
    if (!selectedStreams.length) {
        alert('请先选择要操作的流');
        return;
    }

    if (!confirm(`确定要删除选中的 ${selectedStreams.length} 个流吗？此操作不可恢复！`)) return;

    const modal = showProgressModal('批量删除');
    let success = 0;
    let failed = 0;
    const errors = [];

    try {
        for (const streamId of selectedStreams) {
            try {
                const response = await fetch(`/api/streams/${streamId}`, {
                    method: 'DELETE'
                });
                const result = await response.json();
                if (result.success) {
                    success++;
                } else {
                    throw new Error(result.error || '删除失败');
                }
            } catch (error) {
                failed++;
                errors.push(`${streamId}: ${error.message}`);
            }
            updateProgressModal(modal, { success, failed, total: selectedStreams.length });
        }
    } catch (error) {
        console.error('Batch delete error:', error);
    } finally {
        setTimeout(() => {
            modal.remove();
            loadStreams();
            if (errors.length > 0) {
                alert(`批量删除完成\n成功: ${success}\n失败: ${failed}\n\n失败详情:\n${errors.join('\n')}`);
            } else {
                showToast(`批量删除完成: ${success}个成功`);
            }
        }, 1000);
    }
}

// 保存流编辑
async function saveStreamEdit() {
    const streamId = document.getElementById('editStreamId').value;
    const streamData = {
        category: document.getElementById('editStreamCategory').value,
        name: document.getElementById('editStreamName').value,
        url: document.getElementById('editStreamUrl').value
    };

    try {
        // 先停止流
        await stopStream(streamId);
        
        // 然后更新配置
        const response = await fetch(`/api/streams/${streamId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(streamData)
        });

        const result = await response.json();
        if (!result.success) {
            throw new Error(result.error);
        }

        // 关闭模态框
        const modal = bootstrap.Modal.getInstance(document.getElementById('editStreamModal'));
        modal.hide();
        
        // 刷新流列表
        loadStreams();
        showToast('更新成功');
    } catch (error) {
        console.error('Error updating stream:', error);
        alert('更新失败: ' + error.message);
    }
}

// 切换自动启动状态
async function toggleAutoStart(streamId, enable) {
    try {
        const response = await fetch(`/api/streams/${streamId}/auto-start`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ autoStart: enable })
        });

        const result = await response.json();
        if (!result.success) {
            throw new Error(result.error || '设置自动启动失败');
        }

        loadStreams();
        showToast(enable ? '已开启自动启动' : '已关闭自动启动');
    } catch (error) {
        console.error('Error toggling auto-start:', error);
        alert('设置自动启动失败: ' + error.message);
    }
}

// 更新流状态显示的函数
function updateStreamStatus(statusElement, stream) {
    let statusClass = '';
    let statusText = '';
    let statusStyle = '';
    
    switch (stream.status) {
        case 'error':
            statusClass = 'error';
            statusText = '错误: ' + (stream.lastError?.message || '未知错误');
            statusStyle = 'background-color: #dc3545;';
            break;
        case 'unhealthy':
            statusClass = 'warning';
            statusText = '异常';
            statusStyle = 'background-color: #ffc107; color: #000;';
            break;
        case 'running':
            if (stream.stats && stream.processRunning) {
                statusClass = 'active';
                statusText = '运行中';
                statusStyle = 'background-color: #28a745;';
            } else {
                statusClass = 'warning';
                statusText = '状态异常';
                statusStyle = 'background-color: #ffc107; color: #000;';
            }
            break;
        case 'stopped':
            statusClass = 'inactive';
            statusText = '已停止';
            statusStyle = 'background-color: #6c757d;';
            break;
        default:
            statusClass = 'error';
            statusText = '未知状态';
            statusStyle = 'background-color: #dc3545;';
    }
    
    statusElement.className = `status ${statusClass}`;
    statusElement.style = statusStyle;
    statusElement.textContent = statusText;
}

// 更新推流状态显示的函数
function updateRtmpStatus(rtmpElement, stream) {
    const isActive = stream.processRunning && stream.status === 'running' && !stream.lastError;
    
    rtmpElement.style.backgroundColor = isActive ? '#28a745' : '#6c757d';
    rtmpElement.textContent = isActive ? '已推流' : '未推流';
}

// 批量设置自动启动
async function batchAutoStart(enable) {
    const selectedStreams = getSelectedStreams();
    if (!selectedStreams.length) {
        alert('请先选择要操作的流');
        return;
    }

    if (!confirm(`确定要${enable ? '开启' : '关闭'}选中的 ${selectedStreams.length} 个流的自动启动吗？`)) return;

    const modal = showProgressModal(`批量${enable ? '开启' : '关闭'}自动启动`);
    let success = 0;
    let failed = 0;
    const errors = [];

    try {
        const response = await fetch('/api/streams/batch-auto-start', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                streamIds: selectedStreams,
                enable: enable
            })
        });

        const result = await response.json();
        if (result.success) {
            success = result.stats.success;
            failed = result.stats.total - result.stats.success;
        } else {
            throw new Error(result.error || '操作失败');
        }
    } catch (error) {
        console.error('Batch auto-start error:', error);
        failed = selectedStreams.length;
        errors.push(error.message);
    } finally {
        setTimeout(() => {
            modal.remove();
            loadStreams();
            if (errors.length > 0) {
                alert(`批量${enable ? '开启' : '关闭'}自动启动完成\n成功: ${success}\n失败: ${failed}\n\n失败详情:\n${errors.join('\n')}`);
            } else {
                showToast(`批量${enable ? '开启' : '关闭'}自动启动完成: ${success}个成功`);
            }
        }, 1000);
    }
} 
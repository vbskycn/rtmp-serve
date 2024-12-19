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
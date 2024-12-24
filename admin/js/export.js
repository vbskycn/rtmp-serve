// 导出M3U格式
async function exportM3U() {
    try {
        // 获取服务器配置
        const configResponse = await fetch('/api/config');
        const config = await configResponse.json();
        const serverHost = config.server.host;
        const serverPort = config.server.port;

        const response = await fetch('/api/streams');
        const streams = await response.json();
        
        let m3u = '#EXTM3U\n';
        streams.forEach(stream => {
            const playUrl = `http://${serverHost}:${serverPort}/play/${stream.id}`;
            m3u += `#EXTINF:-1 tvg-id="${stream.tvg?.id || ''}" tvg-name="${stream.tvg?.name || ''}" tvg-logo="${stream.tvg?.logo || ''}" group-title="${stream.category || '未分类'}",${stream.name}\n`;
            m3u += `${playUrl}\n`;
        });
        
        downloadFile(m3u, 'playlist.m3u');
    } catch (error) {
        console.error('Error exporting M3U:', error);
        alert('导出失败');
    }
}

// 导出TXT格式
async function exportTXT() {
    try {
        // 获取服务器配置
        const configResponse = await fetch('/api/config');
        const config = await configResponse.json();
        const serverHost = config.server.host;
        const serverPort = config.server.port;

        const response = await fetch('/api/streams');
        const streams = await response.json();
        
        let txt = '';
        let currentCategory = '';
        
        streams.forEach(stream => {
            if (stream.category !== currentCategory) {
                currentCategory = stream.category;
                txt += `${currentCategory},#genre#\n`;
            }
            const playUrl = `http://${serverHost}:${serverPort}/play/${stream.id}`;
            txt += `${stream.name},${playUrl}\n`;
        });
        
        downloadFile(txt, 'playlist.txt');
    } catch (error) {
        console.error('Error exporting TXT:', error);
        alert('导出失败');
    }
}

// 导出远程推流M3U
function exportRemoteM3U() {
    fetch('/api/streams')
        .then(response => response.json())
        .then(streams => {
            let content = '#EXTM3U\n';
            content += '#EXTM3U x-tvg-url="https://assets.livednow.com/epg.xml"\n\n';
            
            // 按分类分组
            const streamsByCategory = {};
            streams.filter(stream => stream.manuallyStarted).forEach(stream => {
                const category = stream.category || '未分类';
                if (!streamsByCategory[category]) {
                    streamsByCategory[category] = [];
                }
                streamsByCategory[category].push(stream);
            });

            // 生成分类内容
            for (const [category, categoryStreams] of Object.entries(streamsByCategory)) {
                categoryStreams.forEach(stream => {
                    const rtmpPlayUrl = `${serverConfig.rtmp.pullServer}${stream.id}.flv`;
                    const logoUrl = `https://assets.livednow.com/logo/${encodeURIComponent(stream.name)}.png`;
                    content += `#EXTINF:-1 tvg-id="${stream.name}" tvg-name="${stream.name}" tvg-logo="${logoUrl}" group-title="${category}", ${stream.name}\n`;
                    content += `${rtmpPlayUrl}\n\n`;
                });
            }
            
            downloadFile(content, 'remote_playlist.m3u');
        })
        .catch(error => {
            console.error('Error exporting remote M3U:', error);
            alert('导出远程推流M3U失败');
        });
}

// 导出远程推流TXT
function exportRemoteTXT() {
    fetch('/api/streams')
        .then(response => response.json())
        .then(streams => {
            let content = '';
            const rtmpStreams = streams.filter(stream => stream.manuallyStarted);
            
            // 按分类分组
            const streamsByCategory = {};
            rtmpStreams.forEach(stream => {
                const category = stream.category || '未分类';
                if (!streamsByCategory[category]) {
                    streamsByCategory[category] = [];
                }
                streamsByCategory[category].push(stream);
            });

            // 生成分类内容
            for (const [category, categoryStreams] of Object.entries(streamsByCategory)) {
                content += `${category},#genre#\n`;
                categoryStreams.forEach(stream => {
                    const rtmpPlayUrl = `${serverConfig.rtmp.pullServer}${stream.id}.flv`;
                    content += `${stream.name},${rtmpPlayUrl}\n`;
                });
                content += '\n';
            }
            
            downloadFile(content, 'remote_playlist.txt');
        })
        .catch(error => {
            console.error('Error exporting remote TXT:', error);
            alert('导出远程推流TXT失败');
        });
}

// 导出源地址
function exportSourceUrls() {
    fetch('/api/streams')
        .then(response => response.json())
        .then(streams => {
            let content = '';
            
            // 按分类分组
            const streamsByCategory = {};
            streams.forEach(stream => {
                const category = stream.category || '未分类';
                if (!streamsByCategory[category]) {
                    streamsByCategory[category] = [];
                }
                streamsByCategory[category].push(stream);
            });

            // 生成分类内容
            for (const [category, categoryStreams] of Object.entries(streamsByCategory)) {
                content += `${category},#genre#\n`;
                categoryStreams.forEach(stream => {
                    content += `${stream.name},${stream.url}\n`;
                });
                content += '\n';
            }
            
            downloadFile(content, 'source_urls.txt');
            showToast('源地址已导出');
        })
        .catch(error => {
            console.error('Error exporting source URLs:', error);
            alert('导出源地址失败');
        });
}

// 通用下载文件函数
function downloadFile(content, filename) {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    window.URL.revokeObjectURL(url);
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
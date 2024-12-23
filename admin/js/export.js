// 导出M3U格式
function exportM3U() {
    fetch('/api/streams')
        .then(response => response.json())
        .then(streams => {
            // M3U文件头
            let content = '#EXTM3U\n';
            content += '#EXTM3U x-tvg-url="https://assets.livednow.com/epg.xml"\n\n';
            
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
                categoryStreams.forEach(stream => {
                    const playUrl = `http://${serverConfig.server.host}:${serverConfig.server.port}/play/${stream.id}`;
                    const logoUrl = `https://assets.livednow.com/logo/${encodeURIComponent(stream.name)}.png`;
                    content += `#EXTINF:-1 tvg-id="${stream.name}" tvg-name="${stream.name}" tvg-logo="${logoUrl}" group-title="${category}", ${stream.name}\n`;
                    content += `${playUrl}\n\n`;
                });
            }
            
            downloadFile(content, 'playlist.m3u');
        })
        .catch(error => {
            console.error('Error exporting M3U:', error);
            alert('导出M3U失败');
        });
}

// 导出TXT格式
function exportTXT() {
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
                    const playUrl = `http://${serverConfig.server.host}:${serverConfig.server.port}/play/${stream.id}`;
                    content += `${stream.name},${playUrl}\n`;
                });
                content += '\n';
            }
            
            downloadFile(content, 'playlist.txt');
        })
        .catch(error => {
            console.error('Error exporting TXT:', error);
            alert('导出TXT失败');
        });
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
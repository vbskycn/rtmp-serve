// 图表配置
const chartConfig = {
    type: 'line',
    options: {
        responsive: true,
        animation: false,
        scales: {
            y: {
                beginAtZero: true,
                max: 100
            }
        }
    }
};

// 初始化图表数据
const cpuData = {
    labels: [],
    datasets: [{
        label: 'CPU使用率 (%)',
        data: [],
        borderColor: 'rgb(75, 192, 192)',
        tension: 0.1
    }]
};

const memoryData = {
    labels: [],
    datasets: [{
        label: '内存使用率 (%)',
        data: [],
        borderColor: 'rgb(255, 99, 132)',
        tension: 0.1
    }]
};

// 创建图表实例
const cpuChart = new Chart(
    document.getElementById('cpuChart'),
    {
        ...chartConfig,
        data: cpuData
    }
);

const memoryChart = new Chart(
    document.getElementById('memoryChart'),
    {
        ...chartConfig,
        data: memoryData
    }
);

// 更新图表数据
function updateCharts(stats) {
    const now = new Date().toLocaleTimeString();
    
    // 更新 CPU 图表
    cpuData.labels.push(now);
    cpuData.datasets[0].data.push(stats.cpu_percent);
    if (cpuData.labels.length > 20) {
        cpuData.labels.shift();
        cpuData.datasets[0].data.shift();
    }
    cpuChart.update();
    
    // 更新内存图表
    memoryData.labels.push(now);
    memoryData.datasets[0].data.push(stats.memory_percent);
    if (memoryData.labels.length > 20) {
        memoryData.labels.shift();
        memoryData.datasets[0].data.shift();
    }
    memoryChart.update();
}

// 定期获取系统状态并更新图表
setInterval(async () => {
    try {
        const response = await fetch('/api/stats');
        const stats = await response.json();
        updateCharts(stats);
        
        // 更新状态指标
        document.getElementById('cpuUsage').textContent = `${stats.cpu_percent.toFixed(1)}%`;
        document.getElementById('memoryUsage').textContent = `${stats.memory_percent.toFixed(1)}%`;
        document.getElementById('networkUsage').textContent = `${(stats.network_bytes_sent / 1024 / 1024).toFixed(1)} MB/s`;
    } catch (error) {
        console.error('Failed to update system stats:', error);
    }
}, 2000); 
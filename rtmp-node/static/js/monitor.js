class SystemMonitor {
    constructor() {
        this.baseUrl = '/api';
        this.updateInterval = 5000; // 5秒更新一次
        this.initMonitoring();
    }

    async initMonitoring() {
        await this.updateMetrics();
        setInterval(() => this.updateMetrics(), this.updateInterval);
    }

    async updateMetrics() {
        try {
            const response = await fetch(`${this.baseUrl}/system/metrics`);
            const metrics = await response.json();
            this.updateDisplay(metrics);
        } catch (error) {
            console.error('获取系统指标失败:', error);
        }
    }

    updateDisplay(metrics) {
        // 更新CPU使用率
        document.getElementById('cpuUsage').textContent = `${metrics.cpu.toFixed(1)}%`;
        
        // 更新内存使用率
        document.getElementById('memUsage').textContent = `${metrics.memory.toFixed(1)}%`;
        
        // 更新网络速度
        document.getElementById('netSpeed').textContent = formatSize(metrics.network.bytesPerSecond) + '/s';
        
        // 更新系统负载
        if (metrics.load) {
            document.getElementById('systemLoad').textContent = 
                `${metrics.load[0].toFixed(2)}, ${metrics.load[1].toFixed(2)}, ${metrics.load[2].toFixed(2)}`;
        }
    }
}

// 初始化系统监控
const systemMonitor = new SystemMonitor(); 
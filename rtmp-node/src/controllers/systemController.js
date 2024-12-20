const express = require('express');
const router = express.Router();
const os = require('os');

router.get('/metrics', async (req, res) => {
    try {
        const metrics = {
            cpu: await getCpuUsage(),
            memory: getMemoryUsage(),
            network: await getNetworkStats(),
            load: os.loadavg()
        };
        
        res.json(metrics);
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
});

async function getCpuUsage() {
    const startMeasure = os.cpus().map(cpu => ({
        idle: cpu.times.idle,
        total: Object.values(cpu.times).reduce((acc, tv) => acc + tv, 0)
    }));
    
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const endMeasure = os.cpus().map(cpu => ({
        idle: cpu.times.idle,
        total: Object.values(cpu.times).reduce((acc, tv) => acc + tv, 0)
    }));

    const cpuUsage = startMeasure.map((start, i) => {
        const end = endMeasure[i];
        const idle = end.idle - start.idle;
        const total = end.total - start.total;
        return (1 - idle / total) * 100;
    });

    return cpuUsage.reduce((acc, usage) => acc + usage, 0) / cpuUsage.length;
}

function getMemoryUsage() {
    const total = os.totalmem();
    const free = os.freemem();
    return ((total - free) / total) * 100;
}

async function getNetworkStats() {
    // 这里可以添加更详细的网络统计信息
    return {
        bytesPerSecond: 0 // 需要实现实际的网络监控逻辑
    };
}

module.exports = router; 
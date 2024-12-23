const express = require('express');
const app = express();
const port = 3001;

// 存储服务器状态
const servers = new Map();

app.use(express.json());

// 接收心跳
app.post('/heartbeat', (req, res) => {
    const serverInfo = req.body;
    servers.set(serverInfo.serverName, {
        ...serverInfo,
        lastHeartbeat: Date.now()
    });
    res.json({ success: true });
});

// 获取所有服务器状态
app.get('/servers', (req, res) => {
    const serverList = Array.from(servers.entries()).map(([name, info]) => ({
        ...info,
        isOnline: (Date.now() - info.lastHeartbeat) < 600000 // 10分钟内有心跳就认为在线
    }));
    res.json(serverList);
});

app.listen(port, () => {
    console.log(`Heartbeat server listening at http://localhost:${port}`);
}); 
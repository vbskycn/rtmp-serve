const path = require('path');
const fs = require('fs');

// 确保必要的目录存在
const dirs = ['logs', 'data'];
dirs.forEach(dir => {
    const dirPath = path.join(__dirname, dir);
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath);
    }
});

// 启动服务器
require('./src/server'); 
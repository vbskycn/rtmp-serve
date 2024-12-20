const db = require('../services/db');
const bcrypt = require('bcryptjs');

async function initializeSystem() {
    try {
        // 创建默认管理员用户
        const hashedPassword = await bcrypt.hash('admin123', 10);
        await db.addUser({
            username: 'admin',
            password: hashedPassword,
            role: 'admin'
        });

        // 创建默认转码配置
        await db.addConfig({
            name: '默认高清配置',
            videoCodec: 'h264',
            videoBitrate: '2500k',
            audioCodec: 'aac',
            audioBitrate: '128k',
            frameRate: 30
        });

        console.log('系统初始化完成');
        process.exit(0);
    } catch (error) {
        console.error('初始化失败:', error);
        process.exit(1);
    }
}

initializeSystem(); 
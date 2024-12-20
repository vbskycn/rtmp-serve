const db = require('../services/db');
const bcrypt = require('bcryptjs');
const logger = require('../services/logger');

async function initializeSystem() {
    try {
        logger.info('开始系统初始化...');

        // 等待数据库连接完成
        await new Promise(resolve => setTimeout(resolve, 1000));

        // 检查是否已存在管理员用户
        const existingAdmin = await db.getUser('admin');
        if (!existingAdmin) {
            // 创建默认管理员用户
            const hashedPassword = await bcrypt.hash('admin123', 10);
            await db.addUser({
                username: 'admin',
                password: hashedPassword,
                role: 'admin'
            });
            logger.info('创建管理员用户成功');
        }

        // 检查是否已存在默认配置
        const configs = await db.getAllConfigs();
        if (configs.length === 0) {
            // 创建默认转码配置
            await db.addConfig({
                name: '默认高清配置',
                videoCodec: 'h264',
                videoBitrate: '2500k',
                audioCodec: 'aac',
                audioBitrate: '128k',
                frameRate: 30
            });
            logger.info('创建默认配置成功');
        }

        logger.info('系统初始化完成');
        process.exit(0);
    } catch (error) {
        logger.error('初始化失败:', error);
        process.exit(1);
    }
}

// 添加错误处理
process.on('unhandledRejection', (error) => {
    logger.error('未处理的Promise拒绝:', error);
    process.exit(1);
});

initializeSystem(); 
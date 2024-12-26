const winston = require('winston');
const path = require('path');

// 创建日志格式
const logFormat = winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
);

// 创建 Winston logger
const logger = winston.createLogger({
    // 修改默认日志等级为 info，只输出重要信息
    level: process.env.NODE_ENV === 'production' ? 'warn' : 'info',
    format: logFormat,
    transports: [
        // 控制台输出
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            ),
            // 只输出 warn 以上级别的日志到控制台
            level: 'info'
        }),
        // 文件输出
        new winston.transports.File({
            filename: path.join(__dirname, '../../logs/error.log'),
            level: 'error',
            maxsize: 5242880, // 5MB
            maxFiles: 5
        }),
        new winston.transports.File({
            filename: path.join(__dirname, '../../logs/combined.log'),
            // 文件中记录 info 以上级别的日志
            level: 'info',
            maxsize: 5242880, // 5MB
            maxFiles: 5
        })
    ]
});

// 修改日志级别的使用建议
const debug = (...args) => {
    if (process.env.DEBUG) {
        logger.debug(...args);
    }
};

const info = (...args) => {
    // 过滤一些不必要的info日志
    const message = args[0];
    if (
        message.includes('Loading stream:') || 
        message.includes('Loaded stream IDs:') ||
        message.includes('Successfully parsed config')
    ) {
        debug(...args); // 降级为 debug
        return;
    }
    logger.info(...args);
};

const warn = (...args) => logger.warn(...args);
const error = (...args) => logger.error(...args);

module.exports = {
    debug,
    info,
    warn,
    error
}; 
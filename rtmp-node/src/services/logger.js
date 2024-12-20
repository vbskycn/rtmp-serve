const winston = require('winston');
const path = require('path');

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        // 错误日志
        new winston.transports.File({ 
            filename: path.join(__dirname, '../../logs/error.log'),
            level: 'error'
        }),
        // 所有日志
        new winston.transports.File({ 
            filename: path.join(__dirname, '../../logs/combined.log')
        })
    ]
});

// 开发环境下同时输出到控制台
if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
        )
    }));
}

module.exports = logger; 
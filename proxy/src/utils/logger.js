const winston = require('winston');
const path = require('path');

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.format.Console(),
        new winston.format.File({ 
            filename: path.join(__dirname, '../../logs/error.log'), 
            level: 'error' 
        }),
        new winston.format.File({ 
            filename: path.join(__dirname, '../../logs/combined.log') 
        })
    ]
});

module.exports = logger; 
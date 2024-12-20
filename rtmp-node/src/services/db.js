const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const logger = require('./logger');

class DatabaseService {
    constructor() {
        try {
            // 确保data目录存在
            const dataDir = path.join(__dirname, '../../data');
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
                logger.info('创建数据目录:', dataDir);
            }

            // 检查目录权限
            fs.accessSync(dataDir, fs.constants.R_OK | fs.constants.W_OK);
            logger.info('数据目录权限正常');

            this.dbPath = path.join(dataDir, 'streams.db');
            
            // 连接数据库
            this.db = new Database(this.dbPath, { 
                verbose: logger.info,
                fileMustExist: false
            });
            
            logger.info('数据库连接成功:', this.dbPath);
            
            // 启用外键约束
            this.db.pragma('foreign_keys = ON');
            
            // 初始化表
            this.init();
        } catch (err) {
            logger.error('数据库初始化失败:', err);
            throw err;
        }
    }

    init() {
        try {
            // 开启事务
            const initDb = this.db.transaction(() => {
                // 创建流表
                this.db.prepare(`
                    CREATE TABLE IF NOT EXISTS streams (
                        id TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        sourceUrl TEXT NOT NULL,
                        pushUrl TEXT NOT NULL,
                        configId TEXT,
                        status TEXT DEFAULT 'stopped',
                        createdAt INTEGER,
                        updatedAt INTEGER
                    )
                `).run();

                // 创建配置表
                this.db.prepare(`
                    CREATE TABLE IF NOT EXISTS configs (
                        id TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        videoCodec TEXT,
                        videoBitrate TEXT,
                        audioCodec TEXT,
                        audioBitrate TEXT,
                        frameRate INTEGER,
                        createdAt INTEGER
                    )
                `).run();

                // 创建用户表
                this.db.prepare(`
                    CREATE TABLE IF NOT EXISTS users (
                        id TEXT PRIMARY KEY,
                        username TEXT UNIQUE NOT NULL,
                        password TEXT NOT NULL,
                        role TEXT DEFAULT 'user',
                        createdAt INTEGER
                    )
                `).run();
            });

            // 执行事务
            initDb();
            
            logger.info('数据库表初始化完成');
        } catch (error) {
            logger.error('创建数据库表失败:', error);
            throw error;
        }
    }

    // 流相关方法
    getAllStreams() {
        return this.db.prepare('SELECT * FROM streams ORDER BY createdAt DESC').all();
    }

    getStream(id) {
        return this.db.prepare('SELECT * FROM streams WHERE id = ?').get(id);
    }

    addStream(data) {
        const now = Date.now();
        const id = `stream_${now}`;
        
        const stmt = this.db.prepare(`
            INSERT INTO streams (id, name, sourceUrl, pushUrl, configId, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        stmt.run(id, data.name, data.sourceUrl, data.pushUrl, data.configId, now, now);
        return { id, ...data, createdAt: now, updatedAt: now };
    }

    updateStreamStatus(id, status) {
        return this.db.prepare(`
            UPDATE streams SET status = ?, updatedAt = ? WHERE id = ?
        `).run(status, Date.now(), id);
    }

    deleteStream(id) {
        return this.db.prepare(`
            DELETE FROM streams WHERE id = ?
        `).run(id);
    }

    // 配置相关方法
    getAllConfigs() {
        return this.db.prepare('SELECT * FROM configs ORDER BY createdAt DESC').all();
    }

    addConfig(data) {
        const now = Date.now();
        const id = `config_${now}`;
        
        const stmt = this.db.prepare(`
            INSERT INTO configs (id, name, videoCodec, videoBitrate, audioCodec, audioBitrate, frameRate, createdAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);

        stmt.run(id, data.name, data.videoCodec, data.videoBitrate, data.audioCodec, data.audioBitrate, data.frameRate, now);
        return { id, ...data, createdAt: now };
    }

    deleteConfig(id) {
        return this.db.prepare(`
            DELETE FROM configs WHERE id = ?
        `).run(id);
    }

    // 用户相关方法
    getUser(username) {
        return this.db.prepare(`
            SELECT * FROM users WHERE username = ?
        `).get(username);
    }

    addUser(data) {
        const now = Date.now();
        const id = `user_${now}`;
        
        const stmt = this.db.prepare(`
            INSERT INTO users (id, username, password, role, createdAt)
            VALUES (?, ?, ?, ?, ?)
        `);

        stmt.run(id, data.username, data.password, data.role || 'user', now);
        return { id, ...data, createdAt: now };
    }
}

// 创建单例实例
let instance = null;

module.exports = (() => {
    if (!instance) {
        instance = new DatabaseService();
    }
    return instance;
})(); 
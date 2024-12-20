const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const logger = require('./logger');

class DatabaseService {
    constructor() {
        // 确保data目录存在
        const dataDir = path.join(__dirname, '../../data');
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        this.dbPath = path.join(dataDir, 'streams.db');
        
        // 设置数据库文件权限
        if (!fs.existsSync(this.dbPath)) {
            fs.writeFileSync(this.dbPath, '', { mode: 0o666 });
        }

        this.db = new sqlite3.Database(this.dbPath, (err) => {
            if (err) {
                logger.error('数据库连接失败:', err);
                throw err;
            }
            logger.info('数据库连接成功');
            this.init();
        });
    }

    init() {
        this.db.serialize(() => {
            // 创建流表
            this.db.run(`
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
            `, (err) => {
                if (err) logger.error('创建streams表失败:', err);
                else logger.info('streams表创建成功');
            });

            // 创建配置表
            this.db.run(`
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
            `, (err) => {
                if (err) logger.error('创建configs表失败:', err);
                else logger.info('configs表创建成功');
            });

            // 创建用户表
            this.db.run(`
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY,
                    username TEXT UNIQUE NOT NULL,
                    password TEXT NOT NULL,
                    role TEXT DEFAULT 'user',
                    createdAt INTEGER
                )
            `, (err) => {
                if (err) logger.error('创建users表失败:', err);
                else logger.info('users表创建成功');
            });
        });
    }

    // 流相关方法
    async getAllStreams() {
        return new Promise((resolve, reject) => {
            this.db.all('SELECT * FROM streams ORDER BY createdAt DESC', (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    async getStream(id) {
        return new Promise((resolve, reject) => {
            this.db.get('SELECT * FROM streams WHERE id = ?', [id], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    async addStream(data) {
        const now = Date.now();
        const id = `stream_${now}`;
        
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO streams (id, name, sourceUrl, pushUrl, configId, createdAt, updatedAt) 
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [id, data.name, data.sourceUrl, data.pushUrl, data.configId, now, now],
                (err) => {
                    if (err) reject(err);
                    else resolve({ id, ...data, createdAt: now, updatedAt: now });
                }
            );
        });
    }

    async updateStreamStatus(id, status) {
        return new Promise((resolve, reject) => {
            this.db.run(
                'UPDATE streams SET status = ?, updatedAt = ? WHERE id = ?',
                [status, Date.now(), id],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    }

    async deleteStream(id) {
        return new Promise((resolve, reject) => {
            this.db.run('DELETE FROM streams WHERE id = ?', [id], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    // 配置相关方法
    async getAllConfigs() {
        return new Promise((resolve, reject) => {
            this.db.all('SELECT * FROM configs ORDER BY createdAt DESC', (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    async addConfig(data) {
        const now = Date.now();
        const id = `config_${now}`;
        
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO configs (id, name, videoCodec, videoBitrate, audioCodec, audioBitrate, frameRate, createdAt)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [id, data.name, data.videoCodec, data.videoBitrate, data.audioCodec, data.audioBitrate, data.frameRate, now],
                (err) => {
                    if (err) reject(err);
                    else resolve({ id, ...data, createdAt: now });
                }
            );
        });
    }

    async deleteConfig(id) {
        return new Promise((resolve, reject) => {
            this.db.run('DELETE FROM configs WHERE id = ?', [id], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    // 用户相关方法
    async getUser(username) {
        return new Promise((resolve, reject) => {
            this.db.get('SELECT * FROM users WHERE username = ?', [username], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    async addUser(data) {
        const now = Date.now();
        const id = `user_${now}`;
        
        return new Promise((resolve, reject) => {
            this.db.run(
                'INSERT INTO users (id, username, password, role, createdAt) VALUES (?, ?, ?, ?, ?)',
                [id, data.username, data.password, data.role || 'user', now],
                (err) => {
                    if (err) reject(err);
                    else resolve({ id, ...data, createdAt: now });
                }
            );
        });
    }
}

module.exports = new DatabaseService(); 
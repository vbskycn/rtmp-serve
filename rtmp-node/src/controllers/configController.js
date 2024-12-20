const express = require('express');
const router = express.Router();
const db = require('../services/db');
const logger = require('../services/logger');

// 获取所有配置
router.get('/', async (req, res) => {
    try {
        const configs = await db.getAllConfigs();
        res.json({
            status: 'success',
            data: configs
        });
    } catch (error) {
        logger.error('获取配置列表失败:', error);
        res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
});

// 添加新配置
router.post('/', async (req, res) => {
    try {
        const configData = req.body;
        // 验证必要字段
        if (!configData.name) {
            throw new Error('配置名称不能为空');
        }

        const config = await db.addConfig(configData);
        logger.info('添加新配置:', config.name);
        
        res.json({
            status: 'success',
            data: config
        });
    } catch (error) {
        logger.error('添加配置失败:', error);
        res.status(400).json({
            status: 'error',
            message: error.message
        });
    }
});

// 更新配置
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const configData = req.body;
        
        await db.updateConfig(id, configData);
        logger.info('更新配置:', id);
        
        res.json({
            status: 'success',
            message: '配置已更新'
        });
    } catch (error) {
        logger.error('更新配置失败:', error);
        res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
});

// 删除配置
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await db.deleteConfig(id);
        logger.info('删除配置:', id);
        
        res.json({
            status: 'success',
            message: '配置已删除'
        });
    } catch (error) {
        logger.error('删除配置失败:', error);
        res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
});

module.exports = router; 
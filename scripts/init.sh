#!/bin/bash

# 创建必要的目录
mkdir -p data/sessions logs

# 设置目录权限
chmod 755 data data/sessions logs
chmod 644 data/streams.db 2>/dev/null || true

# 初始化数据库
python scripts/init_db.py

# 创建日志文件
touch logs/stream_server.log
chmod 644 logs/stream_server.log

echo "初始化完成！" 
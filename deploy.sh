#!/bin/bash

# 停止现有容器
docker-compose down

# 清理旧的构建缓存
docker-compose build --no-cache

# 启动服务
docker-compose up -d

# 查看日志
docker-compose logs -f 
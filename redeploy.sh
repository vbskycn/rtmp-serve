#!/bin/bash

echo "停止现有服务..."
docker-compose down

echo "重新构建镜像..."
docker-compose build --no-cache

echo "启动服务..."
docker-compose up -d

echo "服务已重新部署，访问 http://localhost:10088 查看管理界面" 
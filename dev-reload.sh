#!/bin/bash

# 检查参数
if [ "$1" = "--build" ]; then
    echo "重新构建镜像..."
    docker-compose build --no-cache
    docker-compose up -d
else
    echo "重启服务..."
    docker-compose restart rtmp-server
fi

echo "查看日志..."
docker-compose logs -f rtmp-server 
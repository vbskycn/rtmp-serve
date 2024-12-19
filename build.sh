#!/bin/bash

# 启用 BuildKit
export DOCKER_BUILDKIT=1
export COMPOSE_DOCKER_CLI_BUILD=1

# 构建多架构镜像
docker buildx create --use
docker buildx build --platform linux/amd64,linux/arm64 \
    -t your-registry/rtmp-server:latest \
    --push \
    . 
# 流媒体管理系统

## 构建和发布

### 1. 准备工作

```bash
# 登录到 Docker Hub
docker login

# 设置并启用 buildx 构建器
docker buildx create --name mybuilder --use
docker buildx inspect --bootstrap
```

### 2. 构建多架构镜像

```bash
# 构建并推送 latest 版本
docker buildx build --platform linux/amd64,linux/arm64 \
  -t zhoujie218/rtmp-serve:latest \
  --push .
  
# 构建并推送指定版本(同时更新 latest)
docker buildx build --platform linux/amd64,linux/arm64 \
  --build-arg VERSION=1.5.4 \
  -t zhoujie218/rtmp-serve:1.5.4 \
  -t zhoujie218/rtmp-serve:latest \
  --push .
```

## 部署说明

### 方式一：直接运行容器

```bash
# 拉取镜像
docker pull zhoujie218/rtmp-serve:latest

# 运行容器(持久化存储)
docker run -d \
  --name rtmp-serve \
  --restart unless-stopped \
  -p 3000:3000 \
  -v $(pwd)/config:/app/config \
  -v $(pwd)/streams:/app/streams \
  -v $(pwd)/logs:/app/logs \
  -e NODE_ENV=production \
  -e TZ=Asia/Shanghai \
  zhoujie218/rtmp-serve:latest

# 运行容器(无持久化)
docker run -d \
  --name rtmp-serve \
  --restart unless-stopped \
  -p 3000:3000 \
  -e NODE_ENV=production \
  -e TZ=Asia/Shanghai \
  zhoujie218/rtmp-serve:latest
  
# 自己用端
docker run -d \
  --name rtmp-serve \
  --restart unless-stopped \
  -p 3009:3000 \
  -e NODE_ENV=production \
  -e TZ=Asia/Shanghai \
  zhoujie218/rtmp-serve:latest
  
```

### 方式二：使用脚本部署

```bash
# 1. 克隆代码
git clone https://github.com/vbskycn/rtmp-serve.git

# 2. 进入目录
cd rtmp-serve

# 3. 赋予启动脚本执行权限
chmod +x start.sh

# 4. 运行启动脚本
./start.sh
```

## 容器管理

```bash
# 停止并删除容器
docker stop rtmp-serve
docker rm rtmp-serve

# 查看容器日志
docker logs rtmp-serve

# 进入容器
docker exec -it rtmp-serve sh
```

## 访问地址

- 管理界面: `http://your-ip:3000/admin`
- 监控页面: `http://your-ip:3000/monitor.html`
- 统计页面

  ```
  http://47.243.164.1:3000/monitor.html
  ```

  

## 注意事项

1. 确保已安装 Docker 并启用了 buildx 功能
2. 多架构构建可能需要较长时间，请耐心等待
3. 生产环境建议使用持久化存储方式运行容器
4. 请妥善保管 Docker Hub 的访问凭证
5. 建议定期备份配置文件

## 版本历史

- v1.5.4: 最新版本
- v1.5.3: 稳定版本

## 技术支持

- 邮箱：zhoujie218@gmail.com
- GitHub：https://github.com/vbskycn/rtmp-serve

# 使用 Node.js 官方多架构基础镜像
FROM node:18-alpine

# 设置版本号参数
ARG VERSION=latest

# 设置工作目录
WORKDIR /app

# 安装必要的系统依赖
RUN apk add --no-cache \
    ffmpeg \
    tzdata \
    && cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime \
    && echo "Asia/Shanghai" > /etc/timezone \
    && apk del tzdata

# 安装 PM2
RUN npm install pm2 -g

# 复制 package.json 和 package-lock.json
COPY package*.json ./

# 安装依赖
RUN npm install --production

# 复制源代码
COPY . .

# 更新配置文件中的版本号
RUN sed -i "s/\"version\": \".*\"/\"version\": \"$VERSION\"/" /app/config/config.json

# 创建必要的目录
RUN mkdir -p streams config logs

# 设置权限
RUN chmod -R 755 /app

# 设置环境变量
ENV APP_VERSION=$VERSION

# 暴露端口
EXPOSE 3000

# 使用 PM2 启动应用
CMD ["pm2-runtime", "start", "ecosystem.config.js"]

# 添加标签
LABEL version=$VERSION \
      maintainer="zhou jie <zhoujie218@gmail.com>" \
      description="流媒体管理系统"
  
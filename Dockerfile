# 使用多平台基础镜像
FROM --platform=$TARGETPLATFORM python:3.8-slim

# 设置构建参数
ARG TARGETPLATFORM
ARG BUILDPLATFORM

# 安装系统依赖（根据架构选择不同的包）
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libpq-dev \
    gcc \
    python3-dev \
    curl \
    procps \
    vim \
    && if [ "$TARGETPLATFORM" = "linux/arm64" ]; then \
       apt-get install -y --no-install-recommends \
       libnss3 \
       ; fi \
    && rm -rf /var/lib/apt/lists/*

# 设置工作目录
WORKDIR /app

# 复制项目文件
COPY . .

# 创建必要的目录
RUN mkdir -p data/sessions logs

# 安装 Python 依赖
RUN pip install --no-cache-dir -r requirements.txt

# 安装调试工具
RUN pip install --no-cache-dir flask-debugtoolbar

# 设置数据目录权限
RUN chmod -R 777 /app/data /app/logs

# 设置环境变量
ENV PYTHONPATH=/app
ENV FLASK_APP=backend.app
ENV FLASK_ENV=development
ENV FLASK_DEBUG=1

# 启动命令
CMD ["python", "-m", "flask", "run", "--host=0.0.0.0", "--port=5000"] 
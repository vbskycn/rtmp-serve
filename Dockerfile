# 使用多平台基础镜像
FROM --platform=$TARGETPLATFORM python:3.8-slim

# 设置构建参数
ARG TARGETPLATFORM
ARG BUILDPLATFORM

# 安装系统依赖
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

# 先复制依赖文件
COPY requirements.txt .

# 安装 Python 依赖
RUN pip install --no-cache-dir -r requirements.txt

# 安装调试工具
RUN pip install --no-cache-dir flask-debugtoolbar

# 复制项目文件
COPY backend/ backend/
COPY conf/ conf/

# 创建必要的目录
RUN mkdir -p data/sessions logs

# 设置数据目录权限
RUN chmod -R 777 data logs

# 设置环境变量
ENV PYTHONPATH=/app
ENV FLASK_APP=backend/app.py
ENV FLASK_ENV=development
ENV FLASK_DEBUG=1

# 启动命令
CMD ["flask", "run", "--host=0.0.0.0", "--port=10088"] 
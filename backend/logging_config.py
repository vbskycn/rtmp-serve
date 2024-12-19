import logging
import os

def setup_logging():
    # 创建日志目录
    os.makedirs('logs', exist_ok=True)
    
    # 配置日志格式
    logging.basicConfig(
        level=logging.DEBUG,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        handlers=[
            logging.FileHandler('logs/stream_server.log'),
            logging.StreamHandler()
        ]
    ) 
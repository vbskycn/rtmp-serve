import logging
import os

def setup_logging():
    # 确保日志目录存在
    log_dir = '/app/logs'
    if not os.path.exists(log_dir):
        try:
            os.makedirs(log_dir, exist_ok=True)
        except Exception as e:
            print(f"Warning: Could not create log directory: {e}")
            # 如果无法创建目录，使用标准输出
            logging.basicConfig(
                level=logging.INFO,
                format='%(asctime)s %(levelname)s %(message)s'
            )
            return

    log_file = os.path.join(log_dir, 'stream_server.log')
    
    try:
        # 配置日志处理器
        handlers = [
            logging.StreamHandler(),  # 标准输出
        ]
        
        # 只有在有写权限时才添加文件处理器
        try:
            # 尝试创建或追加到日志文件
            with open(log_file, 'a') as f:
                pass
            handlers.append(logging.FileHandler(log_file))
        except (IOError, PermissionError) as e:
            print(f"Warning: Could not open log file: {e}")
            
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s %(levelname)s %(message)s',
            handlers=handlers
        )
    except Exception as e:
        print(f"Error setting up logging: {e}")
        # 如果出错，使用基本配置
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s %(levelname)s %(message)s'
        ) 
from flask import Flask, request, jsonify, send_from_directory, redirect, url_for
from flask_cors import CORS
import subprocess
import json
import logging
import time
from datetime import datetime, timedelta
from dotenv import load_dotenv
import os
from backend.models import Session, Stream
import psutil
from functools import wraps
from flask import session
from backend.logging_config import setup_logging
import secrets
from functools import lru_cache
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

app = Flask(__name__)
CORS(app)
load_dotenv()  # 加载 .env 文件中的环境变量

# 设置日志
setup_logging()

# 添加配置
REMOTE_RTMP_URL = 'rtmp://ali.push.yximgs.com/live/'
LOCAL_RTMP_URL = 'rtmp://localhost:1935/live/'  # SRS 默认地址
REMOTE_PULL_URL = 'http://ali.hlspull.yximgs.com/live/'
LOCAL_PULL_URL = 'http://localhost:8080/live/'  # SRS 默认 HTTP-FLV 地址

# 修改会话配置部分
app.config.update(
    SECRET_KEY=secrets.token_hex(16),
    PERMANENT_SESSION_LIFETIME=timedelta(days=7),
    SESSION_COOKIE_SECURE=False,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_NAME='rtmp_session',  # 自定义会话cookie名称
    SESSION_TYPE='filesystem',  # 使用文件系统存储会话
    SESSION_FILE_DIR='data/sessions',  # 会话文件存储目录
    SESSION_FILE_THRESHOLD=500  # 会话文件数量阈值
)

limiter = Limiter(
    app=app,
    key_func=get_remote_address,
    default_limits=["200 per day", "50 per hour"]
)

class StreamManager:
    def __init__(self):
        self.streams = {}
        self.session = Session()
        self._cache = {}
        self._cache_timeout = 300  # 5分钟缓存
        
        self.start_health_check_thread()
        
    @lru_cache(maxsize=100)
    def get_stream_config(self, stream_id):
        """获取流配置（使用LRU缓存）"""
        return self.session.query(Stream).filter_by(id=stream_id).first()
        
    def _cache_stream_status(self, stream_id, status):
        """缓存流状态"""
        self._cache[f"status_{stream_id}"] = {
            'data': status,
            'timestamp': datetime.now()
        }
        
    def _get_cached_status(self, stream_id):
        """获取缓存的状态"""
        cache_data = self._cache.get(f"status_{stream_id}")
        if not cache_data:
            return None
            
        if datetime.now() - cache_data['timestamp'] > timedelta(seconds=self._cache_timeout):
            del self._cache[f"status_{stream_id}"]
            return None
            
        return cache_data['data']
        
    def add_stream(self, stream_data):
        stream_id = stream_data['id']
        try:
            # 保存到数据库
            stream = Stream(
                id=stream_id,
                name=stream_data.get('name', ''),
                source_url=stream_data['sourceUrl'],
                output_url=stream_data.get('outputUrl', LOCAL_RTMP_URL),
                key=stream_data['key'],
                video_codec=stream_data.get('videoCodec', 'copy'),
                video_bitrate=stream_data.get('videoBitrate', ''),
                audio_codec=stream_data.get('audioCodec', 'aac'),
                audio_bitrate=stream_data.get('audioBitrate', '128k')
            )
            self.session.add(stream)
            self.session.commit()
            
            # 构建 ffmpeg 命令
            command = [
                'ffmpeg',
                '-y',  # 覆盖输出文件
                '-v', 'warning',  # 只显示警告和错误
                '-i', stream_data['sourceUrl'],
                '-c:v', stream_data.get('videoCodec', 'copy'),
            ]
            
            # 如果不是直接复制视频流，添加视频参数
            if stream_data.get('videoCodec') != 'copy':
                if 'videoSize' in stream_data and stream_data['videoSize'] != 'copy':
                    command.extend(['-s', stream_data['videoSize']])
                if 'videoBitrate' in stream_data:
                    command.extend(['-b:v', stream_data['videoBitrate']])
                if 'framerate' in stream_data and stream_data['framerate'] != 'copy':
                    command.extend(['-r', stream_data['framerate']])
                if 'gopSize' in stream_data:
                    command.extend(['-g', stream_data['gopSize']])
            
            # 音频参数
            command.extend([
                '-c:a', stream_data.get('audioCodec', 'aac'),
                '-b:a', stream_data.get('audioBitrate', '128k'),
            ])
            
            # 添加输出格式和地址
            output_url = stream_data.get('outputUrl', LOCAL_RTMP_URL).strip() or LOCAL_RTMP_URL
            command.extend([
                '-f', 'flv',
                f"{output_url}{stream_data['key']}"
            ])
            
            logging.info(f"Starting stream {stream_id} with command: {' '.join(command)}")
            
            process = subprocess.Popen(
                command,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                bufsize=1,
                universal_newlines=True
            )
            
            # 等待一小段时间检查进程是否正常启动
            time.sleep(2)
            if process.poll() is not None:
                error_output = process.stderr.read()
                logging.error(f"Stream {stream_id} failed to start: {error_output}")
                return False
            
            self.streams[stream_id] = {
                'process': process,
                'start_time': datetime.now(),
                'config': stream_data,
                'status': 'running'
            }
            
            logging.info(f"Stream {stream_id} started successfully")
            return True
            
        except Exception as e:
            logging.error(f"Error starting stream {stream_id}: {str(e)}", exc_info=True)
            return False
            
    def stop_stream(self, stream_id):
        if stream_id in self.streams:
            try:
                # 获取进程
                process = self.streams[stream_id]['process']
                
                # 先尝试正常终止
                process.terminate()
                try:
                    process.wait(timeout=5)  # 等待进程结束
                except subprocess.TimeoutExpired:
                    # 如果超时，强��结束
                    process.kill()
                    process.wait()
                
                # 从数据库中标记为非活动
                stream = self.session.query(Stream).filter_by(id=stream_id).first()
                if stream:
                    stream.is_active = False
                    self.session.commit()
                
                # 从内存中删除
                del self.streams[stream_id]
                
                logging.info(f"Stream {stream_id} stopped successfully")
                return True
            except Exception as e:
                logging.error(f"Error stopping stream {stream_id}: {str(e)}", exc_info=True)
                return False
        return False
        
    def get_stream_status(self, stream_id):
        if stream_id in self.streams:
            stream = self.streams[stream_id]
            process = stream['process']
            
            try:
                # 检查进程是否还在运行
                if process.poll() is None:
                    # 进程正在运行，检查输出
                    try:
                        stderr_output = process.stderr.read1(1024).decode('utf-8', errors='ignore')
                        if stderr_output:
                            logging.warning(f"Stream {stream_id} stderr: {stderr_output}")
                    except Exception as e:
                        logging.error(f"Error reading stderr for stream {stream_id}: {str(e)}")
                        stderr_output = ""

                    # 检查 ffmpeg 进程是否真的在推流
                    try:
                        ps_process = subprocess.run(['ps', '-p', str(process.pid), '-o', 'cmd='], 
                                                 capture_output=True, text=True)
                        if 'ffmpeg' in ps_process.stdout:
                            return {
                                'status': 'running',
                                'uptime': str(datetime.now() - stream['start_time']),
                                'config': stream['config'],
                                'details': {
                                    'pid': process.pid,
                                    'command': ps_process.stdout.strip(),
                                    'last_error': stderr_output if stderr_output else None
                                }
                            }
                    except Exception as e:
                        logging.error(f"Error checking process for stream {stream_id}: {str(e)}")
                
                # 如果进程不在运行或检查失败，尝试重启
                logging.warning(f"Stream {stream_id} is not running, attempting restart...")
                if self.restart_stream(stream_id):
                    return {
                        'status': 'restarting',
                        'message': '流已重启',
                        'config': stream['config']
                    }
                else:
                    return {
                        'status': 'error',
                        'message': '流已停止且重启失败',
                        'config': stream['config']
                    }
                
            except Exception as e:
                logging.error(f"Error checking stream {stream_id} status: {str(e)}", exc_info=True)
                return {
                    'status': 'error',
                    'error_message': str(e),
                    'config': stream['config']
                }
        return None
        
    def get_all_streams(self):
        return self.session.query(Stream).all()
        
    def update_stream(self, stream_id, stream_data):
        try:
            # 先停止现有的流
            self.stop_stream(stream_id)
            
            # 更新数据库中的记录
            stream = self.session.query(Stream).filter_by(id=stream_id).first()
            if stream:
                stream.name = stream_data.get('name', stream.name)
                stream.source_url = stream_data.get('sourceUrl', stream.source_url)
                stream.output_url = stream_data.get('outputUrl', stream.output_url)
                stream.key = stream_data.get('key', stream.key)
                stream.video_codec = stream_data.get('videoCodec', stream.video_codec)
                stream.video_bitrate = stream_data.get('videoBitrate', stream.video_bitrate)
                stream.audio_codec = stream_data.get('audioCodec', stream.audio_codec)
                stream.audio_bitrate = stream_data.get('audioBitrate', stream.audio_bitrate)
                self.session.commit()
                
                # 使用新的配置重新启动流
                return self.add_stream(stream_data)
            return False
        except Exception as e:
            logging.error(f"Error updating stream {stream_id}: {str(e)}", exc_info=True)
            return False

    def check_stream_health(self, stream_id):
        if stream_id in self.streams:
            stream = self.streams[stream_id]
            process = stream['process']
            
            # 检查进程状态
            if process.poll() is not None:
                return {
                    'status': 'error',
                    'message': '流已停止',
                    'error': process.stderr.read().decode() if process.stderr else None
                }
            
            # 检查输出帧率
            try:
                ffprobe_cmd = [
                    'ffprobe',
                    '-v', 'quiet',
                    '-print_format', 'json',
                    '-show_streams',
                    stream['config']['outputUrl'] + stream['config']['key']
                ]
                result = subprocess.run(ffprobe_cmd, capture_output=True, text=True)
                data = json.loads(result.stdout)
                return {
                    'status': 'healthy',
                    'details': data
                }
            except Exception as e:
                return {
                    'status': 'warning',
                    'message': '无法获取流信息',
                    'error': str(e)
                }
        
    def add_stream_with_retry(self, stream_data, max_retries=3):
        for attempt in range(max_retries):
            try:
                if self.add_stream(stream_data):
                    return True
                time.sleep(2 ** attempt)  # 指数退避
            except Exception as e:
                logging.error(f"Attempt {attempt + 1} failed: {str(e)}")
                if attempt == max_retries - 1:
                    raise
        return False

    def get_system_stats(self):
        stats = {
            'cpu_usage': psutil.cpu_percent(),
            'memory_usage': psutil.virtual_memory().percent,
            'disk_usage': psutil.disk_usage('/').percent,
            'active_streams': len(self.streams),
            'network': {
                'bytes_sent': psutil.net_io_counters().bytes_sent,
                'bytes_recv': psutil.net_io_counters().bytes_recv
            }
        }
        return stats

    def restart_stream(self, stream_id):
        """重启指定的流"""
        if stream_id in self.streams:
            try:
                # 停止现有进程
                old_process = self.streams[stream_id]['process']
                old_process.terminate()
                try:
                    old_process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    old_process.kill()
                
                # 使用原有配置重新启动
                config = self.streams[stream_id]['config']
                return self.add_stream(config)
            except Exception as e:
                logging.error(f"Error restarting stream {stream_id}: {str(e)}", exc_info=True)
                return False
        return False

    def get_stream_metrics(self, stream_id):
        """获取流的详细指标"""
        if stream_id not in self.streams:
            raise StreamNotFoundError()
            
        stream = self.streams[stream_id]
        process = stream['process']
        
        try:
            # 获取进程资源使用情况
            process_info = psutil.Process(process.pid)
            
            return {
                'cpu_percent': process_info.cpu_percent(),
                'memory_percent': process_info.memory_percent(),
                'io_counters': process_info.io_counters()._asdict(),
                'uptime': str(datetime.now() - stream['start_time']),
                'frame_stats': self._get_frame_stats(stream),
                'network_stats': self._get_network_stats(stream)
            }
        except Exception as e:
            logging.error(f"Error getting metrics for stream {stream_id}: {str(e)}")
            raise StreamOperationError(f"获取流指标失败: {str(e)}")
            
    def _get_frame_stats(self, stream):
        """获取帧统计信息"""
        try:
            ffprobe_cmd = [
                'ffprobe',
                '-v', 'quiet',
                '-print_format', 'json',
                '-show_frames',
                '-read_intervals', '%+5',  # 只读取前5秒
                stream['config']['outputUrl'] + stream['config']['key']
            ]
            result = subprocess.run(ffprobe_cmd, capture_output=True, text=True)
            return json.loads(result.stdout)
        except Exception:
            return None

    def start_health_check_thread(self):
        """启动健康检查线程"""
        import threading
        
        def health_check_loop():
            while True:
                try:
                    self.check_all_streams_health()
                    time.sleep(30)  # 每30秒检查一次
                except Exception as e:
                    logging.error(f"Health check error: {str(e)}")
                    
        thread = threading.Thread(target=health_check_loop, daemon=True)
        thread.start()
        
    def check_all_streams_health(self):
        """检查所有流的健康状态"""
        for stream_id in list(self.streams.keys()):
            try:
                status = self.get_stream_status(stream_id)
                if status['status'] == 'error':
                    logging.warning(f"Stream {stream_id} is unhealthy, attempting restart")
                    self.restart_stream(stream_id)
            except Exception as e:
                logging.error(f"Error checking stream {stream_id}: {str(e)}")

stream_manager = StreamManager()

# 登录装饰器
def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not session.get('logged_in'):
            return redirect('/login')
        return f(*args, **kwargs)
    return decorated_function

# 登录路由
@app.route('/login')
def login_page():
    if session.get('logged_in'):
        return redirect('/')
    return send_from_directory('static', 'login.html')

@app.route('/api/login', methods=['POST'])
def login():
    data = request.json
    username = data.get('username')
    password = data.get('password')
    
    if username == 'admin' and password == 'admin':
        session.permanent = True  # 设置为永久会话
        session['logged_in'] = True
        session['username'] = username
        return jsonify({'status': 'success', 'message': '登录成功'})
    return jsonify({'status': 'error', 'message': '用户名或密码错误'})

@app.route('/api/logout')
def logout():
    session.clear()
    return redirect('/login')

# 修改主页路由，添加登录验证
@app.route('/')
@login_required
def index():
    return send_from_directory('static', 'index.html')

@app.route('/api/streams', methods=['POST'])
@limiter.limit("20 per minute")  # 限制每分钟最多20个请求
@login_required
def add_stream():
    data = request.json
    if stream_manager.add_stream(data):
        return jsonify({'status': 'success', 'message': '推流已启动'})
    return jsonify({'status': 'error', 'message': '启动推流失败'})

# 添加自定义异常类
class StreamError(Exception):
    pass

class StreamNotFoundError(StreamError):
    pass

class StreamOperationError(StreamError):
    pass

# 优化错误处理装饰器
def handle_stream_errors(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        try:
            return f(*args, **kwargs)
        except StreamNotFoundError:
            return jsonify({
                'status': 'error',
                'code': 'STREAM_NOT_FOUND',
                'message': '未找到指定的流'
            }), 404
        except StreamOperationError as e:
            return jsonify({
                'status': 'error',
                'code': 'OPERATION_FAILED',
                'message': str(e)
            }), 400
        except Exception as e:
            logging.error(f"Unexpected error: {str(e)}", exc_info=True)
            return jsonify({
                'status': 'error',
                'code': 'INTERNAL_ERROR',
                'message': '服务器内部错误'
            }), 500
    return decorated_function

@app.route('/api/streams/<stream_id>', methods=['DELETE'])
@login_required
@handle_stream_errors
def stop_stream(stream_id):
    if not stream_manager.stop_stream(stream_id):
        raise StreamOperationError('停止推流失败')
    return jsonify({'status': 'success', 'message': '推流已停止'})

@app.route('/api/streams/<stream_id>/status', methods=['GET'])
def get_stream_status(stream_id):
    status = stream_manager.get_stream_status(stream_id)
    if status:
        return jsonify(status)
    return jsonify({'status': 'error', 'message': '未找到该推流'})

@app.route('/api/streams/batch', methods=['POST'])
def batch_import():
    try:
        streams = request.json
        results = []
        for stream in streams:
            success = stream_manager.add_stream(stream)
            results.append({
                'id': stream['id'],
                'status': 'success' if success else 'error'
            })
        return jsonify({'status': 'success', 'results': results})
    except Exception as e:
        logging.error(f"Batch import error: {str(e)}")
        return jsonify({'status': 'error', 'message': str(e)})

@app.route('/api/streams', methods=['GET'])
def get_streams():
    streams = stream_manager.get_all_streams()
    return jsonify([stream.to_dict() for stream in streams])

@app.route('/api/streams/<stream_id>', methods=['PUT'])
def update_stream(stream_id):
    try:
        data = request.json
        if stream_manager.update_stream(stream_id, data):
            return jsonify({'status': 'success', 'message': '更新成功'})
        return jsonify({'status': 'error', 'message': '更新失败：流不存在或更新出错'})
    except Exception as e:
        logging.error(f"Error in update_stream endpoint: {str(e)}", exc_info=True)
        return jsonify({'status': 'error', 'message': f'更新失败：{str(e)}'})

@app.errorhandler(Exception)
def handle_error(error):
    logging.error(f"Unexpected error: {str(error)}", exc_info=True)
    return jsonify({
        'status': 'error',
        'message': str(error),
        'type': error.__class__.__name__
    }), 500

@app.before_request
def log_request():
    logging.info(f"Request: {request.method} {request.url}")

@app.after_request
def log_response(response):
    logging.info(f"Response: {response.status}")
    return response

@app.route('/api/stats')
def get_stats():
    return jsonify(stream_manager.get_system_stats())

@app.route('/help')
@login_required
def help_page():
    return send_from_directory('static', 'help.html')

if __name__ == '__main__':
    port = int(os.getenv('PORT', 5000))
    host = os.getenv('HOST', '0.0.0.0')
    app.run(host=host, port=port, debug=os.getenv('DEBUG', 'False').lower() == 'true') 
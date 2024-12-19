from flask import Flask, request, jsonify, send_from_directory, redirect, url_for
from flask_cors import CORS
import subprocess
import json
import logging
import time
from datetime import datetime, timedelta
from dotenv import load_dotenv
import os
from backend.models import Session, Stream, User, Base, engine
import psutil
from functools import wraps, lru_cache
from flask import session
from backend.logging_config import setup_logging
import secrets
from backend.config import Config

# 确保数据库和表已创建
Base.metadata.create_all(engine)

app = Flask(__name__)
CORS(app)
load_dotenv()  # 加载 .env 文件中的环境变量

# 设置日志
setup_logging()

# 添加配置
REMOTE_RTMP_URL = os.getenv('REMOTE_RTMP_URL', 'rtmp://ali.push.yximgs.com/live/')
LOCAL_RTMP_URL = os.getenv('LOCAL_RTMP_URL', 'rtmp://localhost:1935/live/')
REMOTE_PULL_URL = os.getenv('REMOTE_PULL_URL', 'http://ali.hlspull.yximgs.com/live/')
LOCAL_PULL_URL = os.getenv('LOCAL_PULL_URL', 'http://localhost:8080/live/')

# 确保会话目录存在
session_dir = '/app/data/sessions'
if not os.path.exists(session_dir):
    os.makedirs(session_dir, exist_ok=True)

# 修改会话配置
app.config.update(
    SECRET_KEY=os.getenv('SECRET_KEY', secrets.token_hex(16)),
    PERMANENT_SESSION_LIFETIME=timedelta(days=7),
    SESSION_COOKIE_SECURE=False,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_NAME='rtmp_session',
    SESSION_TYPE='filesystem',
    SESSION_FILE_DIR=session_dir,
    SESSION_FILE_THRESHOLD=500,
    SESSION_REFRESH_EACH_REQUEST=True
)

# 登录验证装饰器
def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not session.get('logged_in'):
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated_function

# 错误处理装饰器
def handle_errors(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        try:
            return f(*args, **kwargs)
        except Exception as e:
            logging.error(f"Error in {f.__name__}: {str(e)}", exc_info=True)
            return jsonify({
                'status': 'error',
                'message': str(e)
            }), 500
    return decorated_function

# 路由处理
@app.route('/')
@login_required
def index():
    return send_from_directory('static', 'index.html')

@app.route('/login', methods=['GET'])
def login():
    if session.get('logged_in'):
        return redirect('/')
    return send_from_directory('static', 'login.html')

@app.route('/api/login', methods=['POST'])
def api_login():
    data = request.json
    username = data.get('username')
    password = data.get('password')
    
    if not username or not password:
        return jsonify({
            'status': 'error',
            'message': '用户名和密码不能为空'
        }), 400
        
    db_session = Session()
    try:
        user = db_session.query(User).filter_by(username=username).first()
        if user and user.check_password(password):
            session['logged_in'] = True
            session['user_id'] = user.id
            session['username'] = user.username
            session['is_admin'] = user.is_admin
            session.permanent = True
            
            user.last_login = datetime.now()
            db_session.commit()
            
            return jsonify({
                'status': 'success',
                'message': '登录成功',
                'data': {
                    'username': user.username,
                    'is_admin': user.is_admin
                }
            })
    finally:
        db_session.close()
        
    return jsonify({
        'status': 'error',
        'message': '用户名或密码错误'
    }), 401

@app.route('/api/logout')
def logout():
    session.clear()
    return redirect('/login')

# 系统状态接口
@app.route('/api/stats')
def get_system_stats():
    try:
        cpu_percent = psutil.cpu_percent(interval=1)
        memory = psutil.virtual_memory()
        network = psutil.net_io_counters()
        
        return jsonify({
            'cpu_percent': cpu_percent,
            'memory_percent': memory.percent,
            'memory_used': memory.used,
            'memory_total': memory.total,
            'network_speed': (network.bytes_sent + network.bytes_recv) / 1024 / 1024  # MB/s
        })
    except Exception as e:
        logging.error(f"Error getting system stats: {e}")
        return jsonify({
            'cpu_percent': 0,
            'memory_percent': 0,
            'memory_used': 0,
            'memory_total': 0,
            'network_speed': 0
        })

# 静态文件路由
@app.route('/static/<path:path>')
def serve_static(path):
    return send_from_directory('static', path)

@app.route('/favicon.ico')
def favicon():
    return send_from_directory('static', 'favicon.ico')

# 健康检查接口
@app.route('/health')
def health_check():
    return jsonify({
        'status': 'healthy',
        'timestamp': datetime.now().isoformat()
    })

if __name__ == '__main__':
    port = int(os.getenv('PORT', 10088))
    host = os.getenv('HOST', '0.0.0.0')
    app.run(host=host, port=port, debug=os.getenv('DEBUG', 'False').lower() == 'true') 
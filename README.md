# 流媒体转推服务

## 项目介绍
这是一个基于 Flask 的流媒体转推服务，支持将视频流转推到其他平台。主要功能包括：

* 单个流的添加和管理
* 批量导入流配置
* 实时状态监控
* 灵活的转码配置

## 系统要求
* Python 3.8+
* FFmpeg

## 安装部署

### 1. 安装 FFmpeg

<pre><code>sudo apt update
sudo apt install ffmpeg
</code></pre>

<p>2. 创建并激活虚拟环境:</p>

<pre><code># 安装 virtualenv（如果还没安装）
sudo apt install python3-venv

# 创建虚拟环境
python3 -m venv venv

# 激活虚拟环境
source venv/bin/activate
</code></pre>

<p>3. 安装 Python 依赖:</p>

<pre><code># 确保在虚拟环境中
pip install -r requirements.txt
</code></pre>

<h2>配置说明</h2>
<p>在 backend/.env 文件中配置以下参数：
<ul>
  <li>PORT: 服务端口号（默认：5000）</li>
  <li>HOST: 监听地址（默认：0.0.0.0）</li>
  <li>DEBUG: 调试模式（默认：True）</li>
</ul>

<h2>启动服务</h2>
<p>1. 首先激活虚拟环境：</p>
<pre><code>source venv/bin/activate
</code></pre>

<p>2. 直接启动：</p>
<pre><code>python backend/app.py
</code></pre>

<p>3. 使用 gunicorn 启动（推荐生产环境使用）：</p>
<pre><code>gunicorn -w 4 -b 0.0.0.0:10088 backend.app:app
</code></pre>

<p>4. 退出虚拟环境：</p>
<pre><code>deactivate
</code></pre>

<h2>API 接口</h2>
<table>
  <tr>
    <th>接口</th>
    <th>方法</th>
    <th>说明</th>
  </tr>
  <tr>
    <td>/api/streams</td>
    <td>POST</td>
    <td>添加新的转推流</td>
  </tr>
  <tr>
    <td>/api/streams/{stream_id}</td>
    <td>DELETE</td>
    <td>停止指定的转推流</td>
  </tr>
  <tr>
    <td>/api/streams/{stream_id}/status</td>
    <td>GET</td>
    <td>获取转推流状态</td>
  </tr>
  <tr>
    <td>/api/streams/batch</td>
    <td>POST</td>
    <td>批量导入转推流</td>
  </tr>
</table>

<h2>使用示例</h2>
<p>添加新的转推流：</p>
<pre><code>{
  "id": "stream1",
  "sourceUrl": "rtmp://source.example.com/live/stream",
  "outputUrl": "rtmp://target.example.com/live/",
  "key": "streamkey",
  "videoCodec": "copy",
  "audioBitrate": "128k"
}
</code></pre>

<h2>日志</h2>
<p>
日志文件位于 stream_server.log，记录了所有转推操作和错误信息。
</p>

<h2>注意事项</h2>
<ul>
  <li>确保有足够的网络带宽进行转推</li>
  <li>建议在生产环境中使用 gunicorn 作为 WSGI 服务器</li>
  <li>定期检查日志文件大小，避免占用过多磁盘空间</li>
</ul>
</p>
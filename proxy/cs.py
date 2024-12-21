import subprocess
import requests

def fetch_mpd_url():
    # Step 1: 发送请求获取重定向的 MPD 地址
    url = "http://pix.zbds.top/mytvsuper/J"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
    }
    response = requests.get(url, headers=headers, allow_redirects=False)
    
    if response.status_code == 302:  # 检查是否重定向成功
        mpd_url = response.headers.get("Location")
        print(f"最新 MPD 地址: {mpd_url}")
        return mpd_url
    else:
        print("未能获取 MPD 地址")
        return None

def download_stream(mpd_url):
    # Step 2: 调用 ffmpeg 下载并解密流
    ffmpeg_command = [
        "ffmpeg",
        "-headers", "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
        "-i", mpd_url,
        "-c", "copy",
        "-decryption_key", "0958b9c657622c465a6205eb2252b8ed:2d2fd7b1661b1e28de38268872b48480",
        "output.mp4"
    ]
    subprocess.run(ffmpeg_command)

if __name__ == "__main__":
    mpd_url = fetch_mpd_url()
    if mpd_url:
        download_stream(mpd_url)

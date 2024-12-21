#!/bin/bash

# 获取最新 MPD 地址
MPD_URL=$(curl -s -L -I "http://pix.zbds.top/mytvsuper/J" | grep -i "Location:" | awk '{print $2}' | tr -d '\r')

if [[ -z "$MPD_URL" ]]; then
    echo "未能获取最新的 MPD 地址"
    exit 1
fi

echo "使用最新 MPD 地址: $MPD_URL"

# 调用 FFmpeg 拉流并解密
ffmpeg -headers "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36" \
  -i "$MPD_URL" \
  -c copy \
  -decryption_key "0958b9c657622c465a6205eb2252b8ed:2d2fd7b1661b1e28de38268872b48480" \
  output.mp4

const fs = require('fs');
const { exec } = require('child_process');

// 检查系统环境
function checkEnvironment() {
    return new Promise((resolve, reject) => {
        // 检查 ffmpeg
        exec('ffmpeg -version', (error) => {
            if (error) {
                console.error('未安装 ffmpeg，请先安装 ffmpeg');
                reject(error);
                return;
            }

            // 检查目录权限
            const dirs = ['logs', 'data'];
            for (const dir of dirs) {
                try {
                    fs.accessSync(dir, fs.constants.W_OK);
                } catch (error) {
                    console.error(`${dir} 目录无写入权限`);
                    reject(error);
                    return;
                }
            }

            resolve();
        });
    });
}

// 使用方法
checkEnvironment()
    .then(() => console.log('环境检查通过'))
    .catch(error => console.error('环境检查失败:', error)); 
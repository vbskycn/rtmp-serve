const logger = require('../services/logger');

module.exports = (err, req, res, next) => {
    logger.error('错误:', {
        message: err.message,
        stack: err.stack,
        path: req.path,
        method: req.method
    });

    // API错误响应
    if (req.path.startsWith('/api')) {
        return res.status(err.status || 500).json({
            status: 'error',
            message: err.message || '服务器内部错误',
            code: err.code
        });
    }

    // 页面错误响应
    res.status(err.status || 500).send(`
        <html>
            <head>
                <title>错误</title>
                <style>
                    body {
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto;
                        padding: 40px;
                        max-width: 600px;
                        margin: 0 auto;
                    }
                    .error-container {
                        background: #fff1f0;
                        border: 1px solid #ffa39e;
                        padding: 20px;
                        border-radius: 4px;
                    }
                    h1 { color: #cf1322; }
                    p { color: #666; }
                </style>
            </head>
            <body>
                <div class="error-container">
                    <h1>出错了</h1>
                    <p>${err.message || '服务器内部错误'}</p>
                    <p><a href="/">返回首页</a></p>
                </div>
            </body>
        </html>
    `);
}; 
async function handleLogin(event) {
    event.preventDefault();
    
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    
    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();
        
        if (data.status === 'success') {
            // 登录成功，跳转到主页
            window.location.href = '/';
        } else {
            // 显示错误信息
            showError(data.message || '登录失败');
        }
    } catch (error) {
        showError('登录请求失败');
        console.error('Login error:', error);
    }
}

function showError(message) {
    let errorDiv = document.querySelector('.error-message');
    if (!errorDiv) {
        errorDiv = document.createElement('div');
        errorDiv.className = 'error-message';
        document.querySelector('.login-box').appendChild(errorDiv);
    }
    errorDiv.textContent = message;
} 
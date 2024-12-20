class LoginManager {
    constructor() {
        this.form = document.getElementById('loginForm');
        this.initEventListeners();
        this.checkRememberedLogin();
    }

    initEventListeners() {
        this.form.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleLogin();
        });
    }

    async handleLogin() {
        const formData = new FormData(this.form);
        const data = {
            username: formData.get('username'),
            password: formData.get('password'),
            remember: formData.get('remember') === 'on'
        };

        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data)
            });

            const result = await response.json();

            if (result.status === 'success') {
                this.handleLoginSuccess(result.token, data.remember);
            } else {
                this.showError(result.message || '登录失败');
            }
        } catch (error) {
            this.showError('网络错误，请稍后重试');
        }
    }

    handleLoginSuccess(token, remember) {
        if (remember) {
            localStorage.setItem('token', token);
        } else {
            sessionStorage.setItem('token', token);
        }
        window.location.href = '/';
    }

    checkRememberedLogin() {
        const token = localStorage.getItem('token');
        if (token) {
            this.validateToken(token);
        }
    }

    async validateToken(token) {
        try {
            const response = await fetch('/api/validate-token', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (response.ok) {
                window.location.href = '/';
            } else {
                localStorage.removeItem('token');
            }
        } catch (error) {
            console.error('Token validation failed:', error);
        }
    }

    showError(message) {
        let errorDiv = document.querySelector('.error-message');
        if (!errorDiv) {
            errorDiv = document.createElement('div');
            errorDiv.className = 'error-message';
            this.form.appendChild(errorDiv);
        }
        errorDiv.textContent = message;
    }
}

// 初始化登录管理器
const loginManager = new LoginManager(); 
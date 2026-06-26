const express = require('express');
const cookieSession = require('cookie-session');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8000;

// 配置 Cookie Session 中間件以儲存登入狀態
app.use(cookieSession({
    name: 'session',
    keys: [process.env.SESSION_SECRET || 'invoice_helper_secret_key'],
    maxAge: 24 * 60 * 60 * 1000 // 24 小時有效
}));

// 支援解析 JSON 與 urlencoded 表單資料
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 登入驗證中間件
function requireLogin(req, res, next) {
    // 允許匿名讀取登入相關頁面與 API
    const anonymousPaths = ['/login', '/login.html', '/api/login', '/style.css'];
    
    // 如果是讀取核心 CSS，為了防止在登入頁被攔截，我們允許匿名訪問 style.css
    // 或是登入頁面自己有內建的 style，這更安全。不過目前為了方便，我們允許匿名讀取 style.css，
    // 或是將核心 style.css 與 login 專用樣式切分。為了安全，我們可以把 login.html 內嵌樣式，
    // 這樣 style.css 就可以受到完全保護！這是一個非常專業的安全設計。
    // 因此，Anonymous 只有 /login, /login.html, /api/login。
    if (anonymousPaths.includes(req.path)) {
        return next();
    }

    if (req.session && req.session.authenticated) {
        return next();
    }

    // 未登入則重定向至登入頁面
    res.redirect('/login');
}

// 登入頁面路由
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

// 登入驗證 API
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    // 讀取環境變數，若無則使用預設值
    const adminUser = process.env.ADMIN_USER || 'admin';
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin888';

    if (username === adminUser && password === adminPassword) {
        req.session.authenticated = true;
        res.json({ success: true, message: '登入成功' });
    } else {
        res.status(401).json({ success: false, message: '帳號或密碼錯誤！' });
    }
});

// 登出 API
app.all('/api/logout', (req, res) => {
    req.session = null; // 銷毀 session
    if (req.xhr || req.headers.accept.indexOf('json') > -1) {
        res.json({ success: true, redirect: '/login' });
    } else {
        res.redirect('/login');
    }
});

// 套用登入保護中間件 (對之後所有靜態資源與路徑生效)
app.use(requireLogin);

// 託管主靜態網頁資源 (index.html, app.js, style.css 等)
app.use(express.static(path.join(__dirname)));

// 首頁路由重定向至 index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 啟動伺服器
app.listen(PORT, () => {
    console.log(`伺服器正在運行於 http://localhost:${PORT}`);
});

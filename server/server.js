const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());

// 静态文件服务（index.html 在项目根目录）
app.use(express.static(path.join(__dirname, '..')));

// 健康检查
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// 路由懒加载（后续任务添加）
let authRoutes, taskRoutes, sseHandler;
app.use('/api/auth', (...args) => authRoutes(...args));
app.use('/api/tasks', (...args) => taskRoutes(...args));
app.get('/api/sse/events', (...args) => sseHandler(...args));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`服务器已启动: http://localhost:${PORT}`);
});

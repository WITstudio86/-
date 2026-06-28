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

const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes);

const { router: taskRoutes, setBroadcast } = require('./routes/tasks');
app.use('/api/tasks', taskRoutes);
// setBroadcast 将在 Task 4 接入

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`服务器已启动: http://localhost:${PORT}`);
});

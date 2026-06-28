const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'kanban-dev-secret';
const JWT_EXPIRES_IN = '7d';

/** 签发 JWT */
function signToken(userId, username) {
  return jwt.sign({ userId, username }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

/** Express 中间件：验证 Bearer Token */
function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未提供认证令牌' });
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.userId;
    req.username = payload.username;
    next();
  } catch (_err) {
    return res.status(401).json({ error: '令牌无效或已过期' });
  }
}

module.exports = { signToken, authMiddleware, JWT_SECRET };

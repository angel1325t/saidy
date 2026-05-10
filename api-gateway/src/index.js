require('dotenv').config();

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cors = require('cors');
const express = require('express');
const jwt = require('jsonwebtoken');
const multer = require('multer');

const app = express();
const port = Number(process.env.PORT || 3000);
const validRoles = new Set(['admin', 'author', 'reader']);

const services = {
  auth: process.env.AUTH_SERVICE_URL || 'http://localhost:3001',
  users: process.env.USERS_SERVICE_URL || 'http://localhost:3002',
  posts: process.env.POSTS_SERVICE_URL || 'http://localhost:3003',
  comments: process.env.COMMENTS_SERVICE_URL || 'http://localhost:3004'
};

const jwtSecret = process.env.JWT_SECRET || 'dev-secret';
const uploadsDir = path.join(__dirname, '..', 'public', 'uploads');

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, uploadsDir),
    filename: (_req, file, callback) => {
      const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
      const safeExt = ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext) ? ext : '.jpg';
      callback(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExt}`);
    }
  }),
  fileFilter: (_req, file, callback) => {
    if (String(file.mimetype || '').startsWith('image/')) {
      callback(null, true);
    } else {
      callback(new Error('Only image uploads are allowed'));
    }
  },
  limits: {
    fileSize: 5 * 1024 * 1024
  }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

function normalizeRole(role, fallback = 'reader') {
  const normalized = String(role || fallback).trim().toLowerCase();
  return validRoles.has(normalized) ? normalized : null;
}

function mapAxiosError(error, res) {
  if (error.response) {
    return res.status(error.response.status).json(error.response.data);
  }

  console.error('Gateway upstream error:', error.message);
  return res.status(502).json({ message: 'Upstream service unavailable' });
}

function readBearerToken(req) {
  const authHeader = String(req.headers.authorization || '');
  return authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
}

function authRequired(req, res, next) {
  const token = readBearerToken(req);

  if (!token) {
    return res.status(401).json({ message: 'Missing token' });
  }

  try {
    req.user = jwt.verify(token, jwtSecret);
    return next();
  } catch (_error) {
    return res.status(401).json({ message: 'Invalid token' });
  }
}

function authOptional(req, _res, next) {
  const token = readBearerToken(req);
  if (!token) {
    return next();
  }

  try {
    req.user = jwt.verify(token, jwtSecret);
  } catch (_error) {
    req.user = null;
  }

  return next();
}

function requireRole(...roles) {
  const allowed = new Set(roles);

  return (req, res, next) => {
    const role = normalizeRole(req.user?.role);
    if (!role || !allowed.has(role)) {
      return res.status(403).json({ message: 'You do not have permission for this action' });
    }

    return next();
  };
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'api-gateway' });
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const response = await axios.post(`${services.auth}/auth/register`, {
      name: req.body.name,
      email: req.body.email,
      password: req.body.password
    });

    return res.status(response.status).json(response.data);
  } catch (error) {
    return mapAxiosError(error, res);
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const response = await axios.post(`${services.auth}/auth/login`, req.body);
    return res.status(response.status).json(response.data);
  } catch (error) {
    return mapAxiosError(error, res);
  }
});

app.get('/api/auth/verify', authRequired, async (req, res) => {
  res.json({ valid: true, user: req.user });
});

app.get('/api/users/me', authRequired, async (req, res) => {
  try {
    const response = await axios.get(`${services.users}/users/${req.user.sub}`);
    return res.json(response.data);
  } catch (error) {
    return mapAxiosError(error, res);
  }
});

app.patch('/api/users/me', authRequired, async (req, res) => {
  try {
    const response = await axios.patch(`${services.users}/users/${req.user.sub}`, req.body);
    return res.json(response.data);
  } catch (error) {
    return mapAxiosError(error, res);
  }
});

app.get('/api/users', authRequired, requireRole('admin'), async (_req, res) => {
  try {
    const response = await axios.get(`${services.users}/users`);
    return res.json(response.data);
  } catch (error) {
    return mapAxiosError(error, res);
  }
});

app.patch('/api/admin/users/:id/role', authRequired, requireRole('admin'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: 'Invalid user id' });
    }

    const role = normalizeRole(req.body.role);
    if (!role) {
      return res.status(400).json({ message: 'Role must be admin, author or reader' });
    }

    const response = await axios.patch(`${services.users}/internal/users/${id}/role`, { role });
    return res.json(response.data);
  } catch (error) {
    return mapAxiosError(error, res);
  }
});

app.post('/api/uploads', authRequired, requireRole('admin', 'author'), (req, res) => {
  upload.single('image')(req, res, (error) => {
    if (error) {
      return res.status(400).json({ message: error.message || 'Upload failed' });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'image file is required' });
    }

    return res.status(201).json({
      url: `/uploads/${req.file.filename}`,
      filename: req.file.filename,
      size: req.file.size,
      mimeType: req.file.mimetype
    });
  });
});

app.get('/api/posts', authOptional, async (req, res) => {
  try {
    const response = await axios.get(`${services.posts}/posts`, {
      params: {
        q: req.query.q,
        tag: req.query.tag,
        tags: req.query.tags,
        page: req.query.page,
        limit: req.query.limit,
        viewerId: req.user?.sub
      }
    });

    return res.json(response.data);
  } catch (error) {
    return mapAxiosError(error, res);
  }
});

app.get('/api/posts/mine', authRequired, requireRole('admin', 'author'), async (req, res) => {
  try {
    const response = await axios.get(`${services.posts}/posts/author/${req.user.sub}`, {
      params: {
        q: req.query.q,
        tag: req.query.tag,
        tags: req.query.tags,
        page: req.query.page,
        limit: req.query.limit,
        viewerId: req.user.sub
      }
    });

    return res.json(response.data);
  } catch (error) {
    return mapAxiosError(error, res);
  }
});

app.get('/api/posts/:id', authOptional, async (req, res) => {
  try {
    const response = await axios.get(`${services.posts}/posts/${req.params.id}`, {
      params: {
        viewerId: req.user?.sub
      }
    });

    return res.json(response.data);
  } catch (error) {
    return mapAxiosError(error, res);
  }
});

app.post('/api/posts', authRequired, requireRole('admin', 'author'), async (req, res) => {
  try {
    const response = await axios.post(`${services.posts}/posts`, {
      authorId: req.user.sub,
      role: req.user.role,
      title: req.body.title,
      content: req.body.content,
      imageUrl: req.body.imageUrl,
      tags: req.body.tags
    });
    return res.status(response.status).json(response.data);
  } catch (error) {
    return mapAxiosError(error, res);
  }
});

app.put('/api/posts/:id', authRequired, requireRole('admin', 'author'), async (req, res) => {
  try {
    const response = await axios.put(`${services.posts}/posts/${req.params.id}`, {
      authorId: req.user.sub,
      role: req.user.role,
      title: req.body.title,
      content: req.body.content,
      imageUrl: req.body.imageUrl,
      tags: req.body.tags
    });
    return res.status(response.status).json(response.data);
  } catch (error) {
    return mapAxiosError(error, res);
  }
});

app.delete('/api/posts/:id', authRequired, requireRole('admin', 'author'), async (req, res) => {
  try {
    await axios.delete(`${services.posts}/posts/${req.params.id}`, {
      data: {
        authorId: req.user.sub,
        role: req.user.role
      }
    });
    return res.status(204).send();
  } catch (error) {
    return mapAxiosError(error, res);
  }
});

app.post('/api/posts/:id/likes', authRequired, async (req, res) => {
  try {
    const response = await axios.post(`${services.posts}/posts/${req.params.id}/likes`, {
      userId: req.user.sub
    });
    return res.status(response.status).json(response.data);
  } catch (error) {
    return mapAxiosError(error, res);
  }
});

app.delete('/api/posts/:id/likes', authRequired, async (req, res) => {
  try {
    const response = await axios.delete(`${services.posts}/posts/${req.params.id}/likes`, {
      data: {
        userId: req.user.sub
      }
    });
    return res.status(response.status).json(response.data);
  } catch (error) {
    return mapAxiosError(error, res);
  }
});

app.get('/api/tags', async (req, res) => {
  try {
    const response = await axios.get(`${services.posts}/tags`, {
      params: {
        q: req.query.q
      }
    });
    return res.json(response.data);
  } catch (error) {
    return mapAxiosError(error, res);
  }
});

app.get('/api/comments/post/:postId', async (req, res) => {
  try {
    const response = await axios.get(`${services.comments}/comments/post/${req.params.postId}`, {
      params: {
        nested: req.query.nested
      }
    });
    return res.json(response.data);
  } catch (error) {
    return mapAxiosError(error, res);
  }
});

app.post('/api/comments', authRequired, async (req, res) => {
  try {
    const response = await axios.post(`${services.comments}/comments`, {
      postId: req.body.postId,
      authorId: req.user.sub,
      role: req.user.role,
      content: req.body.content,
      parentCommentId: req.body.parentCommentId
    });
    return res.status(response.status).json(response.data);
  } catch (error) {
    return mapAxiosError(error, res);
  }
});

app.delete('/api/comments/:id', authRequired, async (req, res) => {
  try {
    await axios.delete(`${services.comments}/comments/${req.params.id}`, {
      data: {
        authorId: req.user.sub,
        role: req.user.role
      }
    });
    return res.status(204).send();
  } catch (error) {
    return mapAxiosError(error, res);
  }
});

app.get('/api/admin/stats', authRequired, requireRole('admin'), async (_req, res) => {
  try {
    const [usersRes, postsRes, commentsRes] = await Promise.all([
      axios.get(`${services.users}/users`),
      axios.get(`${services.posts}/stats`),
      axios.get(`${services.comments}/comments/stats`)
    ]);

    const users = usersRes.data;
    const roleCounts = {
      admin: 0,
      author: 0,
      reader: 0
    };

    for (const user of users) {
      const role = normalizeRole(user.role);
      if (role) {
        roleCounts[role] += 1;
      }
    }

    return res.json({
      users: {
        totalUsers: users.length,
        byRole: roleCounts
      },
      posts: postsRes.data,
      comments: commentsRes.data,
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    return mapAxiosError(error, res);
  }
});

app.get('/', (_req, res) => {
  res.redirect('/login.html');
});

app.listen(port, () => {
  console.log(`api-gateway running on port ${port}`);
});

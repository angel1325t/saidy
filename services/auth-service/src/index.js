require('dotenv').config();

const axios = require('axios');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const express = require('express');
const jwt = require('jsonwebtoken');

const app = express();
const port = Number(process.env.PORT || 3001);
const usersServiceUrl = process.env.USERS_SERVICE_URL || 'http://localhost:3002';
const jwtSecret = process.env.JWT_SECRET || 'dev-secret';
const jwtExpiresIn = process.env.JWT_EXPIRES_IN || '24h';
const allowedRoles = new Set(['admin', 'author', 'reader']);

app.use(cors());
app.use(express.json());

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizeRole(role, defaultRole = 'reader') {
  const normalized = String(role || defaultRole).trim().toLowerCase();
  return allowedRoles.has(normalized) ? normalized : null;
}

function buildTokenPayload(user) {
  return {
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role
  };
}

function signToken(user) {
  return jwt.sign(buildTokenPayload(user), jwtSecret, { expiresIn: jwtExpiresIn });
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'auth-service' });
});

app.post('/auth/register', async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || '');

  if (!name || !email || !password) {
    return res.status(400).json({ message: 'name, email and password are required' });
  }

  if (password.length < 6) {
    return res.status(400).json({ message: 'Password must have at least 6 characters' });
  }

  try {
    let role = 'reader';
    try {
      const metricsResponse = await axios.get(`${usersServiceUrl}/internal/users/count`);
      const totalUsers = Number(metricsResponse.data?.total ?? 0);
      if (Number.isFinite(totalUsers) && totalUsers === 0) {
        role = 'admin';
      }
    } catch (error) {
      console.error('Unable to resolve bootstrap role:', error.message);
    }

    role = normalizeRole(role) || 'reader';
    const passwordHash = await bcrypt.hash(password, 10);

    const userResponse = await axios.post(`${usersServiceUrl}/users`, {
      name,
      email,
      passwordHash,
      role
    });

    const user = userResponse.data;
    const token = signToken(user);

    return res.status(201).json({
      token,
      user
    });
  } catch (error) {
    if (error.response) {
      return res.status(error.response.status).json(error.response.data);
    }

    console.error('POST /auth/register error', error.message);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

app.post('/auth/login', async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || '');

  if (!email || !password) {
    return res.status(400).json({ message: 'email and password are required' });
  }

  try {
    const userResponse = await axios.get(
      `${usersServiceUrl}/internal/users/by-email/${encodeURIComponent(email)}`
    );

    const user = userResponse.data;
    const isValidPassword = await bcrypt.compare(password, user.passwordHash);

    if (!isValidPassword) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = signToken(user);
    const safeUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      bio: user.bio,
      avatarUrl: user.avatarUrl,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    };

    return res.json({ token, user: safeUser });
  } catch (error) {
    if (error.response?.status === 404) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    if (error.response) {
      return res.status(error.response.status).json(error.response.data);
    }

    console.error('POST /auth/login error', error.message);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

app.get('/auth/verify', (req, res) => {
  const authHeader = String(req.headers.authorization || '');
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: 'Missing token' });
  }

  try {
    const decoded = jwt.verify(token, jwtSecret);
    return res.json({ valid: true, user: decoded });
  } catch (_error) {
    return res.status(401).json({ valid: false, message: 'Invalid token' });
  }
});

app.listen(port, () => {
  console.log(`auth-service running on port ${port}`);
});

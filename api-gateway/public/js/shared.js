(() => {
  const ROLE_LABELS = {
    admin: 'Administrador',
    author: 'Autor',
    reader: 'Estudiante'
  };

  function getToken() {
    return localStorage.getItem('blog_token') || '';
  }

  function getUser() {
    const raw = localStorage.getItem('blog_user');
    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw);
    } catch (_error) {
      localStorage.removeItem('blog_user');
      return null;
    }
  }

  function setSession(token, user) {
    localStorage.setItem('blog_token', token);
    localStorage.setItem('blog_user', JSON.stringify(user));
  }

  function clearSession() {
    localStorage.removeItem('blog_token');
    localStorage.removeItem('blog_user');
  }

  async function api(path, options = {}) {
    const isFormData = options.body instanceof FormData;
    const headers = {
      ...(options.headers || {})
    };

    if (!isFormData && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    const token = getToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(path, {
      ...options,
      headers
    });

    if (response.status === 204) {
      return null;
    }

    let data = {};
    try {
      data = await response.json();
    } catch (_error) {
      data = {};
    }

    if (!response.ok) {
      throw new Error(data.message || 'Request failed');
    }

    return data;
  }

  async function verifySession() {
    const token = getToken();
    if (!token) {
      return null;
    }

    try {
      const result = await api('/api/auth/verify');
      const payload = result.user || {};
      const current = getUser() || {};
      const merged = {
        sub: payload.sub,
        name: payload.name || current.name || '',
        email: payload.email || current.email || '',
        role: payload.role || current.role || 'reader'
      };

      localStorage.setItem('blog_user', JSON.stringify(merged));
      return merged;
    } catch (_error) {
      clearSession();
      return null;
    }
  }

  function roleLabel(role) {
    return ROLE_LABELS[role] || role;
  }

  function hasRole(user, roles) {
    return Boolean(user && roles.includes(user.role));
  }

  async function ensureAuth(options = {}) {
    const { roles = [], redirectTo = '/login.html' } = options;
    const user = await verifySession();

    if (!user) {
      window.location.replace(redirectTo);
      return null;
    }

    if (roles.length > 0 && !hasRole(user, roles)) {
      window.location.replace('/posts.html');
      return null;
    }

    return user;
  }

  async function ensureGuest(redirectTo = '/posts.html') {
    const user = await verifySession();
    if (user) {
      window.location.replace(redirectTo);
      return false;
    }

    return true;
  }

  function navLink(href, label, isActive) {
    return `<a href="${href}" class="nav-pill ${isActive ? 'is-active' : ''}">${label}</a>`;
  }

  function renderNavbar(targetId = 'nav-slot') {
    const target = document.getElementById(targetId);
    if (!target) {
      return;
    }

    const user = getUser();
    const pathname = window.location.pathname.toLowerCase();
    const isActive = (href) => pathname === href.toLowerCase();

    const publicLinks = [
      navLink('/login.html', 'Login', isActive('/login.html')),
      navLink('/register.html', 'Registro', isActive('/register.html'))
    ];

    const privateLinks = [
      navLink('/posts.html', 'Posts', isActive('/posts.html'))
    ];

    if (user && hasRole(user, ['admin', 'author'])) {
      privateLinks.push(navLink('/my-posts.html', 'Mis posts', isActive('/my-posts.html')));
    }

    privateLinks.push(navLink('/profile.html', 'Perfil', isActive('/profile.html')));

    if (user?.role === 'admin') {
      privateLinks.push(navLink('/admin.html', 'Admin', isActive('/admin.html')));
    }

    const links = user ? privateLinks : publicLinks;

    target.innerHTML = `
      <div class="top-nav">
        <div class="top-nav__inner">
          <a href="/posts.html" class="top-nav__brand" aria-label="Ir a posts">
            <span class="top-nav__mark">BM</span>
            <span>Blog Microservicios</span>
          </a>

          <div class="nav-meta">
            <nav class="nav-pills" aria-label="Navegación principal">
              ${links.join('')}
            </nav>
            ${
              user
                ? `<span class="nav-badge">${roleLabel(user.role)}</span>
                   <button id="logout-btn" class="btn btn-secondary nav-logout" type="button">Salir</button>`
                : ''
            }
          </div>
        </div>
      </div>
    `;

    const logoutButton = document.getElementById('logout-btn');
    if (logoutButton) {
      logoutButton.addEventListener('click', () => {
        clearSession();
        window.location.replace('/login.html');
      });
    }
  }

  function escapeHtml(text) {
    return String(text)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function formatDateTime(value, options = {}) {
    const {
      locale = 'es-BO',
      dateStyle = 'medium',
      timeStyle = 'short'
    } = options;

    try {
      return new Date(value).toLocaleString(locale, { dateStyle, timeStyle });
    } catch (_error) {
      return String(value || '');
    }
  }

  function parsePositiveInt(rawValue) {
    const parsed = Number(rawValue);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return null;
    }
    return parsed;
  }

  function debounce(fn, delayMs = 320) {
    let timeoutId = null;

    const debounced = (...args) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      timeoutId = setTimeout(() => {
        timeoutId = null;
        fn(...args);
      }, delayMs);
    };

    debounced.cancel = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    return debounced;
  }

  function readQueryState(keys = []) {
    const params = new URLSearchParams(window.location.search);

    return keys.reduce((acc, key) => {
      acc[key] = params.get(key);
      return acc;
    }, {});
  }

  function syncQueryState(state, options = {}) {
    const {
      keys = Object.keys(state),
      defaults = {},
      replace = true
    } = options;

    const params = new URLSearchParams();

    keys.forEach((key) => {
      const value = state[key];
      const defaultValue = defaults[key];

      if (
        value === null ||
        value === undefined ||
        value === '' ||
        (defaultValue !== undefined && String(value) === String(defaultValue))
      ) {
        return;
      }

      params.set(key, String(value));
    });

    const query = params.toString();
    const nextUrl = query ? `${window.location.pathname}?${query}` : window.location.pathname;

    if (replace) {
      window.history.replaceState(null, '', nextUrl);
    } else {
      window.history.pushState(null, '', nextUrl);
    }
  }

  function message(targetId, text, variant = 'info') {
    const element = document.getElementById(targetId);
    if (!element) {
      return;
    }

    const normalizedVariant = ['info', 'success', 'error'].includes(variant) ? variant : 'info';
    element.className = `message-box message-box--${normalizedVariant}`;
    element.textContent = text;
    element.classList.remove('hidden');
  }

  function clearMessage(targetId) {
    const element = document.getElementById(targetId);
    if (!element) {
      return;
    }

    element.classList.add('hidden');
    element.textContent = '';
  }

  window.BlogApp = {
    api,
    clearMessage,
    clearSession,
    debounce,
    ensureAuth,
    ensureGuest,
    escapeHtml,
    formatDateTime,
    getToken,
    getUser,
    hasRole,
    message,
    parsePositiveInt,
    readQueryState,
    renderNavbar,
    roleLabel,
    setSession,
    syncQueryState,
    verifySession
  };
})();

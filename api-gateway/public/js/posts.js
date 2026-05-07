(async () => {
  const {
    api,
    clearMessage,
    debounce,
    ensureAuth,
    escapeHtml,
    formatDateTime,
    hasRole,
    message,
    parsePositiveInt,
    readQueryState,
    renderNavbar,
    syncQueryState
  } = window.BlogApp;

  const user = await ensureAuth();
  renderNavbar();
  if (!user) {
    return;
  }

  const canManageOwnPosts = hasRole(user, ['admin', 'author']);
  const myPostsLink = document.getElementById('my-posts-link');
  if (myPostsLink) {
    myPostsLink.classList.toggle('hidden', !canManageOwnPosts);
  }

  const queryState = readQueryState(['page', 'limit', 'q', 'tag']);
  const rawLimit = parsePositiveInt(queryState.limit);
  const allowedLimits = new Set([5, 10, 20]);

  const state = {
    page: parsePositiveInt(queryState.page) || 1,
    limit: rawLimit && allowedLimits.has(rawLimit) ? rawLimit : 10,
    q: String(queryState.q || '').trim(),
    tag: String(queryState.tag || '').trim(),
    totalPages: 1,
    total: 0,
    commentCounts: new Map()
  };

  const postsList = document.getElementById('posts-list');
  const filtersForm = document.getElementById('filters-form');
  const searchInput = document.getElementById('search-input');
  const tagFilter = document.getElementById('tag-filter');
  const limitSelect = document.getElementById('limit-select');
  const clearFiltersBtn = document.getElementById('clear-filters-btn');
  const pageInfo = document.getElementById('page-info');
  const prevPageBtn = document.getElementById('prev-page');
  const nextPageBtn = document.getElementById('next-page');

  searchInput.value = state.q;
  limitSelect.value = String(state.limit);

  function buildPostsUrl() {
    const params = new URLSearchParams();
    params.set('page', String(state.page));
    params.set('limit', String(state.limit));

    if (state.q) {
      params.set('q', state.q);
    }

    if (state.tag) {
      params.set('tag', state.tag);
    }

    return `/api/posts?${params.toString()}`;
  }

  function syncFiltersToUrl() {
    syncQueryState(
      {
        page: state.page,
        limit: state.limit,
        q: state.q,
        tag: state.tag
      },
      {
        keys: ['page', 'limit', 'q', 'tag'],
        defaults: {
          page: 1,
          limit: 10,
          q: '',
          tag: ''
        }
      }
    );
  }

  function renderLikeButtonContent(liked, count) {
    const heart = liked ? '❤' : '♡';
    return `<span class="engage-icon">${heart}</span><span>${Number(count || 0)} likes</span>`;
  }

  function renderCommentsChip(count) {
    return `<span class="engage-icon">💬</span><span>${Number(count || 0)} comentarios</span>`;
  }

  async function loadCommentCounts(items) {
    const pairs = await Promise.all(
      items.map(async (post) => {
        try {
          const comments = await api(`/api/comments/post/${post.id}`);
          return [post.id, Array.isArray(comments) ? comments.length : 0];
        } catch (_error) {
          return [post.id, 0];
        }
      })
    );

    state.commentCounts = new Map(pairs);
  }

  function postCardMarkup(post) {
    const liked = Boolean(post.likedByViewer);
    const likesCount = Number(post.likesCount || 0);
    const commentsCount = Number(state.commentCounts.get(post.id) || 0);

    return `
      <article class="post-card post-card-clickable" data-action="open-post" data-post-id="${post.id}" role="button" tabindex="0">
        <div class="post-card-title-only">
          <h2 class="post-title">${escapeHtml(post.title)}</h2>
          <span class="post-open-hint">Abrir articulo</span>
        </div>
        <p class="post-meta">Autor ${post.authorId} · ${formatDateTime(post.createdAt)}</p>

        <div class="engagement-strip compact-engagement">
          <button
            class="engage-chip engage-chip-action ${liked ? 'engage-liked' : ''}"
            data-action="toggle-like"
            data-post-id="${post.id}"
            data-liked="${liked ? 'true' : 'false'}"
          >
            ${renderLikeButtonContent(liked, likesCount)}
          </button>
          <span class="engage-chip engage-chip-static">${renderCommentsChip(commentsCount)}</span>
        </div>
      </article>
    `;
  }

  function updatePaginationUi() {
    pageInfo.textContent = `Página ${state.page} de ${state.totalPages} (${state.total} resultados)`;
    prevPageBtn.disabled = state.page <= 1;
    nextPageBtn.disabled = state.page >= state.totalPages;
  }

  async function loadTagOptions() {
    try {
      const tags = await api('/api/tags');
      const selected = state.tag;

      tagFilter.innerHTML = '<option value="">Todos</option>';
      tags.forEach((tag) => {
        const option = document.createElement('option');
        option.value = tag.name;
        option.textContent = `${tag.name} (${tag.usageCount})`;
        tagFilter.appendChild(option);
      });

      if (selected) {
        tagFilter.value = selected;
      }
    } catch (error) {
      message('page-message', `No se pudieron cargar tags: ${error.message}`, 'error');
    }
  }

  async function loadPosts() {
    clearMessage('page-message');

    try {
      const data = await api(buildPostsUrl());
      const items = Array.isArray(data) ? data : data.items || [];
      const pagination = data.pagination || {
        page: state.page,
        limit: state.limit,
        total: items.length,
        totalPages: 1
      };

      state.page = Number(pagination.page || state.page);
      state.limit = Number(pagination.limit || state.limit);
      state.total = Number(pagination.total || 0);
      state.totalPages = Math.max(1, Number(pagination.totalPages || 1));
      syncFiltersToUrl();
      updatePaginationUi();

      if (items.length === 0) {
        postsList.innerHTML = '<p class="empty-note">No hay publicaciones para los filtros actuales.</p>';
        return;
      }

      await loadCommentCounts(items);
      postsList.innerHTML = items.map(postCardMarkup).join('');
    } catch (error) {
      postsList.innerHTML = '<p class="empty-note">No se pudo cargar el feed.</p>';
      message('page-message', error.message, 'error');
    }
  }

  filtersForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    liveSearch.cancel();

    state.q = String(searchInput.value || '').trim();
    state.tag = String(tagFilter.value || '').trim();
    state.limit = Number(limitSelect.value || 10);
    state.page = 1;

    await loadPosts();
  });

  clearFiltersBtn.addEventListener('click', async () => {
    liveSearch.cancel();
    searchInput.value = '';
    tagFilter.value = '';
    limitSelect.value = '10';

    state.q = '';
    state.tag = '';
    state.limit = 10;
    state.page = 1;

    await loadPosts();
  });

  const liveSearch = debounce(async () => {
    state.q = String(searchInput.value || '').trim();
    state.page = 1;
    await loadPosts();
  }, 300);

  searchInput.addEventListener('input', () => {
    liveSearch();
  });

  prevPageBtn.addEventListener('click', async () => {
    if (state.page <= 1) {
      return;
    }

    state.page -= 1;
    await loadPosts();
  });

  nextPageBtn.addEventListener('click', async () => {
    if (state.page >= state.totalPages) {
      return;
    }

    state.page += 1;
    await loadPosts();
  });

  postsList.addEventListener('click', async (event) => {
    const likeButton = event.target.closest('button[data-action="toggle-like"]');
    if (likeButton) {
      event.stopPropagation();

      const postId = Number(likeButton.dataset.postId);
      const liked = likeButton.dataset.liked === 'true';

      try {
        const response = liked
          ? await api(`/api/posts/${postId}/likes`, { method: 'DELETE' })
          : await api(`/api/posts/${postId}/likes`, { method: 'POST' });

        const isLiked = Boolean(response.liked);
        const likesCount = Number(response.likesCount || 0);

        likeButton.dataset.liked = isLiked ? 'true' : 'false';
        likeButton.classList.toggle('engage-liked', isLiked);
        likeButton.innerHTML = renderLikeButtonContent(isLiked, likesCount);
        return;
      } catch (error) {
        message('page-message', error.message, 'error');
        return;
      }
    }

    const card = event.target.closest('article[data-action="open-post"]');
    if (!card) {
      return;
    }

    const postId = Number(card.dataset.postId);
    window.location.href = `/post.html?id=${postId}`;
  });

  postsList.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    const card = event.target.closest('article[data-action="open-post"]');
    if (!card) {
      return;
    }

    event.preventDefault();
    const postId = Number(card.dataset.postId);
    window.location.href = `/post.html?id=${postId}`;
  });

  await loadTagOptions();
  await loadPosts();
})();

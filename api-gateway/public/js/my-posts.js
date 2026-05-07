(async () => {
  const {
    api,
    clearMessage,
    debounce,
    ensureAuth,
    escapeHtml,
    formatDateTime,
    message,
    parsePositiveInt,
    readQueryState,
    renderNavbar,
    syncQueryState
  } = window.BlogApp;

  const user = await ensureAuth({ roles: ['admin', 'author'] });
  renderNavbar();
  if (!user) {
    return;
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

  const editorForm = document.getElementById('post-editor-form');
  const editingPostIdInput = document.getElementById('editing-post-id');
  const editorTitle = document.getElementById('editor-title');
  const editorSubtitle = document.getElementById('editor-subtitle');
  const resetEditorBtn = document.getElementById('reset-editor-btn');
  const cancelEditBtn = document.getElementById('cancel-edit-btn');
  const savePostBtn = document.getElementById('save-post-btn');
  const uploadStatus = document.getElementById('upload-status');
  const imageFileInput = document.getElementById('post-image-file');
  const imageUrlInput = document.getElementById('post-image-url');

  function parseTags(input) {
    return String(input || '')
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean)
      .slice(0, 15);
  }

  function buildMyPostsUrl() {
    const params = new URLSearchParams();
    params.set('page', String(state.page));
    params.set('limit', String(state.limit));

    if (state.q) {
      params.set('q', state.q);
    }

    if (state.tag) {
      params.set('tag', state.tag);
    }

    return `/api/posts/mine?${params.toString()}`;
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

  function renderCommentsButtonContent(count) {
    return `<span class="engage-icon">💬</span><span>${Number(count || 0)} comentarios</span>`;
  }

  function setEditorMode(post = null) {
    if (!post) {
      editingPostIdInput.value = '';
      editorForm.reset();
      editorTitle.textContent = 'Crear nuevo post';
      editorSubtitle.textContent = 'Completa los campos y publica cuando este listo.';
      savePostBtn.textContent = 'Publicar';
      cancelEditBtn.classList.add('hidden');
      uploadStatus.textContent = '';
      return;
    }

    editingPostIdInput.value = String(post.id);
    editorForm.title.value = post.title || '';
    editorForm.content.value = post.content || '';
    editorForm.tags.value = Array.isArray(post.tags) ? post.tags.join(', ') : '';
    editorForm.imageUrl.value = post.imageUrl || '';

    editorTitle.textContent = `Editando post #${post.id}`;
    editorSubtitle.textContent = 'Haz cambios y guarda para actualizar tu publicacion.';
    savePostBtn.textContent = 'Guardar cambios';
    cancelEditBtn.classList.remove('hidden');
    uploadStatus.textContent = '';

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function uploadImageIfNeeded() {
    if (!imageFileInput.files || imageFileInput.files.length === 0) {
      return String(imageUrlInput.value || '').trim() || null;
    }

    uploadStatus.textContent = 'Subiendo imagen...';

    const formData = new FormData();
    formData.append('image', imageFileInput.files[0]);

    const uploadResult = await api('/api/uploads', {
      method: 'POST',
      body: formData
    });

    uploadStatus.textContent = `Imagen subida: ${uploadResult.filename}`;
    return uploadResult.url;
  }

  function canDeleteComment(comment) {
    return user.role === 'admin' || Number(comment.authorId) === Number(user.sub);
  }

  function commentItemMarkup(comment, postId, depth = 0) {
    const replies = Array.isArray(comment.replies) ? comment.replies : [];
    const safeDepth = Math.min(depth, 6);
    const marginLeft = safeDepth * 16;

    return `
      <div class="comment-bubble" style="margin-left:${marginLeft}px">
        <p class="comment-text">${escapeHtml(comment.content)}</p>
        <div class="comment-meta">
          <span>💬 Autor ${comment.authorId}</span>
          <span>${formatDateTime(comment.createdAt)}</span>
          <button data-action="reply-comment" data-post-id="${postId}" data-comment-id="${comment.id}">↩ Responder</button>
          ${
            canDeleteComment(comment)
              ? `<button class="comment-delete" data-action="delete-comment" data-post-id="${postId}" data-comment-id="${comment.id}">Eliminar</button>`
              : ''
          }
        </div>
      </div>
      ${replies.map((reply) => commentItemMarkup(reply, postId, depth + 1)).join('')}
    `;
  }

  async function loadComments(postId) {
    const container = document.querySelector(`[data-comments-for="${postId}"]`);
    if (!container) {
      return;
    }

    container.innerHTML = '<p class="empty-note">Cargando comentarios...</p>';

    try {
      const comments = await api(`/api/comments/post/${postId}?nested=true`);
      if (!Array.isArray(comments) || comments.length === 0) {
        container.innerHTML = '<p class="empty-note">Aun no hay comentarios.</p>';
        return;
      }

      container.innerHTML = comments.map((comment) => commentItemMarkup(comment, postId)).join('');
    } catch (error) {
      container.innerHTML = '<p class="empty-note">No se pudieron cargar los comentarios.</p>';
      message('page-message', `Error cargando comentarios: ${error.message}`, 'error');
    }
  }

  async function fetchCommentCount(postId) {
    try {
      const comments = await api(`/api/comments/post/${postId}`);
      return Array.isArray(comments) ? comments.length : 0;
    } catch (_error) {
      return 0;
    }
  }

  async function loadCommentCounts(items) {
    const pairs = await Promise.all(
      items.map(async (post) => [post.id, await fetchCommentCount(post.id)])
    );

    state.commentCounts = new Map(pairs);
  }

  async function refreshCommentCountForPost(postId) {
    const count = await fetchCommentCount(postId);
    state.commentCounts.set(postId, count);

    const commentsChip = postsList.querySelector(`[data-comments-chip-for="${postId}"]`);
    if (commentsChip) {
      commentsChip.innerHTML = renderCommentsButtonContent(count);
    }
  }

  function postCardMarkup(post) {
    const tags = Array.isArray(post.tags) ? post.tags : [];
    const liked = Boolean(post.likedByViewer);
    const likesCount = Number(post.likesCount || 0);
    const commentsCount = Number(state.commentCounts.get(post.id) || 0);

    return `
      <article class="post-card">
        <header class="post-header">
          <div>
            <h2 class="post-title">${escapeHtml(post.title)}</h2>
            <p class="post-meta">Publicado ${formatDateTime(post.createdAt)} · Actualizado ${formatDateTime(post.updatedAt || post.createdAt)}</p>
          </div>
          <div class="tag-cloud">
            ${
              tags.length > 0
                ? tags.map((tag) => `<span class="tag-pill">#${escapeHtml(tag)}</span>`).join('')
                : '<span class="muted">Sin tags</span>'
            }
          </div>
        </header>

        ${
          post.imageUrl
            ? `<img src="${escapeHtml(post.imageUrl)}" alt="Imagen del post" class="post-image" />`
            : ''
        }

        <p class="post-content">${escapeHtml(post.content)}</p>

        <div class="post-actions">
          <button class="btn btn-warn" data-action="edit-post" data-post-id="${post.id}">Editar</button>
          <button class="btn btn-danger" data-action="delete-post" data-post-id="${post.id}">Eliminar</button>
          <button
            class="engage-chip engage-chip-action ${liked ? 'engage-liked' : ''}"
            data-action="toggle-like"
            data-post-id="${post.id}"
            data-liked="${liked ? 'true' : 'false'}"
          >
            ${renderLikeButtonContent(liked, likesCount)}
          </button>
          <span class="engage-chip engage-chip-static" data-comments-chip-for="${post.id}">
            ${renderCommentsButtonContent(commentsCount)}
          </span>
        </div>

        <form data-action="new-comment" data-post-id="${post.id}" class="comment-form">
          <input class="input" name="content" required placeholder="Escribe un comentario" />
          <button class="btn btn-primary" type="submit">Enviar</button>
        </form>

        <div data-comments-for="${post.id}" class="comment-list"></div>
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
      const data = await api(buildMyPostsUrl());
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
        state.commentCounts = new Map();
        postsList.innerHTML = '<p class="empty-note">Aun no tienes publicaciones con esos filtros.</p>';
        return;
      }

      await loadCommentCounts(items);
      postsList.innerHTML = items.map(postCardMarkup).join('');
      await Promise.all(items.map((post) => loadComments(post.id)));
    } catch (error) {
      postsList.innerHTML = '<p class="empty-note">No se pudieron cargar tus publicaciones.</p>';
      message('page-message', error.message, 'error');
    }
  }

  async function createOrUpdatePost() {
    const editingPostId = Number(editingPostIdInput.value || 0);
    const imageUrl = await uploadImageIfNeeded();

    const payload = {
      title: editorForm.title.value,
      content: editorForm.content.value,
      imageUrl,
      tags: parseTags(editorForm.tags.value)
    };

    if (editingPostId > 0) {
      await api(`/api/posts/${editingPostId}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      message('page-message', 'Post actualizado correctamente', 'success');
    } else {
      await api('/api/posts', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      message('page-message', 'Post creado correctamente', 'success');
    }

    setEditorMode();
    await loadTagOptions();
    await loadPosts();
  }

  editorForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearMessage('page-message');

    try {
      await createOrUpdatePost();
    } catch (error) {
      uploadStatus.textContent = '';
      message('page-message', error.message, 'error');
    }
  });

  resetEditorBtn.addEventListener('click', () => {
    setEditorMode();
  });

  cancelEditBtn.addEventListener('click', () => {
    setEditorMode();
  });

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
    const button = event.target.closest('button');
    if (!button) {
      return;
    }

    const action = button.dataset.action;
    const postId = Number(button.dataset.postId);
    clearMessage('page-message');

    if (action === 'edit-post') {
      try {
        const post = await api(`/api/posts/${postId}`);
        setEditorMode(post);
      } catch (error) {
        message('page-message', error.message, 'error');
      }
      return;
    }

    if (action === 'delete-post') {
      if (!window.confirm('Deseas eliminar este post?')) {
        return;
      }

      try {
        await api(`/api/posts/${postId}`, { method: 'DELETE' });
        message('page-message', 'Post eliminado', 'success');
        if (Number(editingPostIdInput.value || 0) === postId) {
          setEditorMode();
        }
        await loadTagOptions();
        await loadPosts();
      } catch (error) {
        message('page-message', error.message, 'error');
      }
      return;
    }

    if (action === 'toggle-like') {
      const liked = button.dataset.liked === 'true';

      try {
        const response = liked
          ? await api(`/api/posts/${postId}/likes`, { method: 'DELETE' })
          : await api(`/api/posts/${postId}/likes`, { method: 'POST' });

        const isLiked = Boolean(response.liked);
        const likesCount = Number(response.likesCount || 0);

        button.dataset.liked = isLiked ? 'true' : 'false';
        button.classList.toggle('engage-liked', isLiked);
        button.innerHTML = renderLikeButtonContent(isLiked, likesCount);
      } catch (error) {
        message('page-message', error.message, 'error');
      }
      return;
    }

    if (action === 'delete-comment') {
      const commentId = Number(button.dataset.commentId);
      try {
        await api(`/api/comments/${commentId}`, { method: 'DELETE' });
        message('page-message', 'Comentario eliminado', 'success');
        await loadComments(postId);
        await refreshCommentCountForPost(postId);
      } catch (error) {
        message('page-message', error.message, 'error');
      }
      return;
    }

    if (action === 'reply-comment') {
      const parentCommentId = Number(button.dataset.commentId);
      const content = window.prompt('Escribe la respuesta');
      if (!content || !content.trim()) {
        return;
      }

      try {
        await api('/api/comments', {
          method: 'POST',
          body: JSON.stringify({
            postId,
            content,
            parentCommentId
          })
        });

        message('page-message', 'Respuesta publicada', 'success');
        await loadComments(postId);
        await refreshCommentCountForPost(postId);
      } catch (error) {
        message('page-message', error.message, 'error');
      }
    }
  });

  postsList.addEventListener('submit', async (event) => {
    const form = event.target.closest('form[data-action="new-comment"]');
    if (!form) {
      return;
    }

    event.preventDefault();
    clearMessage('page-message');

    const postId = Number(form.dataset.postId);

    try {
      await api('/api/comments', {
        method: 'POST',
        body: JSON.stringify({
          postId,
          content: form.content.value
        })
      });

      form.reset();
      message('page-message', 'Comentario agregado', 'success');
      await loadComments(postId);
      await refreshCommentCountForPost(postId);
    } catch (error) {
      message('page-message', error.message, 'error');
    }
  });

  setEditorMode();
  await loadTagOptions();
  await loadPosts();
})();

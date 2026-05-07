(async () => {
  const { api, ensureAuth, escapeHtml, formatDateTime, message, renderNavbar, roleLabel } = window.BlogApp;

  const user = await ensureAuth({ roles: ['admin'] });
  renderNavbar();
  if (!user) {
    return;
  }

  const tbody = document.getElementById('users-tbody');
  const usersSearch = document.getElementById('users-search');
  const statsGeneratedAt = document.getElementById('stats-generated-at');
  const roleChartCanvas = document.getElementById('role-chart');
  const topTagsChartCanvas = document.getElementById('top-tags-chart');
  const activityChartCanvas = document.getElementById('activity-chart');
  const topTagsList = document.getElementById('top-tags-list');
  const topPostsList = document.getElementById('top-posts-list');

  const allUsers = [];
  const charts = [];
  const roleOptions = ['reader', 'author', 'admin'];

  function setText(id, value) {
    const element = document.getElementById(id);
    if (element) {
      element.textContent = String(value ?? 0);
    }
  }

  function listMarkup(items, emptyMessage, mapFn) {
    if (!Array.isArray(items) || items.length === 0) {
      return `<li>${escapeHtml(emptyMessage)}</li>`;
    }

    return items.map(mapFn).join('');
  }

  function renderUsersTable(query = '') {
    const normalizedQuery = String(query || '').trim().toLowerCase();
    const rows = allUsers.filter((item) => {
      if (!normalizedQuery) {
        return true;
      }

      const role = String(item.role || '').toLowerCase();
      const name = String(item.name || '').toLowerCase();
      const email = String(item.email || '').toLowerCase();

      return role.includes(normalizedQuery) || name.includes(normalizedQuery) || email.includes(normalizedQuery);
    });

    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="muted">Sin usuarios para el filtro actual</td></tr>';
      return;
    }

    tbody.innerHTML = rows
      .map(
        (item) => `
          <tr>
            <td>${item.id}</td>
            <td>${escapeHtml(item.name)}</td>
            <td>${escapeHtml(item.email)}</td>
            <td>${roleLabel(item.role)}</td>
            <td>
              <div class="table-actions">
                <select class="select" data-action="role-select" data-user-id="${item.id}">
                  ${roleOptions
                    .map((role) => `<option value="${role}" ${role === item.role ? 'selected' : ''}>${roleLabel(role)}</option>`)
                    .join('')}
                </select>
                <button class="btn btn-secondary" type="button" data-action="save-role" data-user-id="${item.id}">Guardar</button>
              </div>
            </td>
          </tr>
        `
      )
      .join('');
  }

  function destroyCharts() {
    while (charts.length > 0) {
      const chart = charts.pop();
      chart.destroy();
    }
  }

  function renderCharts(stats) {
    destroyCharts();

    if (typeof window.Chart !== 'function') {
      message('page-message', 'Chart.js no esta disponible en este navegador.', 'error');
      return;
    }

    const chartTextColor = '#0f172a';
    const chartGridColor = 'rgba(15, 23, 42, 0.12)';

    const roleStats = stats.users?.byRole || {};
    const roleValues = [
      Number(roleStats.admin || 0),
      Number(roleStats.author || 0),
      Number(roleStats.reader || 0)
    ];

    charts.push(
      new window.Chart(roleChartCanvas, {
        type: 'doughnut',
        data: {
          labels: ['Admin', 'Autor', 'Estudiante'],
          datasets: [
            {
              data: roleValues,
              backgroundColor: ['#60a5fa', '#a78bfa', '#6ee7b7'],
              borderWidth: 0
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'bottom',
              labels: {
                color: chartTextColor
              }
            }
          }
        }
      })
    );

    const topTags = Array.isArray(stats.posts?.topTags) ? stats.posts.topTags : [];
    const topTagsLabels = topTags.map((item) => item.name);
    const topTagsValues = topTags.map((item) => Number(item.usageCount || 0));

    charts.push(
      new window.Chart(topTagsChartCanvas, {
        type: 'bar',
        data: {
          labels: topTagsLabels,
          datasets: [
            {
              label: 'Uso',
              data: topTagsValues,
              backgroundColor: '#93c5fd',
              borderRadius: 8
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: {
              beginAtZero: true,
              ticks: {
                precision: 0,
                color: chartTextColor
              },
              grid: {
                color: chartGridColor
              }
            },
            x: {
              ticks: {
                color: chartTextColor
              },
              grid: {
                color: 'rgba(0,0,0,0)'
              }
            }
          },
          plugins: {
            legend: {
              display: false
            }
          }
        }
      })
    );

    charts.push(
      new window.Chart(activityChartCanvas, {
        type: 'bar',
        data: {
          labels: ['Posts', 'Likes', 'Comentarios'],
          datasets: [
            {
              label: 'Cantidad',
              data: [
                Number(stats.posts?.totalPosts || 0),
                Number(stats.posts?.totalLikes || 0),
                Number(stats.comments?.totalComments || 0)
              ],
              backgroundColor: ['#60a5fa', '#fca5a5', '#86efac'],
              borderRadius: 10
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: {
              beginAtZero: true,
              ticks: {
                precision: 0,
                color: chartTextColor
              },
              grid: {
                color: chartGridColor
              }
            },
            x: {
              ticks: {
                color: chartTextColor
              },
              grid: {
                color: 'rgba(0,0,0,0)'
              }
            }
          },
          plugins: {
            legend: {
              display: false
            }
          }
        }
      })
    );
  }

  async function loadDashboard() {
    const [users, stats] = await Promise.all([api('/api/users'), api('/api/admin/stats')]);

    allUsers.splice(0, allUsers.length, ...users);

    setText('stat-total-users', stats.users?.totalUsers || 0);
    setText('stat-total-posts', stats.posts?.totalPosts || 0);
    setText('stat-total-likes', stats.posts?.totalLikes || 0);
    setText('stat-total-comments', stats.comments?.totalComments || 0);
    setText('stat-admin-count', stats.users?.byRole?.admin || 0);
    setText('stat-author-count', stats.users?.byRole?.author || 0);
    setText('stat-reader-count', stats.users?.byRole?.reader || 0);
    setText('stat-total-tags', stats.posts?.totalTags || 0);

    topTagsList.innerHTML = listMarkup(stats.posts?.topTags, 'No hay tags aun', (item) => `<li><strong>#${escapeHtml(item.name)}</strong> · ${item.usageCount} uso(s)</li>`);

    topPostsList.innerHTML = listMarkup(
      stats.posts?.mostLikedPosts,
      'No hay likes aun',
      (item) => `<li><strong>${escapeHtml(item.title)}</strong> · ${item.likesCount} like(s)</li>`
    );

    if (statsGeneratedAt) {
      statsGeneratedAt.textContent = `Última actualización: ${formatDateTime(stats.generatedAt || new Date(), { timeStyle: 'medium' })}`;
    }

    renderCharts(stats);
    renderUsersTable(usersSearch?.value || '');
  }

  try {
    await loadDashboard();
  } catch (error) {
    message('page-message', error.message, 'error');
  }

  usersSearch?.addEventListener('input', () => renderUsersTable(usersSearch.value));

  tbody?.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const button = target.closest('button[data-action="save-role"]');
    if (!button) return;

    const userId = button.getAttribute('data-user-id');
    if (!userId) return;

    const select = tbody.querySelector(`select[data-action="role-select"][data-user-id="${userId}"]`);
    const role = select?.value;
    if (!role) return;

    const originalLabel = button.textContent;
    button.textContent = 'Guardando...';
    button.setAttribute('disabled', 'true');

    try {
      await api(`/api/admin/users/${userId}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role })
      });

      await loadDashboard();
      message('page-message', 'Rol actualizado.', 'success');
    } catch (saveError) {
      message('page-message', saveError.message, 'error');
    } finally {
      button.textContent = originalLabel || 'Guardar';
      button.removeAttribute('disabled');
    }
  });
})();

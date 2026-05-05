import { useEffect, useMemo, useState } from 'react';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase.js';
import { apiFetch } from './lib/api.js';

type Section = 'catalog' | 'circulation' | 'digital' | 'admin';

type Profile = {
  id: string;
  email: string;
  full_name: string;
  role: 'admin' | 'librarian' | 'member';
  member_type: 'public' | 'student' | 'teacher' | 'researcher' | 'staff';
  blocked_until: string | null;
  can_access_digital: boolean;
  loan_limit: number;
  reservation_limit: number;
};

type Material = {
  id: string;
  kind: string;
  title: string;
  subtitle: string | null;
  summary: string | null;
  publisher: string | null;
  publication_year: number | null;
  language: string | null;
  isbn: string | null;
  doi: string | null;
  cover_url: string | null;
  digital_url: string | null;
  keywords: string[] | null;
  created_at: string;
};

type Overview = {
  materials: number;
  copies: number;
  loans: number;
  reservations: number;
};

type Loan = {
  id: string;
  status: string;
  borrowed_at: string;
  due_at: string;
  returned_at: string | null;
  materials: { id: string; title: string; kind: string; cover_url: string | null };
  material_copies: { id: string; barcode: string | null; copy_code: string | null; status: string; location: string | null } | null;
};

type Reservation = {
  id: string;
  status: string;
  reserved_at: string;
  queue_position: number;
  materials: { id: string; title: string; kind: string; cover_url: string | null };
};

type Fine = {
  id: string;
  amount: number;
  currency: string;
  status: string;
  reason: string | null;
  issued_at: string;
  due_at: string | null;
  paid_at: string | null;
  loans: { id: string; material_id: string | null; status: string; due_at: string } | null;
};

type DigitalAsset = {
  id: string;
  access_url: string;
  expires_at: string | null;
  asset_type: string;
  materials: { id: string; title: string; kind: string; cover_url: string | null };
};

type AdminDashboard = {
  materials: number;
  loans: number;
  reservations: number;
  fines: number;
  acquisitions: number;
  interlibrary: number;
  notifications: number;
};

type PortalData = {
  profile: Profile | null;
  overview: Overview | null;
  materials: Material[];
  loans: Loan[];
  reservations: Reservation[];
  fines: Fine[];
  digitalAssets: DigitalAsset[];
  dashboard: AdminDashboard | null;
};

const emptyData: PortalData = {
  profile: null,
  overview: null,
  materials: [],
  loans: [],
  reservations: [],
  fines: [],
  digitalAssets: [],
  dashboard: null
};

const sections: Array<{ id: Section; label: string; description: string }> = [
  { id: 'catalog', label: 'Catálogo', description: 'Buscar y reservar materiales' },
  { id: 'circulation', label: 'Circulación', description: 'Préstamos, renovaciones y multas' },
  { id: 'digital', label: 'Digital', description: 'Acceso a materiales digitales' },
  { id: 'admin', label: 'Administración', description: 'Inventario, adquisiciones y analítica' }
];

const roleLabel: Record<Profile['role'], string> = {
  admin: 'Administrador',
  librarian: 'Bibliotecario',
  member: 'Miembro'
};

const memberLabel: Record<Profile['member_type'], string> = {
  public: 'Público',
  student: 'Estudiante',
  teacher: 'Docente',
  researcher: 'Investigador',
  staff: 'Personal'
};

function formatDate(value: string | null | undefined) {
  if (!value) return 'N/A';
  return new Intl.DateTimeFormat('es-BO', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));
}

function formatMoney(value: number, currency = 'BOB') {
  return new Intl.NumberFormat('es-BO', {
    style: 'currency',
    currency
  }).format(value);
}

function toSummary(materials: Material[]) {
  const counts = new Map<string, number>();
  for (const material of materials) {
    counts.set(material.kind, (counts.get(material.kind) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([kind, count]) => ({ kind, count }))
    .slice(0, 4);
}

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [selectedSection, setSelectedSection] = useState<Section>('catalog');
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [portalData, setPortalData] = useState<PortalData>(emptyData);
  const [search, setSearch] = useState('');
  const [selectedMaterialId, setSelectedMaterialId] = useState<string | null>(null);
  const [materialDetail, setMaterialDetail] = useState<any>(null);
  const [authForm, setAuthForm] = useState({
    email: '',
    password: '',
    fullName: '',
    memberType: 'student' as Profile['member_type'],
    institution: ''
  });

  useEffect(() => {
    supabase.auth.getSession().then((response) => {
      setSession(response.data.session ?? null);
      setLoadingSession(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event: AuthChangeEvent, nextSession: Session | null) => {
      setSession(nextSession);
      }
    );

    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setPortalData(emptyData);
      setMaterialDetail(null);
      return;
    }

    let active = true;
    const load = async () => {
      setLoadingData(true);
      setError(null);
      try {
        const token = session.access_token;
        const [me, overview, materials, loans, reservations, fines, assets, dashboard] = await Promise.all([
          apiFetch<{ profile: Profile }>('/api/auth/me', token),
          apiFetch<Overview>('/api/catalog/overview', token),
          apiFetch<{ items: Material[] }>('/api/catalog/materials?page=1&limit=12', token),
          apiFetch<{ items: Loan[] }>('/api/circulation/loans', token),
          apiFetch<{ items: Reservation[] }>('/api/circulation/reservations', token),
          apiFetch<{ items: Fine[] }>('/api/circulation/fines', token),
          apiFetch<{ items: DigitalAsset[] }>('/api/digital/assets', token),
          apiFetch<AdminDashboard>('/api/admin/dashboard', token).catch(() => null)
        ]);

        if (!active) return;

        setPortalData({
          profile: me.profile,
          overview,
          materials: materials.items,
          loans: loans.items,
          reservations: reservations.items,
          fines: fines.items,
          digitalAssets: assets.items,
          dashboard
        });
        setSelectedMaterialId(materials.items[0]?.id ?? null);
      } catch (loadError) {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : 'No se pudo cargar el portal');
      } finally {
        if (active) {
          setLoadingData(false);
        }
      }
    };

    void load();

    return () => {
      active = false;
    };
  }, [session]);

  useEffect(() => {
    if (!session || !selectedMaterialId) {
      setMaterialDetail(null);
      return;
    }

    let active = true;
    const loadDetail = async () => {
      try {
        const detail = await apiFetch<{ material: any }>(
          `/api/catalog/materials/${selectedMaterialId}`,
          session.access_token
        );
        if (active) {
          setMaterialDetail(detail.material);
        }
      } catch {
        if (active) {
          setMaterialDetail(null);
        }
      }
    };

    void loadDetail();

    return () => {
      active = false;
    };
  }, [session, selectedMaterialId]);

  const filteredMaterials = useMemo(() => {
    const value = search.trim().toLowerCase();
    if (!value) return portalData.materials;
    return portalData.materials.filter((material) => {
      const haystack = [
        material.title,
        material.subtitle,
        material.summary,
        material.publisher,
        material.isbn,
        material.doi,
        ...(material.keywords ?? [])
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(value);
    });
  }, [portalData.materials, search]);

  const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: authForm.email,
      password: authForm.password
    });

    if (signInError) {
      setError(signInError.message);
    }
  };

  const handleRegister = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const { error: signUpError } = await supabase.auth.signUp({
      email: authForm.email,
      password: authForm.password,
      options: {
        data: {
          full_name: authForm.fullName,
          member_type: authForm.memberType,
          institution: authForm.institution,
          role: 'member'
        }
      }
    });

    if (signUpError) {
      setError(signUpError.message);
    } else {
      setAuthMode('login');
      setError('Revisa tu correo para confirmar la cuenta si la verificación está activa.');
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const handleReserve = async (materialId: string) => {
    if (!session) return;
    setError(null);

    try {
      await apiFetch('/api/circulation/reservations', session.access_token, {
        method: 'POST',
        body: JSON.stringify({ material_id: materialId })
      });
      const reservations = await apiFetch<{ items: Reservation[] }>('/api/circulation/reservations', session.access_token);
      setPortalData((current) => ({ ...current, reservations: reservations.items }));
    } catch (reserveError) {
      setError(reserveError instanceof Error ? reserveError.message : 'No se pudo reservar el material');
    }
  };

  if (loadingSession) {
    return (
      <div className="app-loading">
        <div className="app-loading__card">
          <p>Cargando Saidy Library...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="auth-screen">
        <section className="auth-hero">
          <div className="eyebrow">Saidy Library</div>
          <h1>Biblioteca híbrida con control de catálogo, circulación y digital.</h1>
          <p>
            Un portal monocromo, limpio y preparado para administrar materiales físicos y digitales
            con Supabase como backend.
          </p>

          <div className="hero-metrics">
            <article>
              <strong>Catálogo</strong>
              <span>Material físico + digital</span>
            </article>
            <article>
              <strong>Préstamos</strong>
              <span>Renovaciones, reservas y multas</span>
            </article>
            <article>
              <strong>Admin</strong>
              <span>Inventario y analítica</span>
            </article>
          </div>
        </section>

        <section className="auth-card">
          <div className="auth-card__tabs">
            <button type="button" className={authMode === 'login' ? 'is-active' : ''} onClick={() => setAuthMode('login')}>
              Iniciar sesión
            </button>
            <button
              type="button"
              className={authMode === 'register' ? 'is-active' : ''}
              onClick={() => setAuthMode('register')}
            >
              Crear cuenta
            </button>
          </div>

          {authMode === 'login' ? (
            <form className="auth-form" onSubmit={handleLogin}>
              <label>
                Correo
                <input
                  type="email"
                  value={authForm.email}
                  onChange={(event) => setAuthForm((current) => ({ ...current, email: event.target.value }))}
                  required
                />
              </label>
              <label>
                Contraseña
                <input
                  type="password"
                  value={authForm.password}
                  onChange={(event) => setAuthForm((current) => ({ ...current, password: event.target.value }))}
                  required
                />
              </label>
              <button type="submit">Entrar</button>
            </form>
          ) : (
            <form className="auth-form" onSubmit={handleRegister}>
              <label>
                Nombre completo
                <input
                  type="text"
                  value={authForm.fullName}
                  onChange={(event) => setAuthForm((current) => ({ ...current, fullName: event.target.value }))}
                  required
                />
              </label>
              <label>
                Correo
                <input
                  type="email"
                  value={authForm.email}
                  onChange={(event) => setAuthForm((current) => ({ ...current, email: event.target.value }))}
                  required
                />
              </label>
              <label>
                Contraseña
                <input
                  type="password"
                  minLength={6}
                  value={authForm.password}
                  onChange={(event) => setAuthForm((current) => ({ ...current, password: event.target.value }))}
                  required
                />
              </label>
              <label>
                Tipo de usuario
                <select
                  value={authForm.memberType}
                  onChange={(event) =>
                    setAuthForm((current) => ({ ...current, memberType: event.target.value as Profile['member_type'] }))
                  }
                >
                  <option value="student">Estudiante</option>
                  <option value="teacher">Docente</option>
                  <option value="researcher">Investigador</option>
                  <option value="public">Público</option>
                  <option value="staff">Personal</option>
                </select>
              </label>
              <label>
                Institución
                <input
                  type="text"
                  value={authForm.institution}
                  onChange={(event) => setAuthForm((current) => ({ ...current, institution: event.target.value }))}
                />
              </label>
              <button type="submit">Crear cuenta</button>
            </form>
          )}

          {error ? <p className="form-feedback">{error}</p> : null}
        </section>
      </div>
    );
  }

  const profile = portalData.profile;
  const isStaff = profile?.role === 'admin' || profile?.role === 'librarian';
  const summary = toSummary(filteredMaterials);

  return (
    <div className="portal-shell">
      <aside className="sidebar">
        <div>
          <div className="brand-block">
            <div className="brand-mark">S</div>
            <div>
              <strong>Saidy Library</strong>
              <span>Gestión híbrida</span>
            </div>
          </div>

          <nav className="section-nav">
            {sections.map((section) => (
              <button
                key={section.id}
                type="button"
                className={selectedSection === section.id ? 'is-active' : ''}
                onClick={() => setSelectedSection(section.id)}
              >
                <span>{section.label}</span>
                <small>{section.description}</small>
              </button>
            ))}
          </nav>
        </div>

        <button type="button" className="ghost-button" onClick={handleLogout}>
          Cerrar sesión
        </button>
      </aside>

      <main className="workspace">
        <header className="workspace-hero">
          <div>
            <div className="eyebrow">Portal operativo</div>
            <h1>{profile?.full_name || 'Usuario'} · {profile ? roleLabel[profile.role] : 'Miembro'}</h1>
            <p>
              {profile ? memberLabel[profile.member_type] : 'Usuario'} · préstamo máximo {profile?.loan_limit ?? 0} · reservas máximas{' '}
              {profile?.reservation_limit ?? 0}
            </p>
          </div>

          <div className="hero-actions">
            <button type="button" onClick={() => setSelectedSection('catalog')}>Ir al catálogo</button>
            <button type="button" className="secondary" onClick={() => setSelectedSection('circulation')}>
              Ver circulación
            </button>
          </div>
        </header>

        {error ? <div className="page-banner">{error}</div> : null}

        <section className="metrics-grid">
          <article className="metric-card">
            <span>Materiales</span>
            <strong>{portalData.overview?.materials ?? 0}</strong>
          </article>
          <article className="metric-card">
            <span>Préstamos</span>
            <strong>{portalData.overview?.loans ?? 0}</strong>
          </article>
          <article className="metric-card">
            <span>Reservas</span>
            <strong>{portalData.overview?.reservations ?? 0}</strong>
          </article>
          <article className="metric-card">
            <span>Copias</span>
            <strong>{portalData.overview?.copies ?? 0}</strong>
          </article>
        </section>

        {loadingData ? <div className="page-banner">Sincronizando datos con Supabase...</div> : null}

        {selectedSection === 'catalog' ? (
          <section className="content-grid">
            <div className="panel">
              <div className="panel__header">
                <div>
                  <span className="panel__eyebrow">Catálogo</span>
                  <h2>Materiales disponibles</h2>
                </div>
                <input
                  className="search-input"
                  type="search"
                  placeholder="Buscar por título, ISBN, DOI o palabra clave"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>

              <div className="summary-strip">
                {summary.map((item) => (
                  <article key={item.kind}>
                    <strong>{item.count}</strong>
                    <span>{item.kind.replaceAll('_', ' ')}</span>
                  </article>
                ))}
              </div>

              <div className="material-list">
                {filteredMaterials.map((material) => (
                  <button
                    key={material.id}
                    type="button"
                    className={selectedMaterialId === material.id ? 'material-card is-active' : 'material-card'}
                    onClick={() => setSelectedMaterialId(material.id)}
                  >
                    <div className="material-card__cover">
                      {material.cover_url ? <img src={material.cover_url} alt={material.title} /> : <span>{material.kind}</span>}
                    </div>
                    <div className="material-card__content">
                      <strong>{material.title}</strong>
                      <small>
                        {material.publisher || 'Sin editorial'} · {material.publication_year || 'Año no definido'}
                      </small>
                      <p>{material.summary || 'Sin resumen disponible'}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="panel panel--detail">
              <div className="panel__header">
                <div>
                  <span className="panel__eyebrow">Detalle</span>
                  <h2>Vista del ejemplar</h2>
                </div>
                {materialDetail ? (
                  <button type="button" onClick={() => handleReserve(materialDetail.id)}>
                    Reservar
                  </button>
                ) : null}
              </div>

              {materialDetail ? (
                <article className="detail-card">
                  <h3>{materialDetail.title}</h3>
                  <p>{materialDetail.summary || 'Sin resumen disponible'}</p>
                  <dl>
                    <div>
                      <dt>Tipo</dt>
                      <dd>{materialDetail.kind}</dd>
                    </div>
                    <div>
                      <dt>Idioma</dt>
                      <dd>{materialDetail.language || 'N/A'}</dd>
                    </div>
                    <div>
                      <dt>ISBN</dt>
                      <dd>{materialDetail.isbn || 'N/A'}</dd>
                    </div>
                    <div>
                      <dt>DOI</dt>
                      <dd>{materialDetail.doi || 'N/A'}</dd>
                    </div>
                  </dl>
                  <div className="tag-row">
                    {(materialDetail.material_tags ?? []).map((entry: any) => (
                      <span key={entry.tags?.name}>{entry.tags?.name}</span>
                    ))}
                  </div>
                  <div className="mini-list">
                    {(materialDetail.material_copies ?? []).map((copy: any) => (
                      <article key={copy.id}>
                        <strong>{copy.copy_code || copy.barcode || copy.id}</strong>
                        <span>{copy.status} · {copy.location || 'Sin ubicación'}</span>
                      </article>
                    ))}
                  </div>
                </article>
              ) : (
                <div className="empty-state">Selecciona un material para ver su detalle.</div>
              )}
            </div>
          </section>
        ) : null}

        {selectedSection === 'circulation' ? (
          <section className="content-grid">
            <div className="panel">
              <div className="panel__header">
                <div>
                  <span className="panel__eyebrow">Préstamos</span>
                  <h2>Actividad reciente</h2>
                </div>
              </div>

              <div className="mini-list">
                {portalData.loans.map((loan) => (
                  <article key={loan.id}>
                    <strong>{loan.materials.title}</strong>
                    <span>
                      {loan.status} · vence {formatDate(loan.due_at)}
                    </span>
                  </article>
                ))}
                {portalData.loans.length === 0 ? <div className="empty-state">No hay préstamos registrados.</div> : null}
              </div>
            </div>

            <div className="panel">
              <div className="panel__header">
                <div>
                  <span className="panel__eyebrow">Reservas</span>
                  <h2>Cola actual</h2>
                </div>
              </div>

              <div className="mini-list">
                {portalData.reservations.map((reservation) => (
                  <article key={reservation.id}>
                    <strong>{reservation.materials.title}</strong>
                    <span>
                      {reservation.status} · posición {reservation.queue_position}
                    </span>
                  </article>
                ))}
                {portalData.reservations.length === 0 ? <div className="empty-state">No hay reservas activas.</div> : null}
              </div>
            </div>

            <div className="panel panel--wide">
              <div className="panel__header">
                <div>
                  <span className="panel__eyebrow">Multas</span>
                  <h2>Estado financiero</h2>
                </div>
              </div>

              <div className="mini-list">
                {portalData.fines.map((fine) => (
                  <article key={fine.id}>
                    <strong>
                      {formatMoney(Number(fine.amount), fine.currency)}
                    </strong>
                    <span>
                      {fine.status} · {fine.reason || 'Sin detalle'} · emitida {formatDate(fine.issued_at)}
                    </span>
                  </article>
                ))}
                {portalData.fines.length === 0 ? <div className="empty-state">No hay multas registradas.</div> : null}
              </div>
            </div>
          </section>
        ) : null}

        {selectedSection === 'digital' ? (
          <section className="content-grid">
            <div className="panel panel--wide">
              <div className="panel__header">
                <div>
                  <span className="panel__eyebrow">Recursos digitales</span>
                  <h2>Biblioteca digital integrada</h2>
                </div>
              </div>

              <div className="mini-list">
                {portalData.digitalAssets.map((asset) => (
                  <article key={asset.id}>
                    <strong>{asset.materials.title}</strong>
                    <span>
                      {asset.asset_type} · expira {formatDate(asset.expires_at)}
                    </span>
                    <a href={asset.access_url} target="_blank" rel="noreferrer">
                      Abrir acceso
                    </a>
                  </article>
                ))}
                {portalData.digitalAssets.length === 0 ? <div className="empty-state">No hay recursos digitales cargados.</div> : null}
              </div>
            </div>
          </section>
        ) : null}

        {selectedSection === 'admin' ? (
          <section className="content-grid">
            <div className="panel">
              <div className="panel__header">
                <div>
                  <span className="panel__eyebrow">Analítica</span>
                  <h2>Resumen administrativo</h2>
                </div>
              </div>

              {isStaff && portalData.dashboard ? (
                <div className="metrics-grid metrics-grid--compact">
                  <article className="metric-card"><span>Materiales</span><strong>{portalData.dashboard.materials}</strong></article>
                  <article className="metric-card"><span>Reservas</span><strong>{portalData.dashboard.reservations}</strong></article>
                  <article className="metric-card"><span>Multas</span><strong>{portalData.dashboard.fines}</strong></article>
                  <article className="metric-card"><span>Inventario</span><strong>{portalData.dashboard.acquisitions}</strong></article>
                </div>
              ) : (
                <div className="empty-state">Solo bibliotecarios y administradores pueden ver este módulo.</div>
              )}
            </div>

            <div className="panel">
              <div className="panel__header">
                <div>
                  <span className="panel__eyebrow">Acceso</span>
                  <h2>Perfil y permisos</h2>
                </div>
              </div>
              {profile ? (
                <dl className="profile-list">
                  <div><dt>Correo</dt><dd>{profile.email}</dd></div>
                  <div><dt>Rol</dt><dd>{roleLabel[profile.role]}</dd></div>
                  <div><dt>Tipo</dt><dd>{memberLabel[profile.member_type]}</dd></div>
                  <div><dt>Digital</dt><dd>{profile.can_access_digital ? 'Permitido' : 'Bloqueado'}</dd></div>
                </dl>
              ) : null}
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}

export default App;

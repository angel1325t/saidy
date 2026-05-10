import { useEffect, useMemo, useState } from 'react';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase.js';
import { ApiError, apiFetch } from './lib/api.js';
import { AdminRbacPanel } from './components/AdminRbacPanel.js';
import { LibraryOperationsPanel } from './components/LibraryOperationsPanel.js';

type Section = 'catalog' | 'catalogLibrary' | 'circulation' | 'digital' | 'admin';

type RoleKey = 'ADMIN' | 'BIBLIOTECARIO' | 'DOCENTE' | 'INVESTIGADOR' | 'ESTUDIANTE';

type Role = {
  id: string;
  key: RoleKey;
  name: string;
  description: string | null;
};

type Permission = {
  id: string;
  key: string;
  name: string;
  description: string | null;
};

type Profile = {
  id: string;
  email: string;
  full_name: string;
  member_type: 'public' | 'student' | 'teacher' | 'researcher' | 'staff';
  blocked_until: string | null;
  can_access_digital: boolean;
  loan_limit: number;
  reservation_limit: number;
  institution: string | null;
  department: string | null;
  bio: string | null;
  avatar_url: string | null;
  phone: string | null;
  preferred_language: string;
  roles: Role[];
  permissions: Permission[];
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
  inventory: number;
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

type AdminSection = 'users' | 'roles' | 'permissions' | 'audit' | 'operations';

const sections: Array<{ id: Section; label: string; description: string; disabled?: boolean; badge?: string }> = [
  {
    id: 'catalog',
    label: 'Catalogo',
    description: 'Modulo de exploracion inicial',
    disabled: true,
    badge: 'En desarrollo'
  },
  {
    id: 'catalogLibrary',
    label: 'Catalogo Biblioteca',
    description: 'Catalogo principal del sistema'
  },
  {
    id: 'circulation',
    label: 'Circulacion',
    description: 'Prestamos, renovaciones y multas'
  },
  {
    id: 'digital',
    label: 'Digital',
    description: 'Acceso a materiales digitales'
  },
  {
    id: 'admin',
    label: 'Administracion',
    description: 'Usuarios, control y auditoria'
  }
];

const roleLabel: Record<RoleKey, string> = {
  ADMIN: 'Administrador',
  BIBLIOTECARIO: 'Bibliotecario',
  DOCENTE: 'Docente',
  INVESTIGADOR: 'Investigador',
  ESTUDIANTE: 'Estudiante'
};

const memberLabel: Record<Profile['member_type'], string> = {
  public: 'Publico',
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

function getKindLabel(kind: string) {
  return kind.replaceAll('_', ' ');
}

function getMaterialAuthor(material: Material) {
  return material.publisher || material.subtitle || 'Autor institucional';
}

function getMaterialCategory(material: Material) {
  return material.keywords?.[0] || getKindLabel(material.kind);
}

function getMaterialCode(material: Material) {
  return material.isbn || material.doi || material.id.slice(0, 8).toUpperCase();
}

function getMaterialAvailability(material: Material, reservations: Reservation[], loans: Loan[]) {
  const reserved = reservations.some((reservation) => reservation.materials.id === material.id && reservation.status !== 'cancelled');
  const loaned = loans.some((loan) => loan.materials.id === material.id && loan.status !== 'returned');

  if (reserved) return 'Alta demanda';
  if (loaned) return 'Prestado';
  if (material.digital_url) return 'Disponible digital';
  return 'Disponible';
}

function sliceMaterials(materials: Material[], count: number, offset = 0) {
  return materials.slice(offset, offset + count);
}

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [selectedSection, setSelectedSection] = useState<Section>('catalogLibrary');
  const [loadingData, setLoadingData] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [portalData, setPortalData] = useState<PortalData>(emptyData);
  const [search, setSearch] = useState('');
  const [selectedMaterialId, setSelectedMaterialId] = useState<string | null>(null);
  const [materialDetail, setMaterialDetail] = useState<any>(null);
  const [adminSection, setAdminSection] = useState<AdminSection>('users');
  const [authForm, setAuthForm] = useState({
    email: '',
    password: '',
    fullName: '',
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
    const handleUnauthorized = async (loadError: unknown) => {
      if (loadError instanceof ApiError && loadError.status === 401) {
        await supabase.auth.signOut();
        if (active) {
          setError('Tu sesion expiro. Inicia sesion nuevamente.');
        }
        return true;
      }

      return false;
    };

    const load = async () => {
      setLoadingData(true);
      setError(null);
      try {
        const token = session.access_token;
        const me = await apiFetch<{ profile: Profile }>('/api/auth/me', token);
        const [overview, materials, loans, reservations, fines, assets, dashboard] = await Promise.allSettled([
          apiFetch<Overview>('/api/catalog/overview', token),
          apiFetch<{ items: Material[] }>('/api/catalog/materials?page=1&limit=18', token),
          apiFetch<{ items: Loan[] }>('/api/circulation/loans', token),
          apiFetch<{ items: Reservation[] }>('/api/circulation/reservations', token),
          apiFetch<{ items: Fine[] }>('/api/circulation/fines', token),
          apiFetch<{ items: DigitalAsset[] }>('/api/digital/assets', token),
          apiFetch<AdminDashboard>('/api/admin/dashboard', token)
        ]);

        if (!active) return;

        setPortalData({
          profile: me.profile,
          overview: overview.status === 'fulfilled' ? overview.value : null,
          materials: materials.status === 'fulfilled' ? materials.value.items : [],
          loans: loans.status === 'fulfilled' ? loans.value.items : [],
          reservations: reservations.status === 'fulfilled' ? reservations.value.items : [],
          fines: fines.status === 'fulfilled' ? fines.value.items : [],
          digitalAssets: assets.status === 'fulfilled' ? assets.value.items : [],
          dashboard: dashboard.status === 'fulfilled' ? dashboard.value : null
        });
        setSelectedMaterialId(materials.status === 'fulfilled' ? materials.value.items[0]?.id ?? null : null);

        const firstFailure =
          [overview, materials, loans, reservations, fines, assets, dashboard].find(
            (result) => result.status === 'rejected'
          ) ?? null;
        if (firstFailure?.status === 'rejected') {
          if (await handleUnauthorized(firstFailure.reason)) return;
          setError(
            firstFailure.reason instanceof Error
              ? firstFailure.reason.message
              : 'Algunos modulos no se pudieron cargar'
          );
        }
      } catch (loadError) {
        if (!active) return;
        if (await handleUnauthorized(loadError)) return;
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
  }, [session, refreshTick]);

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

  const popularMaterials = useMemo(() => sliceMaterials(filteredMaterials, 4), [filteredMaterials]);
  const newArrivals = useMemo(() => sliceMaterials(filteredMaterials, 4, 4), [filteredMaterials]);
  const recommendedMaterials = useMemo(() => sliceMaterials(filteredMaterials, 4, 8), [filteredMaterials]);
  const highlightedCategories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const material of filteredMaterials) {
      const category = getMaterialCategory(material);
      counts.set(category, (counts.get(category) ?? 0) + 1);
    }

    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([label, count]) => ({ label, count }));
  }, [filteredMaterials]);

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
          member_type: 'student',
          institution: authForm.institution
        }
      }
    });

    if (signUpError) {
      setError(signUpError.message);
    } else {
      setAuthMode('login');
      setError('Revisa tu correo para confirmar la cuenta si la verificacion esta activa.');
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const handleRefreshProfile = () => {
    setRefreshTick((current) => current + 1);
  };

  const handleUnauthorized = async () => {
    await supabase.auth.signOut();
    setError('Tu sesion expiro. Inicia sesion nuevamente.');
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
      if (reserveError instanceof ApiError && reserveError.status === 401) {
        await supabase.auth.signOut();
        setError('Tu sesion expiro. Inicia sesion nuevamente.');
        return;
      }
      setError(reserveError instanceof Error ? reserveError.message : 'No se pudo reservar el material');
    }
  };

  const handleLoanAction = async (loanId: string, action: 'renew' | 'return') => {
    if (!session) return;
    setError(null);

    try {
      await apiFetch(`/api/circulation/loans/${loanId}/${action}`, session.access_token, { method: 'POST' });
      setRefreshTick((current) => current + 1);
    } catch (loanError) {
      if (loanError instanceof ApiError && loanError.status === 401) {
        await supabase.auth.signOut();
        setError('Tu sesion expiro. Inicia sesion nuevamente.');
        return;
      }
      setError(loanError instanceof Error ? loanError.message : 'No se pudo actualizar el prestamo');
    }
  };

  const handleCancelReservation = async (reservationId: string) => {
    if (!session) return;
    setError(null);

    try {
      await apiFetch(`/api/circulation/reservations/${reservationId}/cancel`, session.access_token, { method: 'POST' });
      setRefreshTick((current) => current + 1);
    } catch (reservationError) {
      if (reservationError instanceof ApiError && reservationError.status === 401) {
        await supabase.auth.signOut();
        setError('Tu sesion expiro. Inicia sesion nuevamente.');
        return;
      }
      setError(reservationError instanceof Error ? reservationError.message : 'No se pudo cancelar la reserva');
    }
  };

  const handlePayFine = async (fineId: string) => {
    if (!session) return;
    setError(null);

    try {
      await apiFetch(`/api/circulation/fines/${fineId}/pay`, session.access_token, { method: 'POST' });
      setRefreshTick((current) => current + 1);
    } catch (fineError) {
      if (fineError instanceof ApiError && fineError.status === 401) {
        await supabase.auth.signOut();
        setError('Tu sesion expiro. Inicia sesion nuevamente.');
        return;
      }
      setError(fineError instanceof Error ? fineError.message : 'No se pudo actualizar la multa');
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
          <h1>Biblioteca hibrida con control de catalogo, circulacion y digital.</h1>
          <p>
            Un portal monocromo, limpio y preparado para administrar materiales fisicos y digitales
            con Supabase como backend.
          </p>

          <div className="hero-metrics">
            <article>
              <strong>Catalogo</strong>
              <span>Material fisico + digital</span>
            </article>
            <article>
              <strong>Prestamos</strong>
              <span>Renovaciones, reservas y multas</span>
            </article>
            <article>
              <strong>Admin</strong>
              <span>Inventario y analitica</span>
            </article>
          </div>
        </section>

        <section className="auth-card">
          <div className="auth-card__tabs">
            <button type="button" className={authMode === 'login' ? 'is-active' : ''} onClick={() => setAuthMode('login')}>
              Iniciar sesion
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
                  autoComplete="email"
                  value={authForm.email}
                  onChange={(event) => setAuthForm((current) => ({ ...current, email: event.target.value }))}
                  required
                />
              </label>
              <label>
                Contrasena
                <input
                  type="password"
                  autoComplete="current-password"
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
                  autoComplete="name"
                  value={authForm.fullName}
                  onChange={(event) => setAuthForm((current) => ({ ...current, fullName: event.target.value }))}
                  required
                />
              </label>
              <label>
                Correo
                <input
                  type="email"
                  autoComplete="email"
                  value={authForm.email}
                  onChange={(event) => setAuthForm((current) => ({ ...current, email: event.target.value }))}
                  required
                />
              </label>
              <label>
                Contrasena
                <input
                  type="password"
                  minLength={6}
                  autoComplete="new-password"
                  value={authForm.password}
                  onChange={(event) => setAuthForm((current) => ({ ...current, password: event.target.value }))}
                  required
                />
              </label>
              <label>
                Institucion
                <input
                  type="text"
                  autoComplete="organization"
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
  const activeEmail = session?.user.email || profile?.email || 'N/A';
  const activeUserId = session?.user.id || profile?.id || 'N/A';
  const isAdmin = profile?.roles.some((role) => role.key === 'ADMIN') ?? false;
  const isStaff =
    isAdmin ||
    profile?.roles.some((role) => role.key === 'BIBLIOTECARIO') ||
    profile?.permissions.some((permission) => permission.key === 'dashboard:view') ||
    false;
  const roleSummary = profile?.roles.map((role) => roleLabel[role.key]).join(' · ') || 'Miembro';
  const permissionSummary = profile?.permissions.length ?? 0;

  return (
    <div className="portal-shell">
      <aside className="sidebar">
        <div className="sidebar__top">
          <div className="brand-block">
            <div className="brand-mark">S</div>
            <div>
              <strong>Saidy Library</strong>
              <span>Gestion hibrida</span>
            </div>
          </div>

          <nav className="section-nav">
            {sections.map((section) => (
              <button
                key={section.id}
                type="button"
                className={[
                  selectedSection === section.id ? 'is-active' : '',
                  section.disabled ? 'is-disabled' : ''
                ].join(' ').trim()}
                onClick={() => setSelectedSection(section.id)}
              >
                <span className="section-nav__line">
                  <strong>{section.label}</strong>
                  {section.badge ? <em className="nav-badge">{section.badge}</em> : null}
                </span>
                <small>{section.description}</small>
              </button>
            ))}
          </nav>
        </div>

        <button type="button" className="ghost-button sidebar__logout" onClick={handleLogout}>
          Cerrar sesion
        </button>
      </aside>

      <main className="workspace">
        <header className="workspace-hero">
          <div>
            <div className="eyebrow">Portal operativo</div>
            <h1>{profile?.full_name || 'Usuario'} · {roleSummary}</h1>
            <p>
              {profile ? memberLabel[profile.member_type] : 'Usuario'} · prestamo maximo {profile?.loan_limit ?? 0} · reservas maximas{' '}
              {profile?.reservation_limit ?? 0}
            </p>
          </div>

          <div className="hero-actions">
            <button type="button" onClick={() => setSelectedSection('catalogLibrary')}>Ir al catalogo principal</button>
            <button type="button" className="secondary" onClick={() => setSelectedSection('circulation')}>
              Ver circulacion
            </button>
            <button type="button" className="secondary" onClick={handleRefreshProfile}>
              Recargar perfil
            </button>
          </div>
        </header>

        {error ? <div className="page-banner">{error}</div> : null}
        {loadingData ? <div className="page-banner">Sincronizando datos con Supabase...</div> : null}

        <section className="metrics-grid">
          <article className="metric-card">
            <span>Materiales</span>
            <strong>{portalData.overview?.materials ?? 0}</strong>
          </article>
          <article className="metric-card">
            <span>Prestamos</span>
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

        {selectedSection === 'catalog' ? (
          <section className="content-grid">
            <div className="panel panel--muted">
              <div className="panel__header">
                <div>
                  <span className="panel__eyebrow">Catalogo</span>
                  <h2>Modulo en desarrollo</h2>
                </div>
                <span className="status-pill">En desarrollo</span>
              </div>

              <div className="disabled-module">
                <div className="disabled-module__hero">
                  <strong>Este espacio se mantiene reservado para futuras iteraciones.</strong>
                  <p>
                    La navegacion principal del sistema ahora vive en <strong>Catalogo Biblioteca</strong>,
                    con una experiencia mas organizada, premium y enfocada en descubrimiento.
                  </p>
                </div>

                <div className="disabled-module__grid">
                  <article className="placeholder-card">
                    <span className="placeholder-card__title">Vista preliminar</span>
                    <p>Busquedas generales, exploracion basica y estados iniciales.</p>
                  </article>
                  <article className="placeholder-card">
                    <span className="placeholder-card__title">Estructura preservada</span>
                    <p>Se conserva como modulo simple y visualmente deshabilitado.</p>
                  </article>
                </div>
              </div>
            </div>
          </section>
        ) : null}

        {selectedSection === 'catalogLibrary' ? (
          <section className="library-catalog">
            <div className="library-catalog__main">
              <section className="panel library-hero">
                <div className="library-hero__header">
                  <div>
                    <span className="panel__eyebrow">Catalogo Biblioteca</span>
                    <h2>Exploracion curada de la coleccion principal</h2>
                    <p>
                      Descubre materiales fisicos y digitales en una vista limpia, profesional y orientada a decision rapida.
                    </p>
                  </div>
                  <div className="library-hero__actions">
                    <button type="button" className="secondary">Categorias</button>
                  </div>
                </div>

                <div className="library-toolbar">
                  <input
                    className="search-input library-search"
                    type="search"
                    placeholder="Buscar por titulo, autor, ISBN, DOI o palabra clave"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                  <div className="filter-pills">
                    <span className="filter-pill is-active">Todos</span>
                    <span className="filter-pill">Disponibles</span>
                    <span className="filter-pill">Fisicos</span>
                    <span className="filter-pill">Digitales</span>
                    <span className="filter-pill">Nuevos</span>
                  </div>
                </div>
              </section>

              <section className="panel">
                <div className="panel__header">
                  <div>
                    <span className="panel__eyebrow">Coleccion principal</span>
                    <h2>Grid de libros</h2>
                  </div>
                  <span className="status-pill">{filteredMaterials.length} registros</span>
                </div>

                <div className="book-grid">
                  {filteredMaterials.map((material) => {
                    const isActive = selectedMaterialId === material.id;
                    const availability = getMaterialAvailability(material, portalData.reservations, portalData.loans);
                    return (
                      <article key={material.id} className={isActive ? 'book-card is-active' : 'book-card'}>
                        <button type="button" className="book-card__main" onClick={() => setSelectedMaterialId(material.id)}>
                          <div className="book-card__cover">
                            {material.cover_url ? <img src={material.cover_url} alt={material.title} /> : <span>{getKindLabel(material.kind)}</span>}
                          </div>
                          <div className="book-card__content">
                            <div className="book-card__meta">
                              <span className="status-pill">{availability}</span>
                              <span className="soft-pill">{getMaterialCategory(material)}</span>
                            </div>
                            <strong>{material.title}</strong>
                            <p>{getMaterialAuthor(material)}</p>
                            <dl className="book-card__details">
                              <div>
                                <dt>Categoria</dt>
                                <dd>{getKindLabel(material.kind)}</dd>
                              </div>
                              <div>
                                <dt>Codigo</dt>
                                <dd>{getMaterialCode(material)}</dd>
                              </div>
                            </dl>
                            <div className="tag-row">
                              {(material.keywords ?? [getMaterialCategory(material)]).slice(0, 3).map((tag) => (
                                <span key={tag}>{tag}</span>
                              ))}
                            </div>
                          </div>
                        </button>
                        <div className="book-card__footer">
                          <button type="button" onClick={() => handleReserve(material.id)}>Reservar</button>
                          <button type="button" className="secondary" onClick={() => setSelectedMaterialId(material.id)}>
                            Ver detalles
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>

              <section className="section-stack">
                <article className="panel">
                  <div className="panel__header">
                    <div>
                      <span className="panel__eyebrow">Libros populares</span>
                      <h2>Seleccion con mayor demanda</h2>
                    </div>
                  </div>
                  <div className="feature-strip">
                    {popularMaterials.map((material) => (
                      <button key={material.id} type="button" className="feature-card" onClick={() => setSelectedMaterialId(material.id)}>
                        <strong>{material.title}</strong>
                        <p>{getMaterialAuthor(material)}</p>
                        <span>{getMaterialAvailability(material, portalData.reservations, portalData.loans)}</span>
                      </button>
                    ))}
                  </div>
                </article>

                <article className="panel">
                  <div className="panel__header">
                    <div>
                      <span className="panel__eyebrow">Nuevos ingresos</span>
                      <h2>Recien incorporados</h2>
                    </div>
                  </div>
                  <div className="feature-strip">
                    {newArrivals.map((material) => (
                      <button key={material.id} type="button" className="feature-card" onClick={() => setSelectedMaterialId(material.id)}>
                        <strong>{material.title}</strong>
                        <p>{material.publication_year || 'Ano no definido'} · {getKindLabel(material.kind)}</p>
                        <span>Ingreso reciente</span>
                      </button>
                    ))}
                  </div>
                </article>
              </section>

              <section className="section-stack section-stack--triple">
                <article className="panel">
                  <div className="panel__header">
                    <div>
                      <span className="panel__eyebrow">Recomendados</span>
                      <h2>Curaduria institucional</h2>
                    </div>
                  </div>
                  <div className="mini-list">
                    {recommendedMaterials.map((material) => (
                      <article key={material.id}>
                        <strong>{material.title}</strong>
                        <span>{getMaterialCategory(material)} · {getMaterialAuthor(material)}</span>
                      </article>
                    ))}
                  </div>
                </article>

                <article className="panel">
                  <div className="panel__header">
                    <div>
                      <span className="panel__eyebrow">Material digital</span>
                      <h2>Acceso destacado</h2>
                    </div>
                  </div>
                  <div className="mini-list">
                    {portalData.digitalAssets.slice(0, 4).map((asset) => (
                      <article key={asset.id}>
                        <strong>{asset.materials.title}</strong>
                        <span>{asset.asset_type} · expira {formatDate(asset.expires_at)}</span>
                      </article>
                    ))}
                    {portalData.digitalAssets.length === 0 ? <div className="empty-state">No hay recursos digitales cargados.</div> : null}
                  </div>
                </article>

                <article className="panel">
                  <div className="panel__header">
                    <div>
                      <span className="panel__eyebrow">Categorias destacadas</span>
                      <h2>Mapa tematico</h2>
                    </div>
                  </div>
                  <div className="category-cloud">
                    {highlightedCategories.map((category) => (
                      <article key={category.label} className="category-cloud__item">
                        <strong>{category.label}</strong>
                        <span>{category.count} materiales</span>
                      </article>
                    ))}
                  </div>
                </article>
              </section>

            </div>

            <aside className="library-catalog__side">
              <section className="panel side-panel">
                <div className="panel__header">
                  <div>
                    <span className="panel__eyebrow">Filtros</span>
                    <h2>Busqueda avanzada</h2>
                  </div>
                </div>
                <div className="side-panel__group">
                  <strong>Categorias</strong>
                  <div className="filter-pills filter-pills--stacked">
                    {highlightedCategories.map((category) => (
                      <span key={category.label} className="filter-pill">{category.label}</span>
                    ))}
                  </div>
                </div>
                <div className="side-panel__group">
                  <strong>Disponibilidad</strong>
                  <div className="mini-stat-list">
                    <article><span>Disponibles</span><strong>{filteredMaterials.length}</strong></article>
                    <article><span>Prestados</span><strong>{portalData.loans.length}</strong></article>
                    <article><span>Digitales</span><strong>{portalData.digitalAssets.length}</strong></article>
                  </div>
                </div>
                <div className="side-panel__group">
                  <strong>Busqueda rapida</strong>
                  <div className="mini-list">
                    <article><strong>Autor</strong><span>Editoriales y autores institucionales</span></article>
                    <article><strong>Codigo</strong><span>ISBN, DOI o identificador interno</span></article>
                    <article><strong>Tipo</strong><span>Fisico, digital y material especializado</span></article>
                  </div>
                </div>
              </section>

              <section className="panel side-panel">
                <div className="panel__header">
                  <div>
                    <span className="panel__eyebrow">Detalle</span>
                    <h2>Vista seleccionada</h2>
                  </div>
                </div>

                {materialDetail ? (
                  <article className="detail-card">
                    <h3>{materialDetail.title}</h3>
                    <p>{materialDetail.summary || 'Sin resumen disponible.'}</p>
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
                          <span>{copy.status} · {copy.location || 'Sin ubicacion'}</span>
                        </article>
                      ))}
                    </div>
                  </article>
                ) : (
                  <div className="empty-state">Selecciona un material para ver su detalle.</div>
                )}
              </section>
            </aside>

            {isStaff ? (
              <section className="panel panel--wide library-catalog__full">
                <div className="panel__header">
                  <div>
                    <span className="panel__eyebrow">Gestion de catalogo</span>
                    <h2>Administracion operativa del catalogo</h2>
                  </div>
                </div>
                <LibraryOperationsPanel
                  token={session.access_token}
                  roleKeys={profile?.roles.map((role) => role.key) ?? []}
                  permissions={profile?.permissions.map((permission) => permission.key) ?? []}
                  onChanged={handleRefreshProfile}
                  onUnauthorized={handleUnauthorized}
                  activeSection="catalog"
                  showTabs={false}
                />
              </section>
            ) : null}
          </section>
        ) : null}

        {selectedSection === 'circulation' ? (
          <section className="content-grid">
            <div className="panel">
              <div className="panel__header">
                <div>
                  <span className="panel__eyebrow">Prestamos</span>
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
                    <div className="badge-row">
                      <button type="button" className="badge" onClick={() => handleLoanAction(loan.id, 'renew')}>
                        Renovar
                      </button>
                      <button type="button" className="badge" onClick={() => handleLoanAction(loan.id, 'return')}>
                        Devolver
                      </button>
                    </div>
                  </article>
                ))}
                {portalData.loans.length === 0 ? <div className="empty-state">No hay prestamos registrados.</div> : null}
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
                      {reservation.status} · posicion {reservation.queue_position}
                    </span>
                    <button type="button" className="badge" onClick={() => handleCancelReservation(reservation.id)}>
                      Cancelar
                    </button>
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
                    <strong>{formatMoney(Number(fine.amount), fine.currency)}</strong>
                    <span>
                      {fine.status} · {fine.reason || 'Sin detalle'} · emitida {formatDate(fine.issued_at)}
                    </span>
                    {isStaff ? (
                      <button type="button" className="badge" onClick={() => handlePayFine(fine.id)}>
                        Marcar pagada
                      </button>
                    ) : null}
                  </article>
                ))}
                {portalData.fines.length === 0 ? <div className="empty-state">No hay multas registradas.</div> : null}
              </div>
            </div>

            {isStaff ? (
              <div className="panel panel--wide">
                <div className="panel__header">
                  <div>
                    <span className="panel__eyebrow">Gestion de circulacion</span>
                    <h2>Operacion de prestamos, reservas y multas</h2>
                  </div>
                </div>
                <LibraryOperationsPanel
                  token={session.access_token}
                  roleKeys={profile?.roles.map((role) => role.key) ?? []}
                  permissions={profile?.permissions.map((permission) => permission.key) ?? []}
                  onChanged={handleRefreshProfile}
                  onUnauthorized={handleUnauthorized}
                  activeSection="circulation"
                  showTabs={false}
                />
              </div>
            ) : null}
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
          <section className="admin-dashboard">
            <section className="admin-overview">
              <article className="panel panel--wide">
                <div className="panel__header">
                  <div>
                    <span className="panel__eyebrow">Administracion</span>
                    <h2>Control administrativo y operativo</h2>
                  </div>
                </div>

                {isStaff && portalData.dashboard ? (
                  <div className="metrics-grid admin-metrics">
                    <article className="metric-card"><span>Usuarios</span><strong>{permissionSummary}</strong></article>
                    <article className="metric-card"><span>Materiales</span><strong>{portalData.dashboard.materials}</strong></article>
                    <article className="metric-card"><span>Prestamos</span><strong>{portalData.dashboard.loans}</strong></article>
                    <article className="metric-card"><span>Reservas</span><strong>{portalData.dashboard.reservations}</strong></article>
                    <article className="metric-card"><span>Multas</span><strong>{portalData.dashboard.fines}</strong></article>
                    <article className="metric-card"><span>Auditoria</span><strong>{portalData.dashboard.notifications}</strong></article>
                  </div>
                ) : (
                  <div className="empty-state">Solo bibliotecarios y administradores pueden ver este modulo.</div>
                )}
              </article>

              <div className="admin-info-grid">
                <article className="panel">
                  <div className="panel__header">
                    <div>
                      <span className="panel__eyebrow">Sesion activa</span>
                      <h2>Contexto de acceso</h2>
                    </div>
                  </div>
                  <dl className="profile-list profile-list--stacked">
                    <div><dt>Email de sesion</dt><dd>{activeEmail}</dd></div>
                    <div><dt>ID de sesion</dt><dd>{activeUserId}</dd></div>
                    <div><dt>Estado</dt><dd>{isAdmin ? 'ADMIN' : 'Usuario normal'}</dd></div>
                  </dl>
                </article>

                <article className="panel">
                  <div className="panel__header">
                    <div>
                      <span className="panel__eyebrow">Roles</span>
                      <h2>Jerarquia del perfil</h2>
                    </div>
                  </div>
                  <dl className="profile-list profile-list--stacked">
                    <div><dt>Roles detectados</dt><dd>{profile?.roles.length ? profile.roles.map((role) => roleLabel[role.key]).join(', ') : 'Sin rol cargado'}</dd></div>
                    <div><dt>Permisos</dt><dd>{profile?.permissions.length ?? 0}</dd></div>
                    <div><dt>Acceso digital</dt><dd>{profile?.can_access_digital ? 'Permitido' : 'Bloqueado'}</dd></div>
                  </dl>
                </article>

                <article className="panel">
                  <div className="panel__header">
                    <div>
                      <span className="panel__eyebrow">Perfil</span>
                      <h2>Datos institucionales</h2>
                    </div>
                  </div>
                  <dl className="profile-list profile-list--stacked">
                    <div><dt>Correo</dt><dd>{profile?.email || 'N/A'}</dd></div>
                    <div><dt>Tipo</dt><dd>{profile ? memberLabel[profile.member_type] : 'N/A'}</dd></div>
                    <div><dt>Institucion</dt><dd>{profile?.institution || 'No registrada'}</dd></div>
                  </dl>
                </article>
              </div>

              {profile && activeEmail !== profile.email ? (
                <div className="page-banner">La sesion activa y el perfil cargado no coinciden. Recarga o vuelve a iniciar sesion.</div>
              ) : null}
            </section>

            <section className="admin-section-shell">
              <article className="panel panel--wide admin-section-intro">
                <div className="admin-section-tabs">
                  <button type="button" className={adminSection === 'users' ? 'admin-section-chip is-active' : 'admin-section-chip'} onClick={() => setAdminSection('users')}><strong>Usuarios</strong><span>Directorio institucional y asignaciones</span></button>
                  <button type="button" className={adminSection === 'roles' ? 'admin-section-chip is-active' : 'admin-section-chip'} onClick={() => setAdminSection('roles')}><strong>Roles</strong><span>Jerarquia operativa y alcance</span></button>
                  <button type="button" className={adminSection === 'permissions' ? 'admin-section-chip is-active' : 'admin-section-chip'} onClick={() => setAdminSection('permissions')}><strong>Permisos</strong><span>Control de acciones sensibles</span></button>
                  <button type="button" className={adminSection === 'audit' ? 'admin-section-chip is-active' : 'admin-section-chip'} onClick={() => setAdminSection('audit')}><strong>Auditoria</strong><span>Trazabilidad y evidencia operativa</span></button>
                  <button type="button" className={adminSection === 'operations' ? 'admin-section-chip is-active' : 'admin-section-chip'} onClick={() => setAdminSection('operations')}><strong>Operacion</strong><span>Inventario, reportes y notificaciones</span></button>
                </div>
              </article>

              {adminSection === 'users' || adminSection === 'roles' || adminSection === 'permissions' || adminSection === 'audit' ? (
                <AdminRbacPanel
                  token={session.access_token}
                  roleKeys={profile?.roles.map((role) => role.key) ?? []}
                  permissions={profile?.permissions.map((permission) => permission.key) ?? []}
                  activeSection={adminSection}
                  showTabs={false}
                />
              ) : null}

              {adminSection === 'operations' ? (
                <LibraryOperationsPanel
                  token={session.access_token}
                  roleKeys={profile?.roles.map((role) => role.key) ?? []}
                  permissions={profile?.permissions.map((permission) => permission.key) ?? []}
                  onChanged={handleRefreshProfile}
                  onUnauthorized={handleUnauthorized}
                  activeSection="admin"
                  showTabs={false}
                />
              ) : null}
            </section>
          </section>
        ) : null}
      </main>
    </div>
  );
}

export default App;

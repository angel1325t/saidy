import { useEffect, useMemo, useState } from 'react';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase.js';
import { ApiError, apiFetch } from './lib/api.js';
import { AdminRbacPanel } from './components/AdminRbacPanel.js';
import { LibraryOperationsPanel } from './components/LibraryOperationsPanel.js';

type Section = 'home' | 'catalog' | 'circulation' | 'digital' | 'admin';

type ThemeMode = 'light' | 'dark';

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

const sections: Array<{ id: Section; label: string; description: string }> = [
  { id: 'home', label: 'Inicio', description: 'Búsqueda, destacados y atajos' },
  { id: 'catalog', label: 'Catálogo', description: 'Buscar y reservar materiales' },
  { id: 'circulation', label: 'Circulación', description: 'Préstamos, renovaciones y multas' },
  { id: 'digital', label: 'Digital', description: 'Acceso a materiales digitales' },
  { id: 'admin', label: 'Administración', description: 'Inventario, adquisiciones y analítica' }
];

const roleLabel: Record<RoleKey, string> = {
  ADMIN: 'Administrador',
  BIBLIOTECARIO: 'Bibliotecario',
  DOCENTE: 'Docente',
  INVESTIGADOR: 'Investigador',
  ESTUDIANTE: 'Estudiante'
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

function readInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light';

  const stored = window.localStorage.getItem('saidy_theme');
  if (stored === 'light' || stored === 'dark') return stored;

  if (window.matchMedia?.('(prefers-color-scheme: dark)')?.matches) {
    return 'dark';
  }

  return 'light';
}

function ThemeIcon({ mode }: { mode: ThemeMode }) {
  if (mode === 'dark') {
    return (
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path
          fill="currentColor"
          d="M12 17a5 5 0 1 1 0-10 5 5 0 0 1 0 10Zm0-12.75a.9.9 0 0 1 .9.9v1.1a.9.9 0 1 1-1.8 0v-1.1a.9.9 0 0 1 .9-.9Zm0 16.4a.9.9 0 0 1 .9.9v1.1a.9.9 0 1 1-1.8 0v-1.1a.9.9 0 0 1 .9-.9Zm8.5-8.5a.9.9 0 0 1 .9.9.9.9 0 0 1-.9.9h-1.1a.9.9 0 1 1 0-1.8h1.1ZM4.7 12a.9.9 0 0 1-.9.9H2.7a.9.9 0 1 1 0-1.8h1.1a.9.9 0 0 1 .9.9Zm13.55-6.25a.9.9 0 0 1 1.27 0 .9.9 0 0 1 0 1.27l-.78.78a.9.9 0 1 1-1.27-1.27l.78-.78ZM5.48 18.52a.9.9 0 0 1 1.27 0 .9.9 0 0 1 0 1.27l-.78.78a.9.9 0 1 1-1.27-1.27l.78-.78Zm13.04 1.27a.9.9 0 0 1-1.27 0l-.78-.78a.9.9 0 1 1 1.27-1.27l.78.78a.9.9 0 0 1 0 1.27ZM6.75 6.75a.9.9 0 0 1-1.27 0l-.78-.78a.9.9 0 1 1 1.27-1.27l.78.78a.9.9 0 0 1 0 1.27Z"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        fill="currentColor"
        d="M21.5 14.8c-1.13.52-2.38.82-3.7.82-4.6 0-8.33-3.73-8.33-8.33 0-1.33.3-2.58.82-3.71a.9.9 0 0 0-1.1-1.25 10.2 10.2 0 1 0 13.56 13.56.9.9 0 0 0-1.25-1.1Zm-9.24 6.03A8.4 8.4 0 0 1 7.9 4.95a10.12 10.12 0 0 0 9.9 12.16 8.38 8.38 0 0 1-5.54 3.72Z"
      />
    </svg>
  );
}

function BooksIllustration() {
  return (
    <svg viewBox="0 0 640 480" role="img" aria-label="Ilustración de libros apilados">
      <rect x="0" y="0" width="640" height="480" rx="28" fill="none" />
      <g opacity="0.9">
        <path d="M108 132c10-24 38-40 68-34 16 3 30 12 38 25" stroke="rgba(29,78,216,0.28)" strokeWidth="10" strokeLinecap="round" />
        <path d="M530 122c-10-24-38-40-68-34-16 3-30 12-38 25" stroke="rgba(16,185,129,0.22)" strokeWidth="10" strokeLinecap="round" />
        <path d="M466 194l12 12 20-20" stroke="rgba(99,102,241,0.35)" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
      </g>

      <g transform="translate(210 98)">
        <ellipse cx="112" cy="298" rx="180" ry="42" fill="rgba(15,23,42,0.08)" />

        <g>
          <rect x="-10" y="240" width="244" height="64" rx="18" fill="#1d4ed8" />
          <rect x="8" y="252" width="210" height="10" rx="5" fill="rgba(255,255,255,0.7)" />
          <rect x="8" y="270" width="160" height="10" rx="5" fill="rgba(255,255,255,0.45)" />
        </g>

        <g>
          <rect x="6" y="190" width="256" height="58" rx="18" fill="#f59e0b" />
          <rect x="22" y="202" width="210" height="10" rx="5" fill="rgba(255,255,255,0.72)" />
          <rect x="22" y="220" width="146" height="10" rx="5" fill="rgba(255,255,255,0.46)" />
        </g>

        <g>
          <rect x="-26" y="140" width="274" height="58" rx="18" fill="#10b981" />
          <rect x="-6" y="152" width="216" height="10" rx="5" fill="rgba(255,255,255,0.72)" />
          <rect x="-6" y="170" width="178" height="10" rx="5" fill="rgba(255,255,255,0.46)" />
        </g>

        <g>
          <rect x="18" y="92" width="236" height="54" rx="18" fill="#a855f7" />
          <rect x="36" y="104" width="190" height="10" rx="5" fill="rgba(255,255,255,0.72)" />
          <rect x="36" y="122" width="124" height="10" rx="5" fill="rgba(255,255,255,0.46)" />
        </g>

        <g>
          <rect x="-10" y="46" width="252" height="52" rx="18" fill="#ef4444" />
          <rect x="10" y="58" width="202" height="10" rx="5" fill="rgba(255,255,255,0.72)" />
          <rect x="10" y="76" width="150" height="10" rx="5" fill="rgba(255,255,255,0.46)" />
        </g>

        <g transform="translate(260 252)">
          <rect x="0" y="0" width="86" height="98" rx="18" fill="#e2e8f0" stroke="rgba(15,23,42,0.12)" strokeWidth="3" />
          <path d="M18 78c8-14 18-22 26-22s18 8 26 22" fill="none" stroke="#10b981" strokeWidth="7" strokeLinecap="round" />
          <rect x="22" y="28" width="42" height="36" rx="18" fill="#34d399" opacity="0.35" />
          <rect x="14" y="70" width="58" height="10" rx="5" fill="rgba(15,23,42,0.12)" />
        </g>
      </g>
    </svg>
  );
}

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [selectedSection, setSelectedSection] = useState<Section>('home');
  const [loadingData, setLoadingData] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [portalData, setPortalData] = useState<PortalData>(emptyData);
  const [search, setSearch] = useState('');
  const [selectedMaterialId, setSelectedMaterialId] = useState<string | null>(null);
  const [materialDetail, setMaterialDetail] = useState<any>(null);
  const [themeMode, setThemeMode] = useState<ThemeMode>(readInitialTheme);
  const [authForm, setAuthForm] = useState({
    email: '',
    password: '',
    fullName: '',
    institution: ''
  });

  const toggleTheme = () => {
    setThemeMode((mode) => (mode === 'dark' ? 'light' : 'dark'));
  };

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    try {
      window.localStorage.setItem('saidy_theme', themeMode);
    } catch {
      // ignore
    }
  }, [themeMode]);

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
    const handleUnauthorized = async (error: unknown) => {
      if (error instanceof ApiError && error.status === 401) {
        await supabase.auth.signOut();
        if (active) {
          setError('Tu sesión expiró. Inicia sesión nuevamente.');
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
          apiFetch<{ items: Material[] }>('/api/catalog/materials?page=1&limit=12', token),
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
              : 'Algunos módulos no se pudieron cargar'
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

  useEffect(() => {
    if (!session) return;

    const profile = portalData.profile;
    const isAdmin = profile?.roles.some((role) => role.key === 'ADMIN') ?? false;
    const isStaff =
      isAdmin ||
      profile?.roles.some((role) => role.key === 'BIBLIOTECARIO') ||
      profile?.permissions.some((permission) => permission.key === 'dashboard:view') ||
      false;
    const canAccessDigital = profile?.can_access_digital ?? false;

    const visibleSections = sections.filter((section) => {
      if (section.id === 'admin') return isStaff;
      if (section.id === 'digital') return canAccessDigital;
      return true;
    });

    if (!visibleSections.some((section) => section.id === selectedSection)) {
      setSelectedSection('catalog');
    }
  }, [session, portalData.profile, selectedSection]);

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
          member_type: 'student',
          institution: authForm.institution
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

  const handleRefreshProfile = () => {
    setRefreshTick((current) => current + 1);
  };

  const handleUnauthorized = async () => {
    await supabase.auth.signOut();
    setError('Tu sesión expiró. Inicia sesión nuevamente.');
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
        setError('Tu sesión expiró. Inicia sesión nuevamente.');
        return;
      }
      setError(reserveError instanceof Error ? reserveError.message : 'No se pudo reservar el material');
    }
  };

  const handleLoanAction = async (loanId: string, action: 'renew' | 'return' | 'lost') => {
    if (!session) return;
    setError(null);

    if (action === 'lost') {
      const confirmed = window.confirm(
        '¿Marcar este préstamo como perdido? Esto puede generar una multa y requerir revisión del bibliotecario.'
      );
      if (!confirmed) return;
    }

    try {
      await apiFetch(`/api/circulation/loans/${loanId}/${action}`, session.access_token, { method: 'POST' });
      setRefreshTick((current) => current + 1);
    } catch (loanError) {
      if (loanError instanceof ApiError && loanError.status === 401) {
        await supabase.auth.signOut();
        setError('Tu sesión expiró. Inicia sesión nuevamente.');
        return;
      }
      setError(loanError instanceof Error ? loanError.message : 'No se pudo actualizar el préstamo');
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
        setError('Tu sesión expiró. Inicia sesión nuevamente.');
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
        setError('Tu sesión expiró. Inicia sesión nuevamente.');
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
    const toggleAuthMode = () => {
      setAuthMode((mode) => (mode === 'login' ? 'register' : 'login'));
      setError(null);
    };

    return (
      <div className="auth-shell">
        <div className="auth-box">
          <header className="auth-box__top">
            <div className="auth-brand">
              <div className="auth-brand__mark">S</div>
              <div>
                <strong>Saidy Library</strong>
                <span>Gestión híbrida escolar</span>
              </div>
            </div>

            <div className="auth-box__actions">
              <button
                type="button"
                className="theme-toggle"
                onClick={toggleTheme}
                aria-label={themeMode === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
              >
                <ThemeIcon mode={themeMode} />
              </button>

              <div className="auth-switch">
                <span>{authMode === 'login' ? '¿No tienes una cuenta?' : '¿Ya tienes una cuenta?'}</span>
                <button type="button" className="auth-switch__button" onClick={toggleAuthMode}>
                  {authMode === 'login' ? 'Registrarse' : 'Entrar'}
                </button>
              </div>
            </div>
          </header>

          <div className="auth-box__body">
            <section className="auth-box__form">
              <h1>{authMode === 'login' ? 'Log in' : 'Sign up'}</h1>

              {authMode === 'login' ? (
                <form className="auth-form auth-form--boxed" onSubmit={handleLogin}>
                  <label>
                    Correo
                    <input
                      type="email"
                      value={authForm.email}
                      onChange={(event) => setAuthForm((current) => ({ ...current, email: event.target.value }))}
                      required
                      placeholder="Enter your email address"
                      autoComplete="email"
                    />
                  </label>
                  <label>
                    Contraseña
                    <input
                      type="password"
                      value={authForm.password}
                      onChange={(event) => setAuthForm((current) => ({ ...current, password: event.target.value }))}
                      required
                      placeholder="Enter your password"
                      autoComplete="current-password"
                    />
                  </label>
                  <button type="submit" className="auth-submit">
                    Entrar
                  </button>
                </form>
              ) : (
                <form className="auth-form auth-form--boxed" onSubmit={handleRegister}>
                  <label>
                    Nombre completo
                    <input
                      type="text"
                      value={authForm.fullName}
                      onChange={(event) => setAuthForm((current) => ({ ...current, fullName: event.target.value }))}
                      required
                      placeholder="Enter your full name"
                      autoComplete="name"
                    />
                  </label>
                  <label>
                    Correo
                    <input
                      type="email"
                      value={authForm.email}
                      onChange={(event) => setAuthForm((current) => ({ ...current, email: event.target.value }))}
                      required
                      placeholder="Enter your email address"
                      autoComplete="email"
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
                      placeholder="Minimum 6 characters"
                      autoComplete="new-password"
                    />
                  </label>
                  <label>
                    Institución
                    <input
                      type="text"
                      value={authForm.institution}
                      onChange={(event) => setAuthForm((current) => ({ ...current, institution: event.target.value }))}
                      placeholder="Optional"
                      autoComplete="organization"
                    />
                  </label>
                  <button type="submit" className="auth-submit">
                    Crear cuenta
                  </button>
                </form>
              )}

              {error ? <p className="form-feedback">{error}</p> : null}
            </section>

            <aside className="auth-box__art" aria-hidden="true">
              <BooksIllustration />
            </aside>
          </div>
        </div>
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
  const visibleSections = sections.filter((section) => {
    if (section.id === 'admin') return isStaff;
    if (section.id === 'digital') return profile?.can_access_digital ?? false;
    return true;
  });
  const roleSummary = profile?.roles.map((role) => roleLabel[role.key]).join(' · ') || 'Miembro';
  const permissionSummary = profile?.permissions.length ?? 0;
  const summary = toSummary(filteredMaterials);
  const catalogSummary = toSummary(portalData.materials);
  const featuredMaterials = portalData.materials.slice(0, 6);
  const featuredAssets = portalData.digitalAssets.slice(0, 4);

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
            {visibleSections.map((section) => (
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

        <div className="sidebar__footer">
          <button type="button" className="ghost-button ghost-button--icon" onClick={toggleTheme}>
            <ThemeIcon mode={themeMode} />
            {themeMode === 'dark' ? 'Modo claro' : 'Modo oscuro'}
          </button>
          <button type="button" className="ghost-button" onClick={handleLogout}>
            Cerrar sesión
          </button>
        </div>
      </aside>

      <main className="workspace">
        <header className="workspace-hero">
          <div>
            <div className="eyebrow">Portal operativo</div>
            <h1>{profile?.full_name || 'Usuario'} · {roleSummary}</h1>
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
            <button type="button" className="secondary" onClick={handleRefreshProfile}>
              Recargar perfil
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

        {selectedSection === 'home' ? (
          <section className="content-grid">
            <div className="panel">
              <div className="panel__header">
                <div>
                  <span className="panel__eyebrow">Inicio</span>
                  <h2>Encuentra tu próximo material</h2>
                </div>
                <button type="button" className="secondary" onClick={() => setSelectedSection('catalog')}>
                  Abrir catálogo
                </button>
              </div>

              <input
                className="search-input search-input--hero"
                type="search"
                placeholder="Buscar por título, ISBN, DOI o palabra clave"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />

              <div className="summary-strip">
                {catalogSummary.map((item) => (
                  <article key={item.kind}>
                    <strong>{item.count}</strong>
                    <span>{item.kind.replaceAll('_', ' ')}</span>
                  </article>
                ))}
              </div>

              <div className="cover-grid">
                {featuredMaterials.map((material) => (
                  <button
                    key={material.id}
                    type="button"
                    className="cover-card"
                    onClick={() => {
                      setSelectedMaterialId(material.id);
                      setSelectedSection('catalog');
                    }}
                  >
                    <div className="cover-card__cover">
                      {material.cover_url ? <img src={material.cover_url} alt={material.title} /> : <span>{material.kind}</span>}
                    </div>
                    <div className="cover-card__meta">
                      <strong>{material.title}</strong>
                      <small>{material.publisher || 'Sin editorial'} · {material.publication_year || 'N/A'}</small>
                    </div>
                  </button>
                ))}
                {featuredMaterials.length === 0 ? <div className="empty-state">Aún no hay materiales para mostrar.</div> : null}
              </div>
            </div>

            <div className="home-side">
              <div className="panel">
                <div className="panel__header">
                  <div>
                    <span className="panel__eyebrow">Accesos rápidos</span>
                    <h2>Tu panel</h2>
                  </div>
                </div>

                <div className="shortcut-grid">
                  <button type="button" className="shortcut-card" onClick={() => setSelectedSection('catalog')}>
                    <strong>Catálogo</strong>
                    <span>Buscar y reservar</span>
                  </button>
                  <button type="button" className="shortcut-card" onClick={() => setSelectedSection('circulation')}>
                    <strong>Préstamos y reservas</strong>
                    <span>Gestiona tus movimientos</span>
                  </button>
                  {profile?.can_access_digital ? (
                    <button type="button" className="shortcut-card" onClick={() => setSelectedSection('digital')}>
                      <strong>Biblioteca digital</strong>
                      <span>Accesos y recursos</span>
                    </button>
                  ) : (
                    <div className="shortcut-card is-disabled">
                      <strong>Biblioteca digital</strong>
                      <span>Acceso bloqueado</span>
                    </div>
                  )}
                </div>
              </div>

              {profile?.can_access_digital ? (
                <div className="panel">
                  <div className="panel__header">
                    <div>
                      <span className="panel__eyebrow">Digital</span>
                      <h2>Destacados</h2>
                    </div>
                  </div>

                  <div className="asset-grid asset-grid--compact">
                    {featuredAssets.map((asset) => (
                      <article key={asset.id} className="asset-card">
                        <div className="asset-card__cover">
                          {asset.materials.cover_url ? (
                            <img src={asset.materials.cover_url} alt={asset.materials.title} />
                          ) : (
                            <span>{asset.asset_type}</span>
                          )}
                        </div>
                        <div className="asset-card__meta">
                          <strong>{asset.materials.title}</strong>
                          <span>
                            {asset.asset_type} · expira {formatDate(asset.expires_at)}
                          </span>
                          <a href={asset.access_url} target="_blank" rel="noreferrer">
                            Abrir acceso
                          </a>
                        </div>
                      </article>
                    ))}
                    {featuredAssets.length === 0 ? <div className="empty-state">No hay recursos digitales.</div> : null}
                  </div>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

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
                  <h2>Tus libros prestados</h2>
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
                      {loan.status === 'active' ? (
                        <button type="button" className="badge" onClick={() => handleLoanAction(loan.id, 'renew')}>
                          Renovar
                        </button>
                      ) : null}
                      {loan.status === 'active' || loan.status === 'overdue' ? (
                        <>
                          <button type="button" className="badge" onClick={() => handleLoanAction(loan.id, 'return')}>
                            Devolver
                          </button>
                          <button type="button" className="badge badge--danger" onClick={() => handleLoanAction(loan.id, 'lost')}>
                            Marcar como perdido
                          </button>
                        </>
                      ) : null}
                    </div>
                  </article>
                ))}
                {portalData.loans.length === 0 ? <div className="empty-state">No hay préstamos registrados.</div> : null}
              </div>
            </div>

            <div className="panel">
              <div className="panel__header">
                <div>
                  <span className="panel__eyebrow">Reservas</span>
                  <h2>Libros reservados</h2>
                </div>
              </div>

              <div className="mini-list">
                {portalData.reservations.map((reservation) => (
                  <article key={reservation.id}>
                    <strong>{reservation.materials.title}</strong>
                    <span>
                      {reservation.status} · reservado {formatDate(reservation.reserved_at)} · posición {reservation.queue_position}
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
                    <strong>
                      {formatMoney(Number(fine.amount), fine.currency)}
                    </strong>
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

              <div className="asset-grid">
                {portalData.digitalAssets.map((asset) => (
                  <article key={asset.id} className="asset-card">
                    <div className="asset-card__cover">
                      {asset.materials.cover_url ? (
                        <img src={asset.materials.cover_url} alt={asset.materials.title} />
                      ) : (
                        <span>{asset.asset_type}</span>
                      )}
                    </div>
                    <div className="asset-card__meta">
                      <strong>{asset.materials.title}</strong>
                      <span>
                        {asset.asset_type} · expira {formatDate(asset.expires_at)}
                      </span>
                      <a href={asset.access_url} target="_blank" rel="noreferrer">
                        Abrir acceso
                      </a>
                    </div>
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
                  <article className="metric-card"><span>Inventario</span><strong>{portalData.dashboard.inventory}</strong></article>
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
                  <div><dt>Roles</dt><dd>{profile.roles.length > 0 ? profile.roles.map((role) => roleLabel[role.key]).join(', ') : 'Sin rol'}</dd></div>
                  <div><dt>Permisos</dt><dd>{permissionSummary}</dd></div>
                  <div><dt>Tipo</dt><dd>{memberLabel[profile.member_type]}</dd></div>
                  <div><dt>Digital</dt><dd>{profile.can_access_digital ? 'Permitido' : 'Bloqueado'}</dd></div>
                </dl>
              ) : null}
            </div>

            <div className="panel panel--wide">
              <div className="panel__header">
                <div>
                  <span className="panel__eyebrow">Sesión activa</span>
                  <h2>Usuario autenticado</h2>
                </div>
              </div>

              <dl className="profile-list">
                <div><dt>Email de sesión</dt><dd>{activeEmail}</dd></div>
                <div><dt>ID de sesión</dt><dd>{activeUserId}</dd></div>
                <div><dt>Email de perfil</dt><dd>{profile?.email || 'N/A'}</dd></div>
                <div><dt>Roles detectados</dt><dd>{profile?.roles.length ? profile.roles.map((role) => roleLabel[role.key]).join(', ') : 'Sin rol cargado'}</dd></div>
                <div><dt>Permisos detectados</dt><dd>{profile?.permissions.length ?? 0}</dd></div>
                <div><dt>Estado</dt><dd>{isAdmin ? 'ADMIN' : 'Usuario normal'}</dd></div>
              </dl>

              {profile && activeEmail !== profile.email ? (
                <div className="page-banner">La sesión activa y el perfil cargado no coinciden. Recarga o vuelve a iniciar sesión.</div>
              ) : null}
            </div>

            {isStaff ? (
              <>
                <AdminRbacPanel
                  token={session.access_token}
                  roleKeys={profile?.roles.map((role) => role.key) ?? []}
                  permissions={profile?.permissions.map((permission) => permission.key) ?? []}
                />

                <LibraryOperationsPanel
                  token={session.access_token}
                  roleKeys={profile?.roles.map((role) => role.key) ?? []}
                  permissions={profile?.permissions.map((permission) => permission.key) ?? []}
                  onChanged={handleRefreshProfile}
                  onUnauthorized={handleUnauthorized}
                />
              </>
            ) : null}
          </section>
        ) : null}
      </main>
    </div>
  );
}

export default App;

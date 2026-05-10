import type { FormEvent } from 'react';
import type { ThemeMode } from '../lib/domain.js';
import { BooksIllustration } from '../components/BooksIllustration.js';
import { ThemeIcon } from '../components/ThemeIcon.js';

export type AuthMode = 'login' | 'register';

export type AuthFormState = {
  email: string;
  password: string;
  fullName: string;
  institution: string;
};

type AuthPageProps = {
  mode: AuthMode;
  form: AuthFormState;
  themeMode: ThemeMode;
  error: string | null;
  onToggleMode: () => void;
  onToggleTheme: () => void;
  onChange: (next: AuthFormState) => void;
  onLogin: (event: FormEvent<HTMLFormElement>) => void;
  onRegister: (event: FormEvent<HTMLFormElement>) => void;
};

export function AuthPage({
  mode,
  form,
  themeMode,
  error,
  onToggleMode,
  onToggleTheme,
  onChange,
  onLogin,
  onRegister
}: AuthPageProps) {
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
              onClick={onToggleTheme}
              aria-label={themeMode === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
            >
              <ThemeIcon mode={themeMode} />
            </button>

            <div className="auth-switch">
              <span>{mode === 'login' ? '¿No tienes una cuenta?' : '¿Ya tienes una cuenta?'}</span>
              <button type="button" className="auth-switch__button" onClick={onToggleMode}>
                {mode === 'login' ? 'Registrarse' : 'Entrar'}
              </button>
            </div>
          </div>
        </header>

        <div className="auth-box__body">
          <section className="auth-box__form">
            <h1>{mode === 'login' ? 'Log in' : 'Sign up'}</h1>

            {mode === 'login' ? (
              <form className="auth-form auth-form--boxed" onSubmit={onLogin}>
                <label>
                  Correo
                  <input
                    type="email"
                    value={form.email}
                    onChange={(event) => onChange({ ...form, email: event.target.value })}
                    required
                    placeholder="Enter your email address"
                    autoComplete="email"
                  />
                </label>
                <label>
                  Contraseña
                  <input
                    type="password"
                    value={form.password}
                    onChange={(event) => onChange({ ...form, password: event.target.value })}
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
              <form className="auth-form auth-form--boxed" onSubmit={onRegister}>
                <label>
                  Nombre completo
                  <input
                    type="text"
                    value={form.fullName}
                    onChange={(event) => onChange({ ...form, fullName: event.target.value })}
                    required
                    placeholder="Enter your full name"
                    autoComplete="name"
                  />
                </label>
                <label>
                  Correo
                  <input
                    type="email"
                    value={form.email}
                    onChange={(event) => onChange({ ...form, email: event.target.value })}
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
                    value={form.password}
                    onChange={(event) => onChange({ ...form, password: event.target.value })}
                    required
                    placeholder="Minimum 6 characters"
                    autoComplete="new-password"
                  />
                </label>
                <label>
                  Institución
                  <input
                    type="text"
                    value={form.institution}
                    onChange={(event) => onChange({ ...form, institution: event.target.value })}
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


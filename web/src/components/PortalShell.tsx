import type { ReactNode } from 'react';
import type { Profile, SectionId, ThemeMode } from '../lib/domain.js';
import { ThemeIcon } from './ThemeIcon.js';

export type NavItem = {
  id: SectionId;
  label: string;
  description: string;
  group: string;
};

type PortalShellProps = {
  nav: NavItem[];
  selected: SectionId;
  profile: Profile | null;
  roleSummary: string;
  themeMode: ThemeMode;
  onSelect: (id: SectionId) => void;
  onToggleTheme: () => void;
  onLogout: () => void;
  children: ReactNode;
};

export function PortalShell({
  nav,
  selected,
  profile,
  roleSummary,
  themeMode,
  onSelect,
  onToggleTheme,
  onLogout,
  children
}: PortalShellProps) {
  const grouped = nav.reduce((acc, item) => {
    const existing = acc.get(item.group) ?? [];
    existing.push(item);
    acc.set(item.group, existing);
    return acc;
  }, new Map<string, NavItem[]>());

  return (
    <div className="portal-shell">
      <aside className="sidebar">
        <div>
          <div className="brand-block">
            <div className="brand-mark">S</div>
            <div>
              <strong>Saidy Library</strong>
              <span>Biblioteca híbrida</span>
            </div>
          </div>

          <div className="sidebar-user">
            <div className="sidebar-user__meta">
              <strong>{profile?.full_name || 'Usuario'}</strong>
              <span>{roleSummary}</span>
            </div>
          </div>

          <nav className="section-nav" aria-label="Navegación principal">
            {[...grouped.entries()].map(([group, items]) => (
              <div key={group} className="nav-group">
                <div className="nav-group__label">{group}</div>
                {items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={selected === item.id ? 'is-active' : ''}
                    onClick={() => onSelect(item.id)}
                  >
                    <span>{item.label}</span>
                    <small>{item.description}</small>
                  </button>
                ))}
              </div>
            ))}
          </nav>
        </div>

        <div className="sidebar__footer">
          <button type="button" className="ghost-button ghost-button--icon" onClick={onToggleTheme}>
            <ThemeIcon mode={themeMode} />
            {themeMode === 'dark' ? 'Modo claro' : 'Modo oscuro'}
          </button>
          <button type="button" className="ghost-button" onClick={onLogout}>
            Cerrar sesión
          </button>
        </div>
      </aside>

      <main className="workspace">{children}</main>
    </div>
  );
}


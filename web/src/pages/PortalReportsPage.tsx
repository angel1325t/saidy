import type { AdminDashboard } from '../lib/domain.js';

type PortalReportsPageProps = {
  dashboard: AdminDashboard | null;
  canView: boolean;
};

export function PortalReportsPage({ dashboard, canView }: PortalReportsPageProps) {
  return (
    <section className="page">
      <header className="page__header">
        <div>
          <div className="eyebrow">Reportes</div>
          <h2>Estadísticas y actividad</h2>
          <p className="muted">Visión rápida para administración y bibliotecarios.</p>
        </div>
      </header>

      {!canView ? (
        <div className="panel">
          <div className="empty-state">Solo bibliotecarios y administradores pueden ver este módulo.</div>
        </div>
      ) : null}

      {canView && dashboard ? (
        <>
          <section className="metrics-grid">
            <article className="metric-card">
              <span>Materiales</span>
              <strong>{dashboard.materials}</strong>
            </article>
            <article className="metric-card">
              <span>Préstamos</span>
              <strong>{dashboard.loans}</strong>
            </article>
            <article className="metric-card">
              <span>Reservas</span>
              <strong>{dashboard.reservations}</strong>
            </article>
            <article className="metric-card">
              <span>Multas</span>
              <strong>{dashboard.fines}</strong>
            </article>
          </section>

          <div className="content-grid content-grid--wide">
            <div className="panel">
              <div className="panel__header">
                <div>
                  <span className="panel__eyebrow">Operación</span>
                  <h3>Módulos administrativos</h3>
                </div>
              </div>

              <div className="report-bars">
                <ReportBar label="Inventario" value={dashboard.inventory} />
                <ReportBar label="Adquisiciones" value={dashboard.acquisitions} />
                <ReportBar label="Interbibliotecario" value={dashboard.interlibrary} />
                <ReportBar label="Notificaciones" value={dashboard.notifications} />
              </div>
            </div>

            <div className="panel">
              <div className="panel__header">
                <div>
                  <span className="panel__eyebrow">Lectura</span>
                  <h3>Recomendación</h3>
                </div>
              </div>

              <div className="empty-state">
                Este panel está listo para gráficos mensuales (préstamos por semana, top materiales, morosidad). Se puede
                completar cuando definamos las consultas agregadas.
              </div>
            </div>
          </div>
        </>
      ) : null}

      {canView && !dashboard ? (
        <div className="panel">
          <div className="empty-state">No hay métricas disponibles para mostrar.</div>
        </div>
      ) : null}
    </section>
  );
}

function ReportBar({ label, value }: { label: string; value: number }) {
  const safeValue = Number.isFinite(value) ? value : 0;
  return (
    <div className="report-bar">
      <div className="report-bar__meta">
        <strong>{label}</strong>
        <span>{safeValue}</span>
      </div>
      <div className="report-bar__track" aria-hidden="true">
        <div className="report-bar__fill" style={{ width: `${Math.min(100, safeValue * 8)}%` }} />
      </div>
    </div>
  );
}


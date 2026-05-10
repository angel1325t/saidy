import { useMemo, useState } from 'react';
import type { Fine, Loan, Reservation } from '../lib/domain.js';
import { formatDate, formatMoney } from '../lib/format.js';

type LibraryTab = 'loans' | 'reservations' | 'fines';

type PortalMyLibraryPageProps = {
  loans: Loan[];
  reservations: Reservation[];
  fines: Fine[];
  isStaff: boolean;
  onLoanAction: (loanId: string, action: 'renew' | 'return' | 'lost') => void;
  onCancelReservation: (reservationId: string) => void;
  onPayFine: (fineId: string) => void;
};

export function PortalMyLibraryPage({
  loans,
  reservations,
  fines,
  isStaff,
  onLoanAction,
  onCancelReservation,
  onPayFine
}: PortalMyLibraryPageProps) {
  const [tab, setTab] = useState<LibraryTab>('loans');

  const summary = useMemo(() => {
    const activeLoans = loans.filter((loan) => loan.status === 'active' || loan.status === 'overdue');
    const overdueLoans = loans.filter((loan) => loan.status === 'overdue');
    const activeReservations = reservations.filter((reservation) => reservation.status !== 'cancelled');
    const openFines = fines.filter((fine) => fine.status !== 'paid');
    return {
      activeLoans: activeLoans.length,
      overdueLoans: overdueLoans.length,
      activeReservations: activeReservations.length,
      openFines: openFines.length
    };
  }, [fines, loans, reservations]);

  return (
    <section className="page">
      <header className="page__header">
        <div>
          <div className="eyebrow">Mi biblioteca</div>
          <h2>Préstamos, reservas y multas</h2>
          <p className="muted">Gestiona tus libros reservados, devuélvelos o repórtalos como perdidos.</p>
        </div>
      </header>

      <section className="metrics-grid metrics-grid--compact">
        <article className="metric-card">
          <span>Préstamos activos</span>
          <strong>{summary.activeLoans}</strong>
        </article>
        <article className="metric-card">
          <span>Vencidos</span>
          <strong>{summary.overdueLoans}</strong>
        </article>
        <article className="metric-card">
          <span>Reservas</span>
          <strong>{summary.activeReservations}</strong>
        </article>
        <article className="metric-card">
          <span>Multas abiertas</span>
          <strong>{summary.openFines}</strong>
        </article>
      </section>

      <div className="panel">
        <div className="tabs">
          <button type="button" className={tab === 'loans' ? 'is-active' : ''} onClick={() => setTab('loans')}>
            Préstamos
          </button>
          <button
            type="button"
            className={tab === 'reservations' ? 'is-active' : ''}
            onClick={() => setTab('reservations')}
          >
            Reservas
          </button>
          <button type="button" className={tab === 'fines' ? 'is-active' : ''} onClick={() => setTab('fines')}>
            Multas
          </button>
        </div>

        {tab === 'loans' ? (
          <div className="mini-list">
            {loans.map((loan) => (
              <article key={loan.id}>
                <strong>{loan.materials.title}</strong>
                <span>
                  {loan.status} · vence {formatDate(loan.due_at)}
                </span>
                <div className="badge-row">
                  {loan.status === 'active' ? (
                    <button type="button" className="badge" onClick={() => onLoanAction(loan.id, 'renew')}>
                      Renovar
                    </button>
                  ) : null}
                  {loan.status === 'active' || loan.status === 'overdue' ? (
                    <>
                      <button type="button" className="badge" onClick={() => onLoanAction(loan.id, 'return')}>
                        Devolver
                      </button>
                      <button type="button" className="badge badge--danger" onClick={() => onLoanAction(loan.id, 'lost')}>
                        Marcar como perdido
                      </button>
                    </>
                  ) : null}
                </div>
              </article>
            ))}
            {loans.length === 0 ? <div className="empty-state">No hay préstamos registrados.</div> : null}
          </div>
        ) : null}

        {tab === 'reservations' ? (
          <div className="mini-list">
            {reservations.map((reservation) => (
              <article key={reservation.id}>
                <strong>{reservation.materials.title}</strong>
                <span>
                  {reservation.status} · reservado {formatDate(reservation.reserved_at)} · posición {reservation.queue_position}
                </span>
                <button type="button" className="badge" onClick={() => onCancelReservation(reservation.id)}>
                  Cancelar
                </button>
              </article>
            ))}
            {reservations.length === 0 ? <div className="empty-state">No hay reservas activas.</div> : null}
          </div>
        ) : null}

        {tab === 'fines' ? (
          <div className="mini-list">
            {fines.map((fine) => (
              <article key={fine.id}>
                <strong>{formatMoney(Number(fine.amount), fine.currency)}</strong>
                <span>
                  {fine.status} · {fine.reason || 'Sin detalle'} · emitida {formatDate(fine.issued_at)}
                </span>
                {isStaff ? (
                  <button type="button" className="badge" onClick={() => onPayFine(fine.id)}>
                    Marcar pagada
                  </button>
                ) : null}
              </article>
            ))}
            {fines.length === 0 ? <div className="empty-state">No hay multas registradas.</div> : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}


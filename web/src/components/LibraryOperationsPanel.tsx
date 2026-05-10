import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ApiError, apiFetch } from '../lib/api.js';

type PermissionProps = {
  token: string;
  permissions: string[];
  roleKeys: string[];
  onChanged: () => void;
  onUnauthorized: () => void;
  activeSection?: 'catalog' | 'circulation' | 'admin';
  showTabs?: boolean;
};

type MaterialOption = {
  id: string;
  kind: string;
  title: string;
  status?: string;
};

type CopyOption = {
  id: string;
  material_id: string;
  barcode: string | null;
  copy_code: string | null;
  status: string;
  location: string | null;
};

type AdminUserOption = {
  id: string;
  email: string;
  full_name: string;
};

type LoanRow = {
  id: string;
  status: string;
  due_at: string;
  materials?: { title: string };
  material_copies?: { copy_code: string | null; barcode: string | null } | null;
};

type ReservationRow = {
  id: string;
  status: string;
  materials?: { title: string };
};

type FineRow = {
  id: string;
  amount: number;
  currency: string;
  status: string;
  reason: string | null;
};

type AdminRecord = Record<string, any>;

const materialKinds = [
  'physical_book',
  'ebook',
  'magazine',
  'journal_article',
  'thesis',
  'audiobook',
  'multimedia',
  'institutional_document'
];

function hasPermission(permissions: string[], roleKeys: string[], ...required: string[]) {
  return roleKeys.includes('ADMIN') || required.some((permission) => permissions.includes(permission));
}

function splitList(value: string) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function optionalString(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function optionalNumber(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? Number(trimmed) : undefined;
}

function withoutUndefined<T extends Record<string, unknown>>(payload: T) {
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined)) as Partial<T>;
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'N/A';
  return new Intl.DateTimeFormat('es-BO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export function LibraryOperationsPanel({
  token,
  permissions,
  roleKeys,
  onChanged,
  onUnauthorized,
  activeSection,
  showTabs = true
}: PermissionProps) {
  const canManageCatalog = hasPermission(permissions, roleKeys, 'catalog:create', 'catalog:update', 'catalog:delete');
  const canReadCirculation = hasPermission(permissions, roleKeys, 'circulation:read:any', 'circulation:read:own');
  const canManageLoans = hasPermission(permissions, roleKeys, 'loans:create:physical', 'loans:create:digital', 'loans:return:any');
  const canManageInventory = hasPermission(permissions, roleKeys, 'inventory:manage');
  const canManageReports = hasPermission(permissions, roleKeys, 'reports:view');
  const canManageNotifications = hasPermission(permissions, roleKeys, 'notifications:manage');
  const canReadUsers = hasPermission(permissions, roleKeys, 'users:read');

  const [activeTab, setActiveTab] = useState<'catalog' | 'circulation' | 'admin'>(activeSection ?? 'catalog');
  const [materials, setMaterials] = useState<MaterialOption[]>([]);
  const [copies, setCopies] = useState<CopyOption[]>([]);
  const [users, setUsers] = useState<AdminUserOption[]>([]);
  const [loans, setLoans] = useState<LoanRow[]>([]);
  const [reservations, setReservations] = useState<ReservationRow[]>([]);
  const [fines, setFines] = useState<FineRow[]>([]);
  const [inventory, setInventory] = useState<AdminRecord[]>([]);
  const [acquisitions, setAcquisitions] = useState<AdminRecord[]>([]);
  const [interlibrary, setInterlibrary] = useState<AdminRecord[]>([]);
  const [notifications, setNotifications] = useState<AdminRecord[]>([]);
  const [analytics, setAnalytics] = useState<AdminRecord | null>(null);
  const [selectedMaterialId, setSelectedMaterialId] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const [materialForm, setMaterialForm] = useState({
    title: '',
    kind: 'physical_book',
    contributors: '',
    tags: '',
    publisher: '',
    publication_year: '',
    language: 'es',
    isbn: '',
    issn: '',
    doi: '',
    dewey_classification: '',
    call_number: '',
    digital_url: '',
    summary: ''
  });

  const [copyForm, setCopyForm] = useState({
    copy_code: '',
    barcode: '',
    location: '',
    shelf_code: '',
    status: 'available',
    condition_note: ''
  });

  const [loanForm, setLoanForm] = useState({
    user_id: '',
    material_id: '',
    copy_id: '',
    loan_type: 'physical'
  });

  const [inventoryForm, setInventoryForm] = useState({
    copy_id: '',
    material_id: '',
    location: '',
    condition_status: 'good',
    is_missing: false,
    notes: ''
  });

  const [acquisitionForm, setAcquisitionForm] = useState({
    title: '',
    kind: 'physical_book',
    supplier: '',
    estimated_cost: '',
    justification: ''
  });

  const [interlibraryForm, setInterlibraryForm] = useState({
    material_title: '',
    external_library: '',
    notes: ''
  });

  const [notificationForm, setNotificationForm] = useState({
    user_id: '',
    title: '',
    body: '',
    type: 'system',
    channel: 'in_app'
  });

  const availableCopies = useMemo(
    () => copies.filter((copy) => copy.material_id === loanForm.material_id && copy.status === 'available'),
    [copies, loanForm.material_id]
  );

  useEffect(() => {
    if (activeSection) {
      setActiveTab(activeSection);
    }
  }, [activeSection]);

  const refresh = () => {
    setRefreshTick((value) => value + 1);
    onChanged();
  };

  useEffect(() => {
    let active = true;

    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        const materialResult = await apiFetch<{ items: MaterialOption[] }>('/api/catalog/materials?limit=50&status=published', token);
        if (!active) return;
        setMaterials(materialResult.items);
        const firstMaterialId = selectedMaterialId || materialResult.items[0]?.id || '';
        setSelectedMaterialId(firstMaterialId);
        setLoanForm((current) => ({ ...current, material_id: current.material_id || firstMaterialId }));
        setInventoryForm((current) => ({ ...current, material_id: current.material_id || firstMaterialId }));

        const copyResults = await Promise.all(
          materialResult.items.map(async (material) => {
            const response = await apiFetch<{ items: CopyOption[] }>(`/api/catalog/materials/${material.id}/copies`, token);
            return response.items;
          })
        );

        const [usersResult, loansResult, reservationsResult, finesResult, inventoryResult, acquisitionsResult, interlibraryResult, notificationsResult, analyticsResult] =
          await Promise.allSettled([
            canReadUsers ? apiFetch<{ items: AdminUserOption[] }>('/api/admin/users', token) : Promise.resolve({ items: [] }),
            canReadCirculation ? apiFetch<{ items: LoanRow[] }>('/api/circulation/loans', token) : Promise.resolve({ items: [] }),
            canReadCirculation ? apiFetch<{ items: ReservationRow[] }>('/api/circulation/reservations', token) : Promise.resolve({ items: [] }),
            canReadCirculation ? apiFetch<{ items: FineRow[] }>('/api/circulation/fines', token) : Promise.resolve({ items: [] }),
            canManageInventory ? apiFetch<{ items: AdminRecord[] }>('/api/admin/inventory', token) : Promise.resolve({ items: [] }),
            canManageReports ? apiFetch<{ items: AdminRecord[] }>('/api/admin/acquisitions', token) : Promise.resolve({ items: [] }),
            canManageReports ? apiFetch<{ items: AdminRecord[] }>('/api/admin/interlibrary', token) : Promise.resolve({ items: [] }),
            canManageNotifications ? apiFetch<{ items: AdminRecord[] }>('/api/admin/notifications', token) : Promise.resolve({ items: [] }),
            canManageReports ? apiFetch<AdminRecord>('/api/admin/analytics', token) : Promise.resolve(null)
          ]);

        if (!active) return;
        setCopies(copyResults.flat());
        setUsers(usersResult.status === 'fulfilled' ? usersResult.value.items : []);
        setLoans(loansResult.status === 'fulfilled' ? loansResult.value.items : []);
        setReservations(reservationsResult.status === 'fulfilled' ? reservationsResult.value.items : []);
        setFines(finesResult.status === 'fulfilled' ? finesResult.value.items : []);
        setInventory(inventoryResult.status === 'fulfilled' ? inventoryResult.value.items : []);
        setAcquisitions(acquisitionsResult.status === 'fulfilled' ? acquisitionsResult.value.items : []);
        setInterlibrary(interlibraryResult.status === 'fulfilled' ? interlibraryResult.value.items : []);
        setNotifications(notificationsResult.status === 'fulfilled' ? notificationsResult.value.items : []);
        setAnalytics(analyticsResult.status === 'fulfilled' ? analyticsResult.value : null);
      } catch (loadError) {
        if (active) {
          if (loadError instanceof ApiError && loadError.status === 401) {
            onUnauthorized();
            return;
          }
          setError(loadError instanceof Error ? loadError.message : 'No se pudo cargar operación bibliotecaria');
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();

    return () => {
      active = false;
    };
  }, [token, canReadUsers, canReadCirculation, canManageInventory, canManageReports, canManageNotifications, refreshTick]);

  const runAction = async (label: string, action: () => Promise<void>) => {
    setSubmitting(label);
    setError(null);
    setMessage(null);
    try {
      await action();
      setMessage('Acción registrada correctamente.');
      refresh();
    } catch (actionError) {
      if (actionError instanceof ApiError && actionError.status === 401) {
        onUnauthorized();
        return;
      }
      setError(actionError instanceof Error ? actionError.message : 'No se pudo completar la acción');
    } finally {
      setSubmitting(null);
    }
  };

  const handleCreateMaterial = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void runAction('material', async () => {
      const material = await apiFetch<{ material: MaterialOption }>('/api/catalog/materials', token, {
        method: 'POST',
        body: JSON.stringify(withoutUndefined({
          kind: materialForm.kind,
          title: materialForm.title,
          summary: optionalString(materialForm.summary),
          publisher: optionalString(materialForm.publisher),
          publication_year: optionalNumber(materialForm.publication_year),
          language: materialForm.language || 'es',
          isbn: optionalString(materialForm.isbn),
          issn: optionalString(materialForm.issn),
          doi: optionalString(materialForm.doi),
          dewey_classification: optionalString(materialForm.dewey_classification),
          call_number: optionalString(materialForm.call_number),
          digital_url: optionalString(materialForm.digital_url),
          contributors: splitList(materialForm.contributors).map((name, index) => ({ name, role: 'author', sort_order: index })),
          tags: splitList(materialForm.tags),
          keywords: splitList(materialForm.tags),
          topics: splitList(materialForm.tags)
        }))
      });
      setSelectedMaterialId(material.material.id);
      setMaterialForm((current) => ({ ...current, title: '', contributors: '', tags: '', isbn: '', issn: '', doi: '', summary: '' }));
    });
  };

  const handleArchiveMaterial = (materialId: string) => {
    void runAction(`archive-${materialId}`, async () => {
      await apiFetch(`/api/catalog/materials/${materialId}`, token, { method: 'DELETE' });
    });
  };

  const handleCreateCopy = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedMaterialId) return;
    void runAction('copy', async () => {
      await apiFetch(`/api/catalog/materials/${selectedMaterialId}/copies`, token, {
        method: 'POST',
        body: JSON.stringify(withoutUndefined({
          copy_code: optionalString(copyForm.copy_code),
          barcode: optionalString(copyForm.barcode),
          location: optionalString(copyForm.location),
          shelf_code: optionalString(copyForm.shelf_code),
          status: copyForm.status,
          condition_note: optionalString(copyForm.condition_note)
        }))
      });
      setCopyForm({ copy_code: '', barcode: '', location: '', shelf_code: '', status: 'available', condition_note: '' });
    });
  };

  const handleCopyStatus = (copyId: string, status: string) => {
    void runAction(`copy-${copyId}`, async () => {
      await apiFetch(`/api/catalog/copies/${copyId}`, token, {
        method: 'PATCH',
        body: JSON.stringify({ status })
      });
    });
  };

  const handleCreateLoan = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void runAction('loan', async () => {
      await apiFetch('/api/circulation/loans', token, {
        method: 'POST',
        body: JSON.stringify(withoutUndefined({
          material_id: loanForm.material_id,
          user_id: optionalString(loanForm.user_id),
          loan_type: loanForm.loan_type,
          copy_id: loanForm.loan_type === 'physical' ? optionalString(loanForm.copy_id) : null
        }))
      });
      setLoanForm((current) => ({ ...current, copy_id: '' }));
    });
  };

  const handleCreateInventory = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void runAction('inventory', async () => {
      await apiFetch('/api/admin/inventory', token, {
        method: 'POST',
        body: JSON.stringify(withoutUndefined({
          copy_id: optionalString(inventoryForm.copy_id),
          material_id: optionalString(inventoryForm.material_id),
          location: optionalString(inventoryForm.location),
          condition_status: inventoryForm.condition_status,
          is_missing: inventoryForm.is_missing,
          notes: optionalString(inventoryForm.notes)
        }))
      });
      setInventoryForm((current) => ({ ...current, copy_id: '', location: '', is_missing: false, notes: '' }));
    });
  };

  const handleCreateAcquisition = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void runAction('acquisition', async () => {
      await apiFetch('/api/admin/acquisitions', token, {
        method: 'POST',
        body: JSON.stringify(withoutUndefined({
          title: acquisitionForm.title,
          kind: acquisitionForm.kind,
          supplier: optionalString(acquisitionForm.supplier),
          estimated_cost: optionalNumber(acquisitionForm.estimated_cost),
          justification: optionalString(acquisitionForm.justification)
        }))
      });
      setAcquisitionForm((current) => ({ ...current, title: '', supplier: '', estimated_cost: '', justification: '' }));
    });
  };

  const handleCreateInterlibrary = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void runAction('interlibrary', async () => {
      await apiFetch('/api/admin/interlibrary', token, {
        method: 'POST',
        body: JSON.stringify(withoutUndefined({
          material_title: interlibraryForm.material_title,
          external_library: optionalString(interlibraryForm.external_library),
          notes: optionalString(interlibraryForm.notes)
        }))
      });
      setInterlibraryForm({ material_title: '', external_library: '', notes: '' });
    });
  };

  const handleCreateNotification = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void runAction('notification', async () => {
      await apiFetch('/api/admin/notifications', token, {
        method: 'POST',
        body: JSON.stringify(withoutUndefined({
          user_id: optionalString(notificationForm.user_id),
          title: notificationForm.title,
          body: notificationForm.body,
          type: notificationForm.type,
          channel: notificationForm.channel
        }))
      });
      setNotificationForm((current) => ({ ...current, user_id: '', title: '', body: '' }));
    });
  };

  const handleStatusPatch = (path: string, status: string) => {
    void runAction(`${path}-${status}`, async () => {
      await apiFetch(path, token, {
        method: 'PATCH',
        body: JSON.stringify({ status })
      });
    });
  };

  if (!canManageCatalog && !canReadCirculation && !canManageInventory && !canManageReports && !canManageNotifications) {
    return null;
  }

  return (
    <section className={showTabs ? 'admin-rbac library-ops' : 'admin-rbac library-ops library-ops--embedded'}>
      <div className="panel__header">
        <div>
          <span className="panel__eyebrow">Operación</span>
          <h2>Catálogo, circulación y administración bibliotecaria</h2>
        </div>
        {showTabs ? <div className="admin-rbac__tabs">
          <button type="button" className={activeTab === 'catalog' ? 'is-active' : ''} onClick={() => setActiveTab('catalog')}>
            Catálogo
          </button>
          <button type="button" className={activeTab === 'circulation' ? 'is-active' : ''} onClick={() => setActiveTab('circulation')}>
            Circulación
          </button>
          <button type="button" className={activeTab === 'admin' ? 'is-active' : ''} onClick={() => setActiveTab('admin')}>
            Gestión
          </button>
        </div> : null}
      </div>

      {loading ? <div className="empty-state">Cargando módulos operativos...</div> : null}
      {error ? <div className="page-banner">{error}</div> : null}
      {message ? <div className="page-banner">{message}</div> : null}

      {activeTab === 'catalog' && canManageCatalog ? (
        <div className="admin-rbac__layout">
          <article className="panel editor-card">
            <div className="panel__header">
              <div>
                <span className="panel__eyebrow">Material</span>
                <h3>Alta bibliográfica</h3>
              </div>
            </div>
            <form className="auth-form crud-form crud-form--catalog" onSubmit={handleCreateMaterial}>
              <label>Título<input value={materialForm.title} onChange={(event) => setMaterialForm((current) => ({ ...current, title: event.target.value }))} required /></label>
              <label>Tipo<select value={materialForm.kind} onChange={(event) => setMaterialForm((current) => ({ ...current, kind: event.target.value }))}>{materialKinds.map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select></label>
              <label>Autores<input value={materialForm.contributors} onChange={(event) => setMaterialForm((current) => ({ ...current, contributors: event.target.value }))} placeholder="Autor 1, Autor 2" /></label>
              <label>Etiquetas<input value={materialForm.tags} onChange={(event) => setMaterialForm((current) => ({ ...current, tags: event.target.value }))} placeholder="ciencia, tesis" /></label>
              <label>Editorial<input value={materialForm.publisher} onChange={(event) => setMaterialForm((current) => ({ ...current, publisher: event.target.value }))} /></label>
              <label>Año<input type="number" value={materialForm.publication_year} onChange={(event) => setMaterialForm((current) => ({ ...current, publication_year: event.target.value }))} /></label>
              <label>ISBN<input value={materialForm.isbn} onChange={(event) => setMaterialForm((current) => ({ ...current, isbn: event.target.value }))} /></label>
              <label>ISSN<input value={materialForm.issn} onChange={(event) => setMaterialForm((current) => ({ ...current, issn: event.target.value }))} /></label>
              <label>DOI<input value={materialForm.doi} onChange={(event) => setMaterialForm((current) => ({ ...current, doi: event.target.value }))} /></label>
              <label>Dewey<input value={materialForm.dewey_classification} onChange={(event) => setMaterialForm((current) => ({ ...current, dewey_classification: event.target.value }))} /></label>
              <label>Signatura<input value={materialForm.call_number} onChange={(event) => setMaterialForm((current) => ({ ...current, call_number: event.target.value }))} /></label>
              <label>URL digital<input type="url" value={materialForm.digital_url} onChange={(event) => setMaterialForm((current) => ({ ...current, digital_url: event.target.value }))} /></label>
              <label>Resumen<textarea rows={4} value={materialForm.summary} onChange={(event) => setMaterialForm((current) => ({ ...current, summary: event.target.value }))} /></label>
              <button type="submit" disabled={submitting === 'material'}>{submitting === 'material' ? 'Guardando...' : 'Crear material'}</button>
            </form>
          </article>

          <article className="panel panel--wide">
            <div className="panel__header">
              <div>
                <span className="panel__eyebrow">Ejemplares</span>
                <h3>Copias e inventario base</h3>
              </div>
            </div>
            <form className="auth-form crud-form crud-form--copy" onSubmit={handleCreateCopy}>
              <label>Material<select value={selectedMaterialId} onChange={(event) => setSelectedMaterialId(event.target.value)}>{materials.map((material) => <option key={material.id} value={material.id}>{material.title}</option>)}</select></label>
              <label>Código<input value={copyForm.copy_code} onChange={(event) => setCopyForm((current) => ({ ...current, copy_code: event.target.value }))} /></label>
              <label>Barcode<input value={copyForm.barcode} onChange={(event) => setCopyForm((current) => ({ ...current, barcode: event.target.value }))} /></label>
              <label>Ubicación<input value={copyForm.location} onChange={(event) => setCopyForm((current) => ({ ...current, location: event.target.value }))} /></label>
              <label>Estante<input value={copyForm.shelf_code} onChange={(event) => setCopyForm((current) => ({ ...current, shelf_code: event.target.value }))} /></label>
              <label>Estado<select value={copyForm.status} onChange={(event) => setCopyForm((current) => ({ ...current, status: event.target.value }))}>{['available', 'borrowed', 'reserved', 'lost', 'maintenance', 'archived'].map((status) => <option key={status} value={status}>{status}</option>)}</select></label>
              <label>Condición<textarea rows={2} value={copyForm.condition_note} onChange={(event) => setCopyForm((current) => ({ ...current, condition_note: event.target.value }))} /></label>
              <button type="submit" disabled={submitting === 'copy'}>{submitting === 'copy' ? 'Guardando...' : 'Agregar copia'}</button>
            </form>

            <div className="admin-list">
              {materials.map((material) => (
                <article key={material.id} className="admin-row">
                  <div className="admin-row__header">
                    <div><strong>{material.title}</strong><p>{material.kind} · {material.status || 'published'}</p></div>
                    <button type="button" className="secondary" onClick={() => handleArchiveMaterial(material.id)}>Archivar</button>
                  </div>
                  <div className="badge-row">
                    {copies.filter((copy) => copy.material_id === material.id).map((copy) => (
                      <button key={copy.id} type="button" className="badge" onClick={() => handleCopyStatus(copy.id, copy.status === 'available' ? 'maintenance' : 'available')}>
                        {copy.copy_code || copy.barcode || copy.id.slice(0, 8)} · {copy.status}
                      </button>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </article>
        </div>
      ) : null}

      {activeTab === 'circulation' && canReadCirculation ? (
        <div className="admin-rbac__layout">
          {canManageLoans ? (
            <article className="panel editor-card">
              <div className="panel__header"><div><span className="panel__eyebrow">Préstamo</span><h3>Registrar circulación</h3></div></div>
              <form className="auth-form crud-form" onSubmit={handleCreateLoan}>
                <label>Usuario<select value={loanForm.user_id} onChange={(event) => setLoanForm((current) => ({ ...current, user_id: event.target.value }))}><option value="">Yo / sesión activa</option>{users.map((user) => <option key={user.id} value={user.id}>{user.full_name} · {user.email}</option>)}</select></label>
                <label>Material<select value={loanForm.material_id} onChange={(event) => setLoanForm((current) => ({ ...current, material_id: event.target.value, copy_id: '' }))}>{materials.map((material) => <option key={material.id} value={material.id}>{material.title}</option>)}</select></label>
                <label>Tipo<select value={loanForm.loan_type} onChange={(event) => setLoanForm((current) => ({ ...current, loan_type: event.target.value }))}><option value="physical">Físico</option><option value="digital">Digital</option></select></label>
                {loanForm.loan_type === 'physical' ? <label>Copia<select value={loanForm.copy_id} onChange={(event) => setLoanForm((current) => ({ ...current, copy_id: event.target.value }))}><option value="">Seleccionar copia</option>{availableCopies.map((copy) => <option key={copy.id} value={copy.id}>{copy.copy_code || copy.barcode || copy.id} · {copy.location || 'Sin ubicación'}</option>)}</select></label> : null}
                <button type="submit" disabled={submitting === 'loan'}>{submitting === 'loan' ? 'Registrando...' : 'Crear préstamo'}</button>
              </form>
            </article>
          ) : null}

          <article className="panel panel--wide">
            <div className="panel__header"><div><span className="panel__eyebrow">Historial</span><h3>Préstamos, reservas y multas</h3></div></div>
            <div className="admin-grid">
              <div className="mini-list mini-list--wide">
                <strong>Préstamos</strong>
                {loans.map((loan) => <article key={loan.id}><strong>{loan.materials?.title || loan.id}</strong><span>{loan.status} · vence {formatDate(loan.due_at)}</span><div className="badge-row"><button type="button" className="badge" onClick={() => runAction(`renew-${loan.id}`, async () => { await apiFetch(`/api/circulation/loans/${loan.id}/renew`, token, { method: 'POST' }); })}>Renovar</button><button type="button" className="badge" onClick={() => runAction(`return-${loan.id}`, async () => { await apiFetch(`/api/circulation/loans/${loan.id}/return`, token, { method: 'POST' }); })}>Devolver</button></div></article>)}
              </div>
              <div className="mini-list mini-list--wide">
                <strong>Reservas</strong>
                {reservations.map((reservation) => <article key={reservation.id}><strong>{reservation.materials?.title || reservation.id}</strong><span>{reservation.status}</span><button type="button" className="badge" onClick={() => runAction(`reservation-${reservation.id}`, async () => { await apiFetch(`/api/circulation/reservations/${reservation.id}/cancel`, token, { method: 'POST' }); })}>Cancelar</button></article>)}
              </div>
              <div className="mini-list mini-list--wide">
                <strong>Multas</strong>
                {fines.map((fine) => <article key={fine.id}><strong>{fine.amount} {fine.currency}</strong><span>{fine.status} · {fine.reason || 'Sin detalle'}</span><button type="button" className="badge" onClick={() => runAction(`fine-${fine.id}`, async () => { await apiFetch(`/api/circulation/fines/${fine.id}/pay`, token, { method: 'POST' }); })}>Marcar pagada</button></article>)}
              </div>
            </div>
          </article>
        </div>
      ) : null}

      {activeTab === 'admin' ? (
        <div className="admin-rbac__layout">
          {canManageInventory ? (
            <article className="panel editor-card">
              <div className="panel__header"><div><span className="panel__eyebrow">Inventario</span><h3>Auditoría física</h3></div></div>
              <form className="auth-form crud-form" onSubmit={handleCreateInventory}>
                <label>Material<select value={inventoryForm.material_id} onChange={(event) => setInventoryForm((current) => ({ ...current, material_id: event.target.value }))}>{materials.map((material) => <option key={material.id} value={material.id}>{material.title}</option>)}</select></label>
                <label>Copia<select value={inventoryForm.copy_id} onChange={(event) => setInventoryForm((current) => ({ ...current, copy_id: event.target.value }))}><option value="">Sin copia específica</option>{copies.map((copy) => <option key={copy.id} value={copy.id}>{copy.copy_code || copy.barcode || copy.id}</option>)}</select></label>
                <label>Ubicación<input value={inventoryForm.location} onChange={(event) => setInventoryForm((current) => ({ ...current, location: event.target.value }))} /></label>
                <label>Condición<input value={inventoryForm.condition_status} onChange={(event) => setInventoryForm((current) => ({ ...current, condition_status: event.target.value }))} /></label>
                <label className="toggle-row"><input type="checkbox" checked={inventoryForm.is_missing} onChange={(event) => setInventoryForm((current) => ({ ...current, is_missing: event.target.checked }))} /><span>Marcar como perdido</span></label>
                <label>Notas<textarea rows={2} value={inventoryForm.notes} onChange={(event) => setInventoryForm((current) => ({ ...current, notes: event.target.value }))} /></label>
                <button type="submit">Registrar inventario</button>
              </form>
            </article>
          ) : null}

          <article className="panel panel--wide">
            <div className="panel__header"><div><span className="panel__eyebrow">Gestión</span><h3>Adquisiciones, interbiblioteca, avisos y analítica</h3></div></div>
            <div className="admin-grid">
              {canManageReports ? (
                <form className="auth-form info-card crud-form" onSubmit={handleCreateAcquisition}>
                  <strong>Solicitud de adquisición</strong>
                  <input placeholder="Título" value={acquisitionForm.title} onChange={(event) => setAcquisitionForm((current) => ({ ...current, title: event.target.value }))} required />
                  <select value={acquisitionForm.kind} onChange={(event) => setAcquisitionForm((current) => ({ ...current, kind: event.target.value }))}>{materialKinds.map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select>
                  <input placeholder="Proveedor" value={acquisitionForm.supplier} onChange={(event) => setAcquisitionForm((current) => ({ ...current, supplier: event.target.value }))} />
                  <input type="number" placeholder="Costo estimado" value={acquisitionForm.estimated_cost} onChange={(event) => setAcquisitionForm((current) => ({ ...current, estimated_cost: event.target.value }))} />
                  <textarea rows={2} placeholder="Justificación" value={acquisitionForm.justification} onChange={(event) => setAcquisitionForm((current) => ({ ...current, justification: event.target.value }))} />
                  <button type="submit">Crear adquisición</button>
                </form>
              ) : null}
              {canManageReports ? (
                <form className="auth-form info-card crud-form" onSubmit={handleCreateInterlibrary}>
                  <strong>Préstamo interbibliotecario</strong>
                  <input placeholder="Material solicitado" value={interlibraryForm.material_title} onChange={(event) => setInterlibraryForm((current) => ({ ...current, material_title: event.target.value }))} required />
                  <input placeholder="Biblioteca externa" value={interlibraryForm.external_library} onChange={(event) => setInterlibraryForm((current) => ({ ...current, external_library: event.target.value }))} />
                  <textarea rows={2} placeholder="Notas" value={interlibraryForm.notes} onChange={(event) => setInterlibraryForm((current) => ({ ...current, notes: event.target.value }))} />
                  <button type="submit">Crear solicitud</button>
                </form>
              ) : null}
              {canManageNotifications ? (
                <form className="auth-form info-card crud-form" onSubmit={handleCreateNotification}>
                  <strong>Notificación interna</strong>
                  <select value={notificationForm.user_id} onChange={(event) => setNotificationForm((current) => ({ ...current, user_id: event.target.value }))}><option value="">General</option>{users.map((user) => <option key={user.id} value={user.id}>{user.full_name}</option>)}</select>
                  <input placeholder="Título" value={notificationForm.title} onChange={(event) => setNotificationForm((current) => ({ ...current, title: event.target.value }))} required />
                  <textarea rows={2} placeholder="Mensaje" value={notificationForm.body} onChange={(event) => setNotificationForm((current) => ({ ...current, body: event.target.value }))} required />
                  <button type="submit">Enviar aviso</button>
                </form>
              ) : null}
              {analytics?.summary ? (
                <article className="info-card">
                  <strong>Analítica operativa</strong>
                  <p>Préstamos activos: {analytics.summary.active_loans}</p>
                  <p>Vencidos: {analytics.summary.overdue_loans}</p>
                  <p>Digitales: {analytics.summary.digital_loans}</p>
                  <p>Multas abiertas: {analytics.summary.open_fines}</p>
                </article>
              ) : null}
            </div>

            <div className="admin-grid">
              {[...acquisitions, ...interlibrary].slice(0, 8).map((record) => (
                <article key={record.id} className="info-card">
                  <strong>{record.title || record.material_title}</strong>
                  <small>{record.status}</small>
                  {'title' in record ? (
                    <div className="badge-row"><button type="button" className="badge" onClick={() => handleStatusPatch(`/api/admin/acquisitions/${record.id}`, 'approved')}>Aprobar</button><button type="button" className="badge" onClick={() => handleStatusPatch(`/api/admin/acquisitions/${record.id}`, 'received')}>Recibido</button></div>
                  ) : (
                    <div className="badge-row"><button type="button" className="badge" onClick={() => handleStatusPatch(`/api/admin/interlibrary/${record.id}`, 'approved')}>Aprobar</button><button type="button" className="badge" onClick={() => handleStatusPatch(`/api/admin/interlibrary/${record.id}`, 'returned')}>Devuelto</button></div>
                  )}
                </article>
              ))}
              {inventory.slice(0, 4).map((item) => <article key={item.id} className="info-card"><strong>{item.materials?.title || item.copy_id || item.id}</strong><small>{item.condition_status} · {item.is_missing ? 'perdido' : 'ubicado'}</small></article>)}
              {notifications.slice(0, 4).map((item) => <article key={item.id} className="info-card"><strong>{item.title}</strong><small>{item.channel} · {item.read_at ? 'leída' : 'pendiente'}</small></article>)}
            </div>
          </article>
        </div>
      ) : null}
    </section>
  );
}

import type { Material } from '../lib/domain.js';

export type CatalogFilters = {
  kind: string;
  language: string;
  yearFrom: string;
  yearTo: string;
};

type SummaryItem = { kind: string; count: number };

type PortalCatalogPageProps = {
  search: string;
  filters: CatalogFilters;
  kindOptions: string[];
  languageOptions: string[];
  summary: SummaryItem[];
  materials: Material[];
  selectedMaterialId: string | null;
  materialDetail: any;
  onSearch: (value: string) => void;
  onFilters: (next: CatalogFilters) => void;
  onClearFilters: () => void;
  onSelectMaterial: (materialId: string) => void;
  onReserve: (materialId: string) => void;
};

export function PortalCatalogPage({
  search,
  filters,
  kindOptions,
  languageOptions,
  summary,
  materials,
  selectedMaterialId,
  materialDetail,
  onSearch,
  onFilters,
  onClearFilters,
  onSelectMaterial,
  onReserve
}: PortalCatalogPageProps) {
  return (
    <section className="page">
      <header className="page__header">
        <div>
          <div className="eyebrow">Catálogo</div>
          <h2>Materiales disponibles</h2>
          <p className="muted">Busca por título, autor, ISBN, DOI, año o palabra clave.</p>
        </div>

        <div className="page__headerActions">
          <button type="button" className="secondary" onClick={onClearFilters}>
            Limpiar filtros
          </button>
        </div>
      </header>

      <div className="panel">
        <div className="filters">
          <label>
            Buscar
            <input
              className="search-input"
              type="search"
              placeholder="Título, ISBN, DOI o palabra clave"
              value={search}
              onChange={(event) => onSearch(event.target.value)}
            />
          </label>

          <label>
            Tipo
            <select value={filters.kind} onChange={(event) => onFilters({ ...filters, kind: event.target.value })}>
              <option value="">Todos</option>
              {kindOptions.map((kind) => (
                <option key={kind} value={kind}>
                  {kind.replaceAll('_', ' ')}
                </option>
              ))}
            </select>
          </label>

          <label>
            Idioma
            <select value={filters.language} onChange={(event) => onFilters({ ...filters, language: event.target.value })}>
              <option value="">Todos</option>
              {languageOptions.map((language) => (
                <option key={language} value={language}>
                  {language}
                </option>
              ))}
            </select>
          </label>

          <label>
            Año desde
            <input
              inputMode="numeric"
              placeholder="2000"
              value={filters.yearFrom}
              onChange={(event) => onFilters({ ...filters, yearFrom: event.target.value })}
            />
          </label>

          <label>
            Año hasta
            <input
              inputMode="numeric"
              placeholder="2026"
              value={filters.yearTo}
              onChange={(event) => onFilters({ ...filters, yearTo: event.target.value })}
            />
          </label>
        </div>

        <div className="summary-strip summary-strip--cards">
          {summary.map((item) => (
            <article key={item.kind}>
              <strong>{item.count}</strong>
              <span>{item.kind.replaceAll('_', ' ')}</span>
            </article>
          ))}
        </div>
      </div>

      <section className="content-grid">
        <div className="panel">
          <div className="panel__header">
            <div>
              <span className="panel__eyebrow">Resultados</span>
              <h3>Catálogo</h3>
            </div>
            <span className="panel__meta">{materials.length} encontrados</span>
          </div>

          <div className="material-list material-list--grid">
            {materials.map((material) => (
              <button
                key={material.id}
                type="button"
                className={selectedMaterialId === material.id ? 'material-card is-active' : 'material-card'}
                onClick={() => onSelectMaterial(material.id)}
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
            {materials.length === 0 ? <div className="empty-state">No hay materiales para mostrar con esos filtros.</div> : null}
          </div>
        </div>

        <div className="panel panel--detail">
          <div className="panel__header">
            <div>
              <span className="panel__eyebrow">Detalle</span>
              <h3>Vista del ejemplar</h3>
            </div>
            {materialDetail ? (
              <button type="button" onClick={() => onReserve(materialDetail.id)}>
                Reservar
              </button>
            ) : null}
          </div>

          {materialDetail ? (
            <article className="detail-card">
              <h4>{materialDetail.title}</h4>
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

              <div className="mini-list mini-list--dense">
                {(materialDetail.material_copies ?? []).map((copy: any) => (
                  <article key={copy.id}>
                    <strong>{copy.copy_code || copy.barcode || copy.id}</strong>
                    <span>
                      {copy.status} · {copy.location || 'Sin ubicación'}
                    </span>
                  </article>
                ))}
              </div>
            </article>
          ) : (
            <div className="empty-state">Selecciona un material para ver su detalle.</div>
          )}
        </div>
      </section>
    </section>
  );
}


import type { DigitalAsset, Material, Profile } from '../lib/domain.js';
import { formatDate } from '../lib/format.js';

type SummaryItem = { kind: string; count: number };

type PortalHomePageProps = {
  profile: Profile | null;
  loadingData: boolean;
  search: string;
  summary: SummaryItem[];
  featuredMaterials: Material[];
  featuredAssets: DigitalAsset[];
  onSearch: (value: string) => void;
  onOpenCatalog: () => void;
  onOpenMyLibrary: () => void;
  onOpenDigital: () => void;
  onSelectFeatured: (materialId: string) => void;
};

export function PortalHomePage({
  profile,
  loadingData,
  search,
  summary,
  featuredMaterials,
  featuredAssets,
  onSearch,
  onOpenCatalog,
  onOpenMyLibrary,
  onOpenDigital,
  onSelectFeatured
}: PortalHomePageProps) {
  return (
    <section className="page">
      <header className="page__header">
        <div>
          <div className="eyebrow">Inicio</div>
          <h2>Encuentra, reserva y aprende</h2>
          <p className="muted">
            {profile?.can_access_digital
              ? 'Explora recursos físicos y digitales desde un solo panel.'
              : 'Explora el catálogo físico y gestiona tus reservas.'}
          </p>
        </div>

        <div className="page__headerActions">
          <button type="button" onClick={onOpenCatalog}>
            Ir al catálogo
          </button>
          <button type="button" className="secondary" onClick={onOpenMyLibrary}>
            Mis libros
          </button>
          {profile?.can_access_digital ? (
            <button type="button" className="secondary" onClick={onOpenDigital}>
              Biblioteca digital
            </button>
          ) : null}
        </div>
      </header>

      {loadingData ? <div className="page-banner">Sincronizando datos con Supabase...</div> : null}

      <div className="panel">
        <div className="panel__header">
          <div>
            <span className="panel__eyebrow">Búsqueda</span>
            <h3>¿Qué necesitas hoy?</h3>
          </div>
        </div>

        <input
          className="search-input search-input--hero"
          type="search"
          placeholder="Buscar por título, ISBN, DOI o palabra clave"
          value={search}
          onChange={(event) => onSearch(event.target.value)}
        />

        <div className="summary-strip summary-strip--cards">
          {summary.map((item) => (
            <article key={item.kind}>
              <strong>{item.count}</strong>
              <span>{item.kind.replaceAll('_', ' ')}</span>
            </article>
          ))}
        </div>
      </div>

      <div className="content-grid content-grid--wide">
        <div className="panel">
          <div className="panel__header">
            <div>
              <span className="panel__eyebrow">Flujo recomendado</span>
              <h3>Así funciona la biblioteca híbrida</h3>
            </div>
          </div>

          <ol className="stepper">
            <li>
              <strong>1. Busca</strong>
              <span>Filtra por título, autor, tema o palabras clave.</span>
            </li>
            <li>
              <strong>2. Reserva</strong>
              <span>Confirma tu reserva y espera la disponibilidad.</span>
            </li>
            <li>
              <strong>3. Retira o accede</strong>
              <span>Recoge el libro físico o abre el recurso digital.</span>
            </li>
            <li>
              <strong>4. Devuelve</strong>
              <span>Devuelve a tiempo o reporta incidencias.</span>
            </li>
          </ol>
        </div>

        <div className="panel">
          <div className="panel__header">
            <div>
              <span className="panel__eyebrow">Accesos rápidos</span>
              <h3>Tu panel</h3>
            </div>
          </div>

          <div className="shortcut-grid">
            <button type="button" className="shortcut-card" onClick={onOpenCatalog}>
              <strong>Catálogo</strong>
              <span>Buscar y reservar</span>
            </button>
            <button type="button" className="shortcut-card" onClick={onOpenMyLibrary}>
              <strong>Mis libros</strong>
              <span>Préstamos y reservas</span>
            </button>
            {profile?.can_access_digital ? (
              <button type="button" className="shortcut-card" onClick={onOpenDigital}>
                <strong>Biblioteca digital</strong>
                <span>PDF, ebooks y multimedia</span>
              </button>
            ) : (
              <div className="shortcut-card is-disabled">
                <strong>Biblioteca digital</strong>
                <span>Acceso bloqueado</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel__header">
          <div>
            <span className="panel__eyebrow">Destacados</span>
            <h3>Recientes en el catálogo</h3>
          </div>
          <button type="button" className="secondary" onClick={onOpenCatalog}>
            Abrir catálogo
          </button>
        </div>

        <div className="cover-grid">
          {featuredMaterials.map((material) => (
            <button
              key={material.id}
              type="button"
              className="cover-card"
              onClick={() => onSelectFeatured(material.id)}
            >
              <div className="cover-card__cover">
                {material.cover_url ? <img src={material.cover_url} alt={material.title} /> : <span>{material.kind}</span>}
              </div>
              <div className="cover-card__meta">
                <strong>{material.title}</strong>
                <small>
                  {material.publisher || 'Sin editorial'} · {material.publication_year || 'N/A'}
                </small>
              </div>
            </button>
          ))}
          {featuredMaterials.length === 0 ? <div className="empty-state">Aún no hay materiales para mostrar.</div> : null}
        </div>
      </div>

      {profile?.can_access_digital ? (
        <div className="panel">
          <div className="panel__header">
            <div>
              <span className="panel__eyebrow">Digital</span>
              <h3>Accesos destacados</h3>
            </div>
            <button type="button" className="secondary" onClick={onOpenDigital}>
              Ver digital
            </button>
          </div>

          <div className="asset-grid asset-grid--compact">
            {featuredAssets.map((asset) => (
              <article key={asset.id} className="asset-card">
                <div className="asset-card__cover">
                  {asset.materials.cover_url ? <img src={asset.materials.cover_url} alt={asset.materials.title} /> : <span>{asset.asset_type}</span>}
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
    </section>
  );
}


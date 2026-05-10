import type { DigitalAsset } from '../lib/domain.js';
import { formatDate } from '../lib/format.js';

type PortalDigitalPageProps = {
  assets: DigitalAsset[];
};

export function PortalDigitalPage({ assets }: PortalDigitalPageProps) {
  return (
    <section className="page">
      <header className="page__header">
        <div>
          <div className="eyebrow">Biblioteca digital</div>
          <h2>PDF, ebooks y recursos multimedia</h2>
          <p className="muted">Accede a los materiales autorizados según tus permisos.</p>
        </div>
      </header>

      <div className="panel">
        <div className="panel__header">
          <div>
            <span className="panel__eyebrow">Recursos</span>
            <h3>Accesos disponibles</h3>
          </div>
        </div>

        <div className="asset-grid">
          {assets.map((asset) => (
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
          {assets.length === 0 ? <div className="empty-state">No hay recursos digitales cargados.</div> : null}
        </div>
      </div>
    </section>
  );
}


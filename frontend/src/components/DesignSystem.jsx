import React from 'react';

export function PageHeader({ eyebrow, title, description, actions, children, className = '' }) {
  return (
    <section className={`gs-page-header ${className}`.trim()}>
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        {title ? <h1>{title}</h1> : null}
        {description ? <p>{description}</p> : null}
        {children}
      </div>
      {actions ? <div className="gs-actions heading-actions">{actions}</div> : null}
    </section>
  );
}

export function SectionContainer({ title, description, actions, children, className = '' }) {
  return (
    <section className={`gs-section ${className}`.trim()}>
      {(title || description || actions) ? (
        <header className="gs-section-head">
          <div>
            {title ? <h2>{title}</h2> : null}
            {description ? <p>{description}</p> : null}
          </div>
          {actions ? <div className="gs-actions">{actions}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function Card({ children, className = '', as: Component = 'article' }) {
  return <Component className={`gs-card ${className}`.trim()}>{children}</Component>;
}

export function KPICard({ label, value, helper, tone = 'neutral', progress = null, className = '' }) {
  const numericProgress = progress === null ? null : Math.max(0, Math.min(100, Number(progress) || 0));

  return (
    <article className={`gs-kpi-card ${tone} ${className}`.trim()}>
      <span>{label}</span>
      <strong>{value}</strong>
      {helper ? <small>{helper}</small> : null}
      {numericProgress !== null ? <i><b style={{ width: `${numericProgress}%` }} /></i> : null}
    </article>
  );
}

export function DashboardGrid({ children, className = '' }) {
  return <section className={`gs-dashboard-grid ${className}`.trim()}>{children}</section>;
}

export function FilterBar({ children, actions, className = '' }) {
  return (
    <section className={`gs-filter-bar ${className}`.trim()}>
      <div className="gs-filter-fields">{children}</div>
      {actions ? <div className="gs-actions">{actions}</div> : null}
    </section>
  );
}

export function ActionButtons({ children, align = 'right', className = '' }) {
  return <div className={`gs-actions ${align} ${className}`.trim()}>{children}</div>;
}

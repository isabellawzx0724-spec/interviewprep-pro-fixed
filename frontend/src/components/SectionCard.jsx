export default function SectionCard({ title, children, compact = false }) {
  return (
    <section className={`section-card ${compact ? 'compact' : ''}`}>
      <div className="section-header">
        <h3>{title}</h3>
      </div>
      <div className="section-body">{children}</div>
    </section>
  )
}

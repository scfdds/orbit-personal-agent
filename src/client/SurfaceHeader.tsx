import type { ReactNode } from 'react';
import { Search, X } from 'lucide-react';

export function SurfaceHeader({ title, trail, children }: { title: string; trail?: ReactNode; children?: ReactNode }) {
  return <header className="surface-header">
    <div className="surface-heading"><h1>{title}</h1>{trail}</div>
    {children && <div className="surface-actions">{children}</div>}
  </header>;
}

export function SurfaceSearch({ label, placeholder, value, onChange }: {
  label: string; placeholder: string; value: string; onChange: (value: string) => void;
}) {
  return <div className="surface-search">
    <Search size={15} aria-hidden="true"/>
    <input aria-label={label} placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)}/>
    {value && <button type="button" aria-label={`清除${label}`} onClick={() => onChange('')}><X size={13}/></button>}
  </div>;
}

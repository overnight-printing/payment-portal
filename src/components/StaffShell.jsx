import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Icon from './Icon';

const navigation = [
  { view: 'overview', href: '/dashboard', label: 'Overview', icon: 'grid' },
  { view: 'invoices', href: '/invoices', label: 'Invoices & payments', icon: 'document' },
  { view: 'send', href: '/send', label: 'Send payment link', icon: 'mail' },
  { view: 'customers', href: '/customers', label: 'Customers', icon: 'users' },
];

export default function StaffShell({ view, locked, onLogout, children }) {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const title = navigation.find((item) => item.view === view)?.label || 'Overview';
  const guard = (event) => { if (locked) event.preventDefault(); else setMenuOpen(false); };
  return <div className="staff-shell">
    <aside className="staff-sidebar">
      <Link className="workspace-brand" to="/dashboard" onClick={guard} aria-label="Overnight Printing Seattle dashboard"><img width={761} height={240} src="/logo.png" alt="Overnight Printing Seattle" /></Link>
      <div className="workspace-mobile-bar"><span>Payment portal</span><button type="button" className="workspace-menu-button" aria-label="Toggle staff navigation" aria-controls="workspace-navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}><Icon name={menuOpen ? 'x' : 'menu'} /></button></div>
      <nav id="workspace-navigation" aria-label="Staff navigation" className={`workspace-navigation ${menuOpen ? 'is-open' : ''}`}>
        {navigation.map((item) => <Link key={item.view} to={item.href} aria-current={view === item.view ? 'page' : undefined} aria-disabled={locked || undefined} onClick={guard}><Icon name={item.icon} /><span>{item.label}</span></Link>)}
      </nav>
      <div className="workspace-sidebar-footer"><span><Icon name="shield" size={16} /> Staff access</span><button type="button" disabled={locked || loggingOut} onClick={async () => { setLoggingOut(true); try { await onLogout(); } finally { setLoggingOut(false); } }}><Icon name="logout" /> Log out</button></div>
    </aside>
    <div className="workspace-main">
      <header className="workspace-topbar"><span className="workspace-title">{title}</span><form role="search" onSubmit={(event) => { event.preventDefault(); if (!locked) navigate(`/invoices?search=${encodeURIComponent(new FormData(event.currentTarget).get('search').trim())}`); }}><Icon name="search" size={18} /><input name="search" type="search" aria-label="Search all invoices" placeholder="Search invoices or customers" maxLength={100} disabled={locked} /></form><Link to="/send" className="btn btn-primary" aria-disabled={locked || undefined} onClick={guard}><Icon name="plus" size={18} /><span>Send payment link</span></Link></header>
      <main className="workspace-content" id="staff-main-content">{children}</main>
    </div>
  </div>;
}

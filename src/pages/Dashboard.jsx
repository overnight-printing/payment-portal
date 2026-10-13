import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon';
import { apiRequest, postJson } from '../lib/api';
import { dashboardQuery, validDashboard, validStaffDetail, validEmail, UUID, moneyCents } from '../../shared/validation';

const paymentLabels = { all: 'All', unpaid: 'Unpaid', paid: 'Paid', attention: 'Needs attention', processing: 'Processing', review: 'Needs review', expired: 'Expired', cancelled: 'Cancelled' };
const emailLabels = { accepted: 'Accepted', delivered: 'Delivered', bounced: 'Bounced', failed: 'Failed', delayed: 'Delayed', suppressed: 'Suppressed', complained: 'Spam complaint', not_requested: 'Not emailed', unknown: 'Unknown', pending: 'Unconfirmed' };
const kindLabels = { payment_link: 'Payment link', customer_receipt: 'Customer receipt', staff_receipt: 'Staff email' };
const reasonLabels = { payment_processing: 'Payment outcome is unconfirmed.', payment_review: 'Payment needs merchant review.', link_expired: 'Payment link has expired.', email_unconfirmed: 'Payment email send is unconfirmed.', email_failed: 'Payment email failed.', email_bounced: 'Payment email bounced. Contact the customer.', email_suppressed: 'Email is suppressed. Contact the customer.', email_complained: 'Customer reported this email as spam.', email_delayed: 'Payment email delivery is delayed.', receipt_unconfirmed: 'Receipt send is unconfirmed.', receipt_failed: 'Receipt email failed.', receipt_bounced: 'Receipt bounced. Contact the customer.', receipt_suppressed: 'Receipt is suppressed. Contact the customer.', receipt_complained: 'Customer reported the receipt as spam.', receipt_delayed: 'Receipt delivery is delayed.' };
const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const dates = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' });
const displayDate = (value) => value ? dates.format(new Date(value)) : '—';
const dollars = (cents) => currency.format(cents / 100);

function InvoiceDetails({ id, onClose, onOpen, onChanged, onSessionExpired }) {
  const dialog = useRef(null);
  const requests = useRef({});
  const acting = useRef(false);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [confirm, setConfirm] = useState('');
  const [copied, setCopied] = useState('');
  const expired = useEffectEvent(onSessionExpired);
  useEffect(() => { const element = dialog.current; element.showModal(); return () => element.close(); }, []);
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true); setError(''); setDetail(null);
      try {
        const { response, data } = await apiRequest(`/staff-link?id=${encodeURIComponent(id)}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (response.status === 401) { expired(); return; }
        if (!response.ok || !validStaffDetail(data) || data.link.id !== id) { setError('Could not load this invoice. Retry or select another invoice.'); return; }
        for (const [path, requestId] of Object.entries(requests.current)) if (data.emails.some((email) => email.request_id === requestId && email.state !== 'pending')) delete requests.current[path];
        setDetail(data);
      } catch { if (!controller.signal.aborted) setError('Could not load this invoice. Check your connection and retry.'); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    };
    void load(); return () => controller.abort();
  }, [id, refresh]);
  const action = async (path, extra = {}) => {
    if (acting.current) return;
    acting.current = true; setBusy(true); setMessage('');
    const body = { payment_link_id: id, ...extra };
    if (['/send-link-email', '/send-receipt-email', '/replace-link'].includes(path)) { requests.current[path] ||= crypto.randomUUID(); body.request_id = requests.current[path]; }
    try {
      const { response, data } = await apiRequest(path, { ...postJson(body), timeout: 45000 });
      if (response.status === 401) { onSessionExpired(); return; }
      if (!response.ok) { setMessage(response.status === 409 ? 'This action is unavailable for the current invoice state. Refresh its details.' : 'Could not confirm the outcome. Refresh before trying again.'); return; }
      if (path === '/replace-link' && UUID.test(data?.id || '') && data.replaced_id === id) { delete requests.current[path]; onOpen(data.id); return; }
      if (data?.id !== id) { setMessage('Could not confirm the outcome. Refresh before trying again.'); return; }
      if (path === '/cancel-link' && data.cancelled === true) setMessage('Payment link cancelled.');
      else if (path === '/check-payment') setMessage(data.code === 'paid' ? 'Payment confirmed.' : data.code === 'still_processing' ? 'Payment is still processing. Check again shortly.' : data.code === 'no_active_attempt' ? 'No unresolved payment attempt is recorded.' : 'Payment is still unconfirmed. Review the transaction with the merchant before taking further action.');
      else if (path === '/check-email-status') setMessage(data.code === 'provider_review' ? 'Delivery is still unconfirmed. Check the email provider before resending.' : data.code === 'no_delivery_update' ? 'No new delivery information is available.' : `Email status: ${emailLabels[data.email_status] || 'Unknown'}.`);
      else if (['accepted', 'failed', 'pending'].includes(data.email_status)) {
        setMessage(data.email_status === 'accepted' ? 'Email accepted for sending.' : data.email_status === 'failed' ? 'Email was not accepted. Check the recipient and try again.' : 'Email send is unconfirmed. Check its status before sending again.');
        if (data.email_status !== 'pending') delete requests.current[path];
      } else setMessage('Could not confirm the outcome. Refresh before trying again.');
    } catch { setMessage('Could not confirm the outcome. Refresh before trying again.'); }
    finally { acting.current = false; setBusy(false); setConfirm(''); setRefresh((value) => value + 1); onChanged(); }
  };
  const link = detail?.link;
  const url = `${window.location.origin}/pay/${id}`;
  const reasons = link?.attention_reasons || [];
  const eligible = link?.payment_status === 'unpaid' && link.email_status !== 'pending' && validEmail(link.customer_email);
  const receiptEligible = link?.payment_status === 'paid' && link.receipt_status !== 'pending' && validEmail(link.customer_email);
  return <dialog ref={dialog} className="invoice-detail-dialog" aria-labelledby="invoice-detail-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <header className="invoice-detail-header"><div><span>Invoice details</span><h2 id="invoice-detail-title">{link ? `#${link.order_number}` : 'Invoice'}</h2></div><button type="button" className="icon-button" aria-label="Close invoice details" disabled={busy} onClick={onClose} autoFocus><Icon name="x" /></button></header>
    <div className="invoice-detail-content">
      {loading && <p role="status">Loading invoice…</p>}
      {error && <div className="alert alert-error" role="alert"><span>{error}</span><button className="btn btn-secondary" type="button" onClick={() => setRefresh((value) => value + 1)}>Retry</button></div>}
      {message && <p className="detail-message" role="status">{message}</p>}
      {link && <>
        <div className="invoice-detail-amount"><strong>{dollars(moneyCents(link.amount))}</strong><span className={`dashboard-badge payment-${link.payment_status}`}>{paymentLabels[link.payment_status]}</span></div>
        {reasons.length > 0 && <section className="invoice-attention" aria-label="Needs attention"><h3>Needs attention</h3><ul>{reasons.map((reason) => <li key={reason}>{reasonLabels[reason]}</li>)}</ul>{['processing', 'review'].includes(link.payment_status) && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { void action('/check-payment'); }}>Check payment status</button>}</section>}
        <dl className="invoice-detail-fields"><div><dt>Customer</dt><dd>{link.customer_name || '—'}</dd></div><div><dt>Email</dt><dd>{link.customer_email || '—'}</dd></div><div><dt>Created</dt><dd>{displayDate(link.created_at)}</dd></div><div><dt>Link expires</dt><dd>{displayDate(link.expires_at)}</dd></div>{link.payment_status === 'paid' && <div><dt>Paid</dt><dd>{displayDate(link.paid_at)}</dd></div>}<div><dt>Payment link email</dt><dd><span className={`dashboard-badge email-${link.email_status}`}>{emailLabels[link.email_status]}</span></dd></div>{link.payment_status === 'paid' && <div><dt>Receipt email</dt><dd><span className={`dashboard-badge email-${link.receipt_status || 'unknown'}`}>{emailLabels[link.receipt_status || 'unknown']}</span></dd></div>}</dl>
        {link.replaced_by && <button type="button" className="text-button" onClick={() => onOpen(link.replaced_by)}>View replacement link</button>}
        {link.replaces_link_id && <button type="button" className="text-button" onClick={() => onOpen(link.replaces_link_id)}>View previous link</button>}
        <div className="invoice-detail-link"><label htmlFor="invoice-detail-link">Payment link</label><input id="invoice-detail-link" readOnly value={url} onFocus={(event) => event.currentTarget.select()} /><div className="detail-link-actions"><button className="btn btn-secondary" type="button" onClick={async () => { try { await navigator.clipboard.writeText(url); setCopied('Link copied'); } catch { setCopied('Select the payment link above to copy it.'); dialog.current.querySelector('#invoice-detail-link').focus(); } }}><Icon name="copy" size={16} /> Copy link</button><Link className="btn btn-secondary" to={`/pay/${id}`} target="_blank" rel="noopener noreferrer">{link.payment_status === 'paid' ? 'View receipt' : 'Open payment link'}</Link></div>{copied && <span role="status">{copied}</span>}</div>
        {eligible && <div className="invoice-email-action"><button type="button" className="btn btn-primary btn-full" disabled={busy} onClick={() => { void action('/send-link-email'); }}>{busy ? 'Working…' : ['unknown', 'not_requested'].includes(link.email_status) ? 'Send payment link' : 'Resend payment link'}</button><small>Original invoice attachments are not retained.</small></div>}
        {receiptEligible && <div className="invoice-email-action"><button type="button" className="btn btn-primary btn-full" disabled={busy} onClick={() => { void action('/send-receipt-email'); }}>{busy ? 'Working…' : ['unknown', 'not_requested'].includes(link.receipt_status || 'unknown') ? 'Send receipt' : 'Resend receipt'}</button></div>}
        {['unpaid', 'expired'].includes(link.payment_status) && <div className="invoice-manage-actions">{link.payment_status === 'expired' && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setConfirm('replace')}>Replace expired link</button>}<button type="button" className="text-button danger-text" disabled={busy} onClick={() => setConfirm('cancel')}>Cancel payment link</button></div>}
        {confirm && <div className="invoice-action-confirm" role="group" aria-label={confirm === 'cancel' ? 'Confirm cancellation' : 'Confirm replacement'}><p>{confirm === 'cancel' ? 'Cancel this link? Customers will no longer be able to pay through it.' : `Create a new link for ${dollars(moneyCents(link.amount))}? The old link will be disabled. No email will be sent yet.`}</p><div><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setConfirm('')}>Keep current link</button><button type="button" className="btn btn-primary" disabled={busy} onClick={() => { void action(confirm === 'cancel' ? '/cancel-link' : '/replace-link'); }}>{busy ? 'Working…' : confirm === 'cancel' ? 'Confirm cancellation' : 'Create replacement'}</button></div></div>}
        {!validEmail(link.customer_email) && <p className="detail-message">No valid customer email is recorded.</p>}
        <section className="invoice-email-history"><div><h3>Email history</h3><button type="button" className="text-button" disabled={busy || loading} onClick={() => setRefresh((value) => value + 1)}>Refresh</button></div>{detail.emails.length ? <ol>{detail.emails.map((email) => <li key={email.request_id}><span className={`history-dot email-${email.delivery_status || email.state}`} /><div><strong>{kindLabels[email.kind || 'payment_link']} · {emailLabels[email.delivery_status || email.state]}</strong><time dateTime={email.created_at}>Attempted {displayDate(email.created_at)}</time>{email.kind !== 'staff_receipt' && (email.can_check || email.state === 'pending') && <button type="button" className="text-button" disabled={busy} onClick={() => { void action('/check-email-status', { email_request_id: email.request_id }); }}>Check email status</button>}</div></li>)}</ol> : <p>No recorded email attempts. Older send history may be unknown.</p>}<small>Delivered means accepted by the recipient’s mail server.</small></section>
      </>}
    </div>
  </dialog>;
}

export default function Dashboard({ view = 'overview', onSessionExpired }) {
  const [params, setParams] = useSearchParams();
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [copy, setCopy] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const expired = useEffectEvent(onSessionExpired);
  const isCustomers = view === 'customers';
  const isOverview = view === 'overview';
  const query = dashboardQuery(new URLSearchParams({ search: params.get('search') || '', payment: params.get('payment') || 'all', email: params.get('email') || 'all', offset: params.get('offset') || '0', start: params.get('start') || '', end: params.get('end') || '', customer: params.get('customer') || '', view: isCustomers ? 'customers' : 'links', limit: isOverview ? '8' : '25' }));
  const queryString = query ? new URLSearchParams(query).toString() : '';
  const offset = query?.offset || 0, limit = query?.limit || 25;
  const invoiceId = params.get('invoice');
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true); setError(''); setSnapshot(null); setCopy(null);
      if (!queryString) { setError('Check the filters and date range.'); setLoading(false); return; }
      try {
        const { response, data } = await apiRequest(`/staff-links?${queryString}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (response.status === 401) { expired(); return; }
        if (!response.ok || !validDashboard(data) || data.offset !== offset || data.limit !== limit || isCustomers !== Array.isArray(data.customers)) { setError(response.status === 429 ? 'Too many requests. Wait a minute, then retry.' : 'Could not load payment history. Try again.'); return; }
        setSnapshot(data);
      } catch { if (!controller.signal.aborted) setError('Could not load payment history. Check your connection and retry.'); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    };
    void load(); return () => controller.abort();
  }, [queryString, offset, limit, isCustomers, refresh]);
  const change = (values) => { const next = new URLSearchParams(params); next.delete('invoice'); next.delete('offset'); for (const [key, value] of Object.entries(values)) { if (value) next.set(key, value); else next.delete(key); } setParams(next); };
  const selectInvoice = (id) => { const next = new URLSearchParams(params); next.set('invoice', id); setParams(next); };
  const closeInvoice = () => { const next = new URLSearchParams(params); next.delete('invoice'); setParams(next); };
  const summary = snapshot?.summary;
  const rows = isCustomers ? snapshot?.customers : snapshot?.links;
  const copyLink = async (id) => { try { await navigator.clipboard.writeText(`${window.location.origin}/pay/${id}`); setCopy({ id, state: 'copied' }); } catch { setCopy({ id, state: 'failed' }); } };
  const exportCsv = async () => {
    if (exporting || !queryString) return;
    setExporting(true); setExportError('');
    const controller = new AbortController(), timer = window.setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(`/staff-export?${queryString}`, { credentials: 'same-origin', signal: controller.signal });
      if (response.status === 401) { onSessionExpired(); return; }
      if (!response.ok || !response.headers.get('Content-Type')?.startsWith('text/csv')) { setExportError(response.status === 413 ? 'More than 10,000 links match. Narrow the filters before exporting.' : 'Could not export payment history. Try again.'); return; }
      const url = URL.createObjectURL(await response.blob()), anchor = document.createElement('a');
      anchor.href = url; anchor.download = 'payment-history.csv'; document.body.append(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setExportError('Could not export payment history. Check your connection and try again.'); }
    finally { window.clearTimeout(timer); setExporting(false); }
  };
  return <>
    <header className="workspace-page-heading"><div><h1>{isOverview ? 'Overview' : isCustomers ? 'Customers' : 'Invoices & payments'}</h1>{query?.customer && <p>Customer invoice history <button type="button" className="text-button" onClick={() => change({ customer: '' })}>Show all invoices</button></p>}</div><div className="workspace-heading-actions">{!isOverview && !isCustomers && <button type="button" className="btn btn-secondary" disabled={loading || exporting || !queryString} onClick={() => { void exportCsv(); }}>{exporting ? 'Exporting…' : 'Export CSV'}</button>}<button type="button" className="btn btn-secondary" disabled={loading} onClick={() => setRefresh((value) => value + 1)}><Icon name="refresh" size={17} /> Refresh</button></div></header>{exportError && <p className="alert alert-error" role="alert">{exportError}</p>}
    {isOverview && <section className="workspace-summary" aria-label="Payment overview">
      {[{ title: 'Unpaid', value: summary ? dollars(summary.unpaid_cents) : '—', detail: summary ? `${summary.unpaid} links` : '—', icon: 'document', tone: 'amber', href: '/invoices?payment=unpaid' }, { title: 'Paid', value: summary ? dollars(summary.paid_cents) : '—', detail: summary ? `${summary.paid} links` : '—', icon: 'check', tone: 'green', href: '/invoices?payment=paid' }, { title: 'Emails accepted', value: summary ? (summary.sent ?? 0).toLocaleString() : '—', detail: 'Accepted or delivered', icon: 'mail', tone: 'blue', href: '/invoices?email=sent' }, { title: 'Needs attention', value: summary ? (summary.attention ?? 0).toLocaleString() : '—', detail: 'Payment or email issues', icon: 'warning', tone: 'amber', href: '/invoices?payment=attention' }].map((card) => <Link key={card.title} to={card.href} className="workspace-summary-card"><span className={`summary-icon ${card.tone}`}><Icon name={card.icon} /></span><h2>{card.title}</h2><strong>{card.value}</strong><span>{card.detail}</span></Link>)}
    </section>}
    <section className="workspace-records" aria-label={isCustomers ? 'Customer history' : 'Invoice history'}>
      <div className="records-toolbar">{isOverview ? <><h2>Recent invoices</h2><Link to="/invoices" className="text-button">View all invoices</Link></> : <form className="dashboard-filters" onSubmit={(event) => { event.preventDefault(); const fields = new FormData(event.currentTarget); change({ search: String(fields.get('search') || '').trim(), start: String(fields.get('start') || ''), end: String(fields.get('end') || '') }); }}><div className="dashboard-search"><label htmlFor="dashboard-search">Search</label><div><input key={params.get('search') || ''} id="dashboard-search" name="search" type="search" placeholder={isCustomers ? 'Customer or email' : 'Invoice, customer or email'} maxLength={100} defaultValue={params.get('search') || ''} /><button type="submit" className="btn btn-secondary"><Icon name="search" size={18} /><span>Search</span></button></div></div>{!isCustomers && <><div><label htmlFor="dashboard-start">Created from</label><input key={params.get('start') || ''} id="dashboard-start" name="start" type="date" defaultValue={params.get('start') || ''} /></div><div><label htmlFor="dashboard-end">Created to</label><input key={params.get('end') || ''} id="dashboard-end" name="end" type="date" defaultValue={params.get('end') || ''} /></div><div><label htmlFor="dashboard-email">Email</label><select id="dashboard-email" value={query?.email || 'all'} onChange={(event) => change({ email: event.target.value })}><option value="all">All emails</option><option value="sent">Accepted or delivered</option>{Object.entries(emailLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div></>}</form>}</div>
      {!isCustomers && <nav className="invoice-status-tabs" aria-label="Payment filters">{['all', 'unpaid', 'paid', 'attention', 'expired'].map((value) => <button key={value} type="button" aria-pressed={(query?.payment || 'all') === value} onClick={() => change({ payment: value })}>{paymentLabels[value]}{value === 'all' && summary ? <span>{summary.total}</span> : null}</button>)}<label className="sr-only" htmlFor="dashboard-payment">More payment filters</label><select id="dashboard-payment" value={query?.payment || 'all'} onChange={(event) => change({ payment: event.target.value })}>{Object.entries(paymentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></nav>}
      <div className="records-status"><p role="status">{loading ? 'Loading…' : error ? 'History unavailable' : `${snapshot.total.toLocaleString()} ${isCustomers ? 'customers' : 'links'}`}</p>{!isOverview && (params.get('search') || params.get('payment') || params.get('email') || params.get('start') || params.get('end') || params.get('customer')) && <button type="button" className="text-button" onClick={() => setParams({})}>Clear filters</button>}</div>
      {error && <div className="alert alert-error" role="alert"><span>{error}</span><button type="button" className="btn btn-secondary" onClick={() => setRefresh((value) => value + 1)}>Retry</button></div>}
      {snapshot && <>
        <table className={`dashboard-table ${isCustomers ? 'customer-table' : 'invoice-table'}`} role="table"><caption className="sr-only">{isCustomers ? 'Customers grouped by recorded email' : 'Invoice links, newest first'}</caption><thead role="rowgroup"><tr role="row">{(isCustomers ? ['Customer', 'Invoices', 'Paid', 'Unpaid', 'Last activity', 'Action'] : ['Invoice', 'Customer', 'Amount', 'Email', 'Payment', 'Created', 'Action']).map((label) => <th scope="col" role="columnheader" key={label}>{label}</th>)}</tr></thead><tbody role="rowgroup">{isCustomers ? rows.map((customer) => <tr role="row" key={customer.key}><td role="cell" className="dashboard-customer" data-label="Customer"><Link className="invoice-name-button customer-name-link" to={`/invoices?customer=${encodeURIComponent(customer.key)}`}><strong>{customer.name}</strong><span>{customer.email || 'No email recorded'}</span></Link></td><td role="cell" data-label="Invoices">{customer.total}{customer.cancelled > 0 && <span className="customer-count">{customer.cancelled} cancelled</span>}</td><td role="cell" data-label="Paid" className="dashboard-amount">{dollars(customer.paid_cents)}<span className="customer-count">{customer.paid} paid</span></td><td role="cell" data-label="Unpaid" className="dashboard-amount">{dollars(customer.unpaid_cents)}<span className="customer-count">{customer.unpaid} unpaid</span></td><td role="cell" data-label="Last activity">{displayDate(customer.last_created_at)}</td><td role="cell" data-label="Action"><Link className="text-button" to={`/invoices?customer=${encodeURIComponent(customer.key)}`}>View invoices</Link></td></tr>) : rows.map((link) => <tr role="row" key={link.id}><td role="cell" className="dashboard-invoice" data-label="Invoice"><button type="button" className="invoice-name-button" onClick={() => selectInvoice(link.id)}>#{link.order_number}</button></td><td role="cell" className="dashboard-customer" data-label="Customer"><strong>{link.customer_name || '—'}</strong><span>{link.customer_email || '—'}</span></td><td role="cell" data-label="Amount" className="dashboard-amount">{dollars(moneyCents(link.amount))}</td><td role="cell" data-label="Email"><span className={`dashboard-badge email-${link.payment_status === 'paid' ? link.receipt_status || 'unknown' : link.email_status}`}>{link.payment_status === 'paid' ? `Receipt · ${emailLabels[link.receipt_status || 'unknown']}` : emailLabels[link.email_status]}</span></td><td role="cell" data-label="Payment"><span className={`dashboard-badge payment-${link.payment_status}`}>{paymentLabels[link.payment_status]}</span>{link.payment_status === 'paid' && link.paid_at && <span className="dashboard-paid-date">{displayDate(link.paid_at)}</span>}</td><td role="cell" data-label="Created">{displayDate(link.created_at)}</td><td role="cell" data-label="Action"><div className="dashboard-link-actions"><button type="button" className="icon-button" title="View invoice details" aria-label={`View invoice ${link.order_number}`} onClick={() => selectInvoice(link.id)}><Icon name="document" size={18} /></button><button type="button" className="icon-button" aria-label={`Copy payment link for invoice ${link.order_number}`} onClick={() => { void copyLink(link.id); }}><Icon name="copy" size={16} /></button></div>{copy?.id === link.id && (copy.state === 'copied' ? <span role="status" className="status-success">Link copied</span> : <div className="dashboard-copy-fallback"><label htmlFor={`copy-${link.id}`}>Copy this link</label><input id={`copy-${link.id}`} readOnly value={`${window.location.origin}/pay/${link.id}`} onFocus={(event) => event.currentTarget.select()} /><span role="status">Select the link to copy it.</span></div>)}</td></tr>)}</tbody></table>
        {!rows.length && <div className="dashboard-empty"><h2>{summary.total ? 'No matching records' : 'No invoices yet'}</h2>{summary.total ? <button type="button" className="btn btn-secondary" onClick={() => setParams({})}>Clear filters</button> : <Link to="/send" className="btn btn-primary">Send payment link</Link>}</div>}
        {!isOverview && snapshot.total > limit && <nav className="dashboard-pagination" aria-label="History pages"><button type="button" className="btn btn-secondary" disabled={!offset} onClick={() => { const next = new URLSearchParams(params); next.set('offset', String(Math.max(0, offset - limit))); setParams(next); }}>Previous</button><span>Page {Math.floor(offset / limit) + 1} of {Math.ceil(snapshot.total / limit)}</span><button type="button" className="btn btn-secondary" disabled={offset + limit >= snapshot.total || offset + limit > 100000} onClick={() => { const next = new URLSearchParams(params); next.set('offset', String(offset + limit)); setParams(next); }}>Next</button></nav>}
      </>}
    </section>
    <p className="dashboard-note">History includes cancelled links; unpaid totals exclude them. Historical email activity may be unknown.</p>
    {UUID.test(invoiceId || '') && <InvoiceDetails key={invoiceId} id={invoiceId} onClose={closeInvoice} onOpen={selectInvoice} onChanged={() => setRefresh((value) => value + 1)} onSessionExpired={onSessionExpired} />}
  </>;
}

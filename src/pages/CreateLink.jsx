import { useState, useRef, useEffect, useEffectEvent } from 'react';
import Icon from '../components/Icon';
import Dashboard from './Dashboard';
import { Link, useLocation } from 'react-router-dom';
import StaffShell from '../components/StaffShell';

import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { apiRequest, postJson, withDeadline } from '../lib/api';
import { UUID, MAX_FILES, MAX_FILE_BYTES, MAX_ATTACHMENT_BYTES, moneyCents, decimalAmount, invoiceFields, batchIssue } from '../../shared/validation';

let pdfPromise;
function loadPdfJs() {
  pdfPromise ||= import('pdfjs-dist').then((pdf) => { pdf.GlobalWorkerOptions.workerSrc = pdfWorkerUrl; return pdf; });
  return pdfPromise;
}

// Extract all text from a PDF file as a single string, grouping by line height to preserve document structure
async function extractTextFromPdf(arrayBuffer) {
  const pdfjsLib = await loadPdfJs();
  const task = pdfjsLib.getDocument({ data: arrayBuffer, isEvalSupported: false, maxImageSize: 20000000 });
  const timer = window.setTimeout(() => { void task.destroy(); }, 20000);
  try {
  const pdf = await task.promise;
  if (pdf.numPages > 20) throw new Error('too_many_pages');
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    
    const items = content.items.map(item => ({
      str: item.str,
      x: item.transform[4],
      y: item.transform[5],
      height: item.transform[3],
    }));

    if (items.length === 0) {
      pages.push('');
      continue;
    }

    // Sort by y descending (top of page first), then x ascending
    items.sort((a, b) => b.y - a.y || a.x - b.x);

    const lines = [];
    let currentLine = [];
    let lastY = null;

    for (const item of items) {
      if (lastY === null) {
        currentLine.push(item);
        lastY = item.y;
      } else {
        const yDiff = Math.abs(item.y - lastY);
        const threshold = Math.max(5, item.height / 2);
        if (yDiff <= threshold) {
          currentLine.push(item);
        } else {
          currentLine.sort((a, b) => a.x - b.x);
          lines.push(currentLine.map(it => it.str).join(' '));
          currentLine = [item];
          lastY = item.y;
        }
      }
    }
    
    if (currentLine.length > 0) {
      currentLine.sort((a, b) => a.x - b.x);
      lines.push(currentLine.map(it => it.str).join(' '));
    }

    pages.push(lines.join('\n'));
  }
  return pages.join('\n');
  } finally { window.clearTimeout(timer); await task.destroy(); }
}

// Resize + compress an image File/Blob to max 1500px wide, JPEG quality 0.85
// Returns base64 string (without the data:...;base64, prefix)
async function compressImageToBase64(arrayBuffer, mimeType) {
  return new Promise((resolve, reject) => {
    const blob = new Blob([arrayBuffer], { type: mimeType || 'image/png' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      try {
      if (img.width * img.height > 20000000) { URL.revokeObjectURL(url); reject(new Error('image_too_large')); return; }
      const MAX_WIDTH = 1500;
      let { width, height } = img;
      const scale = Math.min(1, MAX_WIDTH / Math.max(width, height));
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      // Export as JPEG for smaller payload; strip the data URL prefix
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      resolve(dataUrl.replace(/^data:image\/jpeg;base64,/, ''));
      } catch { reject(new Error('image_read_failed')); }
      finally { URL.revokeObjectURL(url); }
    };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

const ACCEPTED_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
const ACCEPTED_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.webp'];

function staffRequestMessage(status, context) {
  if (status === 401) return 'Your staff session is invalid or expired. Sign in again.';
  if (context === 'invoice') return 'The invoice could not be analyzed. Enter the details manually or try the file again.';
  if (context === 'link') return 'The payment link could not be created. Review the details and try again.';
  return 'The request could not be completed. Check your connection and try again.';
}

export default function CreateLink() {
  const { pathname } = useLocation();
  const view = pathname === '/send' ? 'send' : pathname === '/invoices' ? 'invoices' : pathname === '/customers' ? 'customers' : 'overview';
  const dashboard = view !== 'send';
  const [sessionReady, setSessionReady] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [passcodeEntry, setPasscodeEntry] = useState('');
  const [passcodeError, setPasscodeError] = useState(null);
  const [showPasscode, setShowPasscode] = useState(false);

  const [billingEdits, setBillingEdits] = useState({});
  const [uploadedInvoices, setUploadedInvoices] = useState([]);
  const [lastLinkWasEmailed, setLastLinkWasEmailed] = useState(true);

  const [isLoading, setIsLoading] = useState(false);
  const [activeSubmitAction, setActiveSubmitAction] = useState('');
  const [error, setError] = useState(null);
  const [createdLink, setCreatedLink] = useState('');
  const [copyStatus, setCopyStatus] = useState('idle');
  const [creationUncertain, setCreationUncertain] = useState(false);
  const [emailFailed, setEmailFailed] = useState(false);
  const [emailUnconfirmed, setEmailUnconfirmed] = useState(false);
  const [linkSummary, setLinkSummary] = useState(null);

  // Drag-and-drop state
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const fileInputRef = useRef(null);
  const uploadButtonRef = useRef(null);
  const dragCounterRef = useRef(0);
  const submissionRef = useRef(false);
  const filesRef = useRef(new Map());
  const scanControllersRef = useRef(new Map());
  const workflowRef = useRef(0);
  const requestRef = useRef(null);

  const resetBilling = () => {
    setBillingEdits({});
  };

  const clearWorkflow = () => {
    workflowRef.current++;
    scanControllersRef.current.forEach((controller) => controller.abort());
    scanControllersRef.current.clear(); filesRef.current.clear();
    resetBilling(); setUploadedInvoices([]); setCreatedLink(''); setLinkSummary(null); setError(null);
    setPasscodeEntry(''); setShowPasscode(false); setCreationUncertain(false); requestRef.current = null;
    dragCounterRef.current = 0; setIsDraggingOver(false);
    sessionStorage.removeItem('portal_creation_request');
  };

  const logout = async (notifyServer = true) => {
    if (notifyServer) {
      try {
        const { response } = await apiRequest('/staff-session', { method: 'DELETE' });
        if (!response.ok) throw new Error();
      } catch { setError('We could not end the session. Check your connection and try logging out again.'); return; }
    }
    clearWorkflow(); setSessionReady(false);
  };

  useEffect(() => {
    const controller = new AbortController();
    const scans = scanControllersRef.current;
    const workflow = workflowRef;
    // Remove the legacy reusable credential; only an HttpOnly server session is used now.
    try { localStorage.removeItem('staff_passcode'); } catch { /* Browser storage can be unavailable. */ }
    const check = async () => {
      try {
        const { response, data } = await apiRequest('/staff-session', { signal: controller.signal });
        if (!controller.signal.aborted) setSessionReady(response.ok && data?.authenticated === true);
      } catch { /* Keep access closed if session verification fails. */ }
      finally { if (!controller.signal.aborted) setCheckingSession(false); }
    };
    void check();
    return () => { controller.abort(); workflow.current++; scans.forEach((scan) => scan.abort()); };
  }, []);

  useEffect(() => {
    if (!sessionReady || dashboard) return;
    const controller = new AbortController();
    const recover = async () => {
      const requestId = sessionStorage.getItem('portal_creation_request');
      if (!UUID.test(requestId || '')) return;
      try {
        const { response, data } = await apiRequest(`/create-link?request_id=${encodeURIComponent(requestId)}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (response.ok && UUID.test(data?.id || '')) {
          setCreatedLink(`${window.location.origin}/pay/${data.id}`); setLastLinkWasEmailed(data.email_sent === true); setEmailFailed(data.email_status === 'failed'); setEmailUnconfirmed(['pending', 'unknown'].includes(data.email_status));
          sessionStorage.removeItem('portal_creation_request');
        } else if (response.status !== 404) setError('An earlier creation request still needs recovery. Re-enter the same billing details or contact the administrator.');
      } catch { if (!controller.signal.aborted) setError('An earlier creation request could not be checked. Retry after your connection recovers.'); }
    };
    void recover();
    return () => controller.abort();
  }, [sessionReady, dashboard]);

  const parsed = uploadedInvoices.filter((inv) => ['success', 'review'].includes(inv.status));
  const total = parsed.reduce((sum, inv) => sum + (moneyCents(inv.amount) || 0), 0);
  const first = parsed[0];
  const defaults = { orderNumber: parsed.every((inv) => inv.orderNumber.trim()) ? parsed.map((inv) => inv.orderNumber).join(', ') : '', amount: total > 0 && parsed.every((inv) => inv.status === 'success' && moneyCents(inv.amount) !== null) ? decimalAmount(total) : '', customerName: first?.customerName || '', companyName: first?.companyName || '', customerEmail: first?.customerEmail || '' };
  const { orderNumber, amount, customerName, companyName, customerEmail } = { ...defaults, ...billingEdits };
  const autofilledFields = new Set(Object.keys(defaults).filter((name) => defaults[name] && !(name in billingEdits)));
  const editField = (name, value) => {
    setBillingEdits((previous) => ({ ...previous, [name]: value }));
  };

  const processInvoiceFile = async (file) => {
    if (!file || !sessionReady || submissionRef.current || creationUncertain) return;
    if (!ACCEPTED_TYPES.includes(file.type) && !ACCEPTED_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext))) { setError('Choose a PDF, PNG, JPEG or WebP invoice.'); return; }
    if (!file.size || file.size > MAX_FILE_BYTES || filesRef.current.size >= MAX_FILES || [...filesRef.current.values()].reduce((sum, item) => sum + item.file.size, file.size) > MAX_ATTACHMENT_BYTES) { setError(`Use up to ${MAX_FILES} invoices, at most 5 MB each and 10 MB total.`); return; }
    if ([...filesRef.current.values()].some((item) => item.file.name === file.name && item.file.size === file.size && item.file.lastModified === file.lastModified)) { setError('This file is already in the batch. Remove it before adding a replacement.'); return; }
    const id = crypto.randomUUID();
    const epoch = workflowRef.current;
    filesRef.current.set(id, { file, hash: '' });
    setError(null);
    setUploadedInvoices((prev) => [...prev, { id, filename: file.name, orderNumber: '', amount: '', customerName: '', companyName: '', customerEmail: '', attachment: null, status: 'scanning', message: 'Reading invoice…' }]);
    const controller = new AbortController();
    scanControllersRef.current.set(id, controller);
    const current = () => workflowRef.current === epoch && filesRef.current.has(id) && !controller.signal.aborted;
    const update = (values) => { if (current()) setUploadedInvoices((prev) => prev.map((inv) => inv.id === id ? { ...inv, ...values } : inv)); };
    try {
      const buffer = await withDeadline(file.arrayBuffer());
      if (!current()) return;
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
      if ([...filesRef.current.entries()].some(([otherId, item]) => otherId !== id && item.hash === hash)) {
        filesRef.current.delete(id); setUploadedInvoices((prev) => prev.filter((inv) => inv.id !== id)); setError('Duplicate file content found. The original invoice was kept.'); return;
      }
      filesRef.current.get(id).hash = hash;
      let binary = '';
      const bytes = new Uint8Array(buffer);
      for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      const attachment = { content: btoa(binary), filename: file.name };
      update({ attachment });
      const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      const body = isPdf ? { text: await withDeadline(extractTextFromPdf(buffer), 25000) } : { imageBase64: await withDeadline(compressImageToBase64(buffer, file.type)) };
      if (!current()) return;
      if (isPdf && !body.text.trim()) { update({ status: 'review', message: 'This PDF has no readable text. Enter its details manually and review the attachment.' }); return; }
      const { response, data } = await apiRequest('/analyze-invoice', { ...postJson(body), timeout: 25000, signal: controller.signal });
      if (!current()) return;
      if (response.status === 401) { await logout(false); setPasscodeError('Your staff session expired. Sign in again.'); return; }
      const fields = response.ok ? invoiceFields(data) : null;
      if (!fields) { update({ status: 'review', message: 'Automatic reading failed. Enter the details manually and review this attachment.' }); return; }
      const warnings = Array.isArray(data.warnings) ? data.warnings.filter((value) => typeof value === 'string').slice(0, 8) : [];
      const complete = fields.order_number && fields.amount && fields.customer_name && fields.customer_email && !warnings.length;
      update({ orderNumber: fields.order_number, amount: fields.amount, customerName: fields.customer_name, companyName: fields.company_name, customerEmail: fields.customer_email, status: complete ? 'success' : 'review', message: complete ? 'Extracted — verify the billing details.' : 'Some details need review. Check the invoice and enter missing values.' });
    } catch {
      update({ status: 'review', message: 'The invoice could not be analyzed. Review a readable attachment or remove it and enter details manually.' });
    } finally { scanControllersRef.current.delete(id); }
  };

  const onWindowFileDrag = useEffectEvent((event) => {
    if (!Array.from(event.dataTransfer?.types || []).includes('Files')) return;
    event.preventDefault();
    const locked = submissionRef.current || creationUncertain;
    if (event.type === 'drop') {
      dragCounterRef.current = 0; setIsDraggingOver(false);
      if (!locked) Array.from(event.dataTransfer.files).forEach(processInvoiceFile);
    } else if (!locked) {
      if (event.type === 'dragenter') { dragCounterRef.current++; setIsDraggingOver(true); }
      if (event.type === 'dragleave') {
        dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
        if (!dragCounterRef.current) setIsDraggingOver(false);
      }
      if (event.type === 'dragover') event.dataTransfer.dropEffect = 'copy';
    } else event.dataTransfer.dropEffect = 'none';
  });

  useEffect(() => {
    if (!sessionReady || dashboard) return;
    const handleDrag = (event) => onWindowFileDrag(event);
    const clearDrag = () => { dragCounterRef.current = 0; setIsDraggingOver(false); };
    const events = ['dragenter', 'dragleave', 'dragover', 'drop'];
    events.forEach((name) => window.addEventListener(name, handleDrag));
    window.addEventListener('blur', clearDrag);
    window.addEventListener('dragend', clearDrag);
    return () => {
      events.forEach((name) => window.removeEventListener(name, handleDrag));
      window.removeEventListener('blur', clearDrag);
      window.removeEventListener('dragend', clearDrag);
      dragCounterRef.current = 0;
    };
  }, [sessionReady, dashboard]);

  const handleVerifyPasscode = async (event) => {
    event.preventDefault(); setPasscodeError(null); setIsLoading(true);
    try {
      const { response, data } = await apiRequest('/staff-session', postJson({ passcode: passcodeEntry }));
      if (!response.ok || data?.authenticated !== true) {
        const fields = Array.isArray(data?.configuration_fields) ? data.configuration_fields.filter((name) => ['APP_ENV', 'SESSION_SECRET', 'STAFF_PASSCODE', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].includes(name)) : [];
        let message = response.status === 401 ? 'The passcode was not accepted. Try again.' : 'Staff access is temporarily unavailable. Contact the administrator.';
        if (data?.code === 'configuration_unavailable' && fields.length) message = `Server setup is incomplete. Check ${fields.join(', ')} in Cloudflare Production settings, then redeploy.`;
        else if (data?.code === 'staff_rate_limit_unavailable') message = 'The sign-in database check failed. Verify the Supabase connection and portal_rate_limit migration.';
        else if (data?.code === 'invalid_origin') message = 'This portal address does not match PUBLIC_ORIGIN. Check the Cloudflare Production setting.';
        else if (response.status === 429) message = 'Too many attempts. Wait a few minutes before signing in again.';
        setPasscodeError(message);
        return;
      }
      setPasscodeEntry(''); setShowPasscode(false); setSessionReady(true);
    } catch { setPasscodeError('We could not verify access. Check your connection and try again.'); }
    finally { setIsLoading(false); }
  };

  if (checkingSession) return <main className="card payment-card state-card" aria-busy="true"><h1>Checking staff session</h1><p role="status">Verifying access…</p></main>;

  if (!sessionReady) {
    return (
      <main className="passcode-container fade-in">
        <div className="passcode-card">
          <div className="passcode-logo-container">
            <img width={761} height={240} src="/logo.png" alt="Overnight Printing Seattle" className="passcode-logo" />
          </div>
          <h1 className="passcode-title">Staff portal</h1>
          
          {passcodeError && (
            <div className="alert alert-error" role="alert">
              <Icon name="warning" />
              <div><strong>Access failed</strong><p>{passcodeError}</p></div>
            </div>
          )}

          <form onSubmit={handleVerifyPasscode}>
            <div className="form-group align-left">
              <label htmlFor="staffPasscode">Passcode</label>
              <div className="password-control">
                <input
                  id="staffPasscode"
                  type={showPasscode ? 'text' : 'password'}
                  required
                  value={passcodeEntry}
                  onChange={(e) => setPasscodeEntry(e.target.value)}
                  disabled={isLoading}
                  autoComplete="current-password"
                  placeholder="Enter passcode"
                />
                <button type="button" className="text-button" onClick={() => setShowPasscode((shown) => !shown)} disabled={isLoading}>
                  {showPasscode ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
            <button type="submit" className="btn btn-primary btn-full" disabled={isLoading}>
              {isLoading ? <><span className="spinner" aria-hidden="true" /> Verifying…</> : 'Access portal'}
            </button>
          </form>
        </div>
      </main>
    );
  }

  const locked = isLoading || creationUncertain;
  if (dashboard) return <StaffShell view={view} locked={locked} onLogout={logout}>{error && <div className="alert alert-error" role="alert">{error}</div>}<Dashboard key={view} view={view} onSessionExpired={() => { void logout(false); setPasscodeError('Your staff session expired. Sign in again.'); }} /></StaffShell>;

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files);
    if (files.length > 0) {
      files.forEach(processInvoiceFile);
    }
    e.target.value = ''; // reset so same file can be dropped again
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (submissionRef.current) return;
    const issue = batchIssue(uploadedInvoices);
    if (!requestRef.current && issue) { setError(issue); return; }
    submissionRef.current = true;
    const epoch = workflowRef.current;
    const shouldSendEmail = requestRef.current ? requestRef.current.send_email : event.nativeEvent.submitter?.value === 'send-email';
    setIsLoading(true); setActiveSubmitAction(shouldSendEmail ? 'send-email' : 'link-only'); setError(null); setCopyStatus('idle');
    try {
      if (!requestRef.current) {
        const cents = moneyCents(amount);
        if (!cents) { setError('Enter a positive USD amount with at most two decimal places.'); return; }
        const storedId = sessionStorage.getItem('portal_creation_request');
        const requestId = UUID.test(storedId || '') ? storedId : crypto.randomUUID();
        sessionStorage.setItem('portal_creation_request', requestId);
        requestRef.current = { request_id: requestId, order_number: orderNumber.trim(), amount: decimalAmount(cents), customer_name: customerName.trim(), company_name: companyName.trim(), customer_email: customerEmail.trim(), attachments: uploadedInvoices.filter((inv) => inv.attachment).map((inv) => inv.attachment), send_email: shouldSendEmail };
      }
      let outcome;
      try { outcome = await apiRequest('/create-link', { ...postJson(requestRef.current), timeout: 45000 }); }
      catch { if (workflowRef.current === epoch) { setCreationUncertain(true); setError('The link may have been created. Recover the same request below before starting another.'); } return; }
      if (workflowRef.current !== epoch) return;
      const { response, data } = outcome;
      if (response.status === 401) { await logout(false); setPasscodeError('Your staff session expired. Sign in again.'); return; }
      if (!response.ok || !UUID.test(data?.id || '')) {
        if (response.status >= 500 || response.ok || response.status === 409) { setCreationUncertain(true); setError('The creation result needs recovery. Retry this same request; contact support if it remains unresolved.'); }
        else { requestRef.current = null; sessionStorage.removeItem('portal_creation_request'); setError(staffRequestMessage(response.status, 'link')); }
        return;
      }
      const saved = requestRef.current;
      setLinkSummary({ orderNumber: saved.order_number, amount: saved.amount, customerEmail: saved.customer_email });
      setLastLinkWasEmailed(data.email_status === 'accepted');
      setEmailFailed(data.email_status === 'failed');
      setEmailUnconfirmed(['pending', 'unknown'].includes(data.email_status));
      setCreatedLink(`${window.location.origin}/pay/${data.id}`);
      setCreationUncertain(false); requestRef.current = null; sessionStorage.removeItem('portal_creation_request');
      resetBilling(); filesRef.current.clear(); setUploadedInvoices([]);
    } finally { submissionRef.current = false; setIsLoading(false); setActiveSubmitAction(''); }
  };

  const issue = batchIssue(uploadedInvoices);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(createdLink);
      setCopyStatus('copied');
      window.setTimeout(() => setCopyStatus('idle'), 2500);
    } catch {
      setCopyStatus('failed');
    }
  };

  const inputClass = (fieldId) =>
    autofilledFields.has(fieldId) ? 'input-autofilled' : '';

  return (
    <>
    {isDraggingOver && <div className="invoice-drop-overlay" role="status">Drop invoices to upload</div>}
    <StaffShell view={view} locked={locked} onLogout={logout}>
    <header className="workspace-page-heading"><h1>Send payment link</h1></header>
    <section className="card staff-card fade-in" aria-label="Create payment link">
      <div className="staff-workspace">
      <div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.webp"
          multiple
          disabled={locked}
          onChange={handleFileChange}
          hidden
          tabIndex={-1}
        />

        <button ref={uploadButtonRef} type="button" className="invoice-upload-area" aria-label="Upload invoices" disabled={locked} onClick={() => fileInputRef.current?.click()}>
          <span className="upload-symbol"><Icon name="upload" size={24} /></span>
          <span>Drop invoices here or click to upload</span>
        </button>
      </div>

      {/* ---- Uploaded Invoices List ---- */}
      {uploadedInvoices.length > 0 && (
        <section className="uploaded-invoices-list" aria-labelledby="uploaded-invoices-title">
          <div className="uploaded-invoices-heading">
            <h2 id="uploaded-invoices-title">Uploaded invoices</h2>
            <span className="invoice-count">{uploadedInvoices.length}</span>
          </div>
          {uploadedInvoices.map((inv) => (
            <div key={inv.id} className={`invoice-item-row ${inv.status}`}>
              <div className="invoice-item-content">
                {inv.status === 'scanning' ? (
                  <span className="spinner spinner-accent spinner-small" aria-hidden="true" />
                ) : inv.status === 'success' ? (
                  <Icon name="check" className="status-success" />
                ) : (
                  <Icon name="warning" className="status-error" />
                )}
                <div className="invoice-item-text">
                  <span className="invoice-filename">{inv.filename}</span>
                  <span className="invoice-status" aria-live="polite">
                    {inv.status === 'success' 
                      ? `Invoice #${inv.orderNumber || 'Unknown'} • $${inv.amount || '0.00'}` 
                      : inv.status === 'review' && inv.attachment ? 'Enter missing billing details' : inv.message}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  scanControllersRef.current.get(inv.id)?.abort();
                  filesRef.current.delete(inv.id);
                  setUploadedInvoices(prev => prev.filter(item => item.id !== inv.id));
                  if (!filesRef.current.size) resetBilling();
                  window.requestAnimationFrame(() => uploadButtonRef.current?.focus());
                }}
                className="icon-button remove-invoice"
                disabled={locked}
                aria-label={`Remove invoice ${inv.filename}`}
              >
                <Icon name="x" />
              </button>
            </div>
          ))}
        </section>
      )}

      {issue && <div className="alert alert-warning" role="alert"><Icon name="warning" /><div><strong>Review the invoice batch</strong><p>{issue}</p></div></div>}

      {error && (
        <div className="alert alert-error" role="alert">
          <Icon name="warning" />
          <div><strong>Link not created</strong><p>{error}</p></div>
        </div>
      )}

      {createdLink && (
        <div className={`alert ${emailFailed || emailUnconfirmed ? 'alert-warning' : 'alert-success'} alert-stacked fade-in`} role="status" aria-live="polite">
          <div className="alert-heading">
            <Icon name="check" />
            <strong>Payment link generated</strong>
          </div>
          <p>
            {emailUnconfirmed ? 'The link was created. Email status is unconfirmed; check before sending again.' : emailFailed ? 'The link was created, but the customer email was not accepted. Copy the link to share it manually.' : lastLinkWasEmailed ? 'The customer email was accepted for delivery.' : 'Copy the link below to share it manually.'}
          </p>
          <Link className="text-button" to={`/invoices?invoice=${createdLink.split('/').at(-1)}`}>View invoice in dashboard</Link>
          {linkSummary && <p>Invoice #{linkSummary.orderNumber} · ${linkSummary.amount} USD · {linkSummary.customerEmail}</p>}
          <div className="copy-block">
            <input
              type="text"
              readOnly
              value={createdLink}
              className="copy-input"
              onClick={(e) => e.target.select()}
              aria-label="Generated payment link"
            />
            <button type="button" className="btn btn-secondary" onClick={handleCopy}>
              <Icon name="copy" />
              {copyStatus === 'copied' ? 'Copied' : 'Copy link'}
            </button>
          </div>
          <p className={`copy-status${copyStatus === 'failed' ? ' is-error' : ''}`} aria-live="polite">
            {copyStatus === 'copied' && 'Link copied to clipboard.'}
            {copyStatus === 'failed' && 'Clipboard access was unavailable. Select and copy the link manually.'}
          </p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="staff-details-form">
        <div className="staff-form-grid">
        <div className="form-group">
          <label htmlFor="orderNumber">Invoice number <span className="required-text">Required</span></label>
          <input
            id="orderNumber"
            type="text"
            required
            value={orderNumber}
            onChange={(e) => editField('orderNumber', e.target.value)}
            disabled={locked}
            className={inputClass('orderNumber')}
            autoComplete="off"
          />
        </div>

        <div className="form-group">
          <label htmlFor="amount">Amount (USD) <span className="required-text">Required</span></label>
          <input
            id="amount"
            type="number"
            step="0.01"
            min="0.01"
            required
            value={amount}
            onChange={(e) => editField('amount', e.target.value)}
            disabled={locked}
            className={inputClass('amount')}
            inputMode="decimal"
          />
        </div>

        <div className="form-group">
          <label htmlFor="customerName">Customer name <span className="required-text">Required</span></label>
          <input
            id="customerName"
            type="text"
            required
            value={customerName}
            onChange={(e) => editField('customerName', e.target.value)}
            disabled={locked}
            className={inputClass('customerName')}
            autoComplete="name"
          />
        </div>

        <div className="form-group">
          <label htmlFor="companyName">Company name <span className="optional-text">Optional</span></label>
          <input
            id="companyName"
            type="text"
            value={companyName}
            onChange={(e) => editField('companyName', e.target.value)}
            disabled={locked}
            className={inputClass('companyName')}
            autoComplete="organization"
          />
        </div>

        <div className="form-group staff-field-wide">
          <label htmlFor="customerEmail">Customer email <span className="required-text">Required</span></label>
          <input
            id="customerEmail"
            type="email"
            required
            value={customerEmail}
            onChange={(e) => editField('customerEmail', e.target.value)}
            disabled={locked}
            className={inputClass('customerEmail')}
            autoComplete="email"
          />
        </div>

        </div>

        <div className="staff-submit-actions">
          <button type="submit" name="submitAction" value="link-only" className="btn btn-secondary" disabled={isLoading || (!creationUncertain && Boolean(issue))}>
            {activeSubmitAction === 'link-only' ? (
              <><span className="spinner spinner-accent" aria-hidden="true" /> Generating link…</>
            ) : (
              <><Icon name="link" /> {creationUncertain ? 'Recover existing request' : 'Generate link only'}</>
            )}
          </button>
          <button type="submit" name="submitAction" value="send-email" className="btn btn-primary" disabled={isLoading || creationUncertain || Boolean(issue)}>
            {activeSubmitAction === 'send-email' ? (
              <><span className="spinner" aria-hidden="true" /> Generating & sending…</>
            ) : (
              <><Icon name="mail" /> Generate & send email</>
            )}
          </button>
        </div>
      </form>
      </div>
    </section>
    </StaffShell>
    </>
  );
}

import { useState, useRef, useEffect } from 'react';
import Icon from '../components/Icon';

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
  const [billingReviewed, setBillingReviewed] = useState(false);
  const [creationUncertain, setCreationUncertain] = useState(false);
  const [emailFailed, setEmailFailed] = useState(false);
  const [linkSummary, setLinkSummary] = useState(null);

  // Drag-and-drop state
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const fileInputRef = useRef(null);
  const dragCounterRef = useRef(0);
  const submissionRef = useRef(false);
  const filesRef = useRef(new Map());
  const scanControllersRef = useRef(new Map());
  const workflowRef = useRef(0);
  const requestRef = useRef(null);

  const resetBilling = () => {
    setBillingEdits({}); setBillingReviewed(false);
  };

  const clearWorkflow = () => {
    workflowRef.current++;
    scanControllersRef.current.forEach((controller) => controller.abort());
    scanControllersRef.current.clear(); filesRef.current.clear();
    resetBilling(); setUploadedInvoices([]); setCreatedLink(''); setLinkSummary(null); setError(null);
    setPasscodeEntry(''); setShowPasscode(false); setCreationUncertain(false); requestRef.current = null;
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
    if (!sessionReady) return;
    const controller = new AbortController();
    const recover = async () => {
      const requestId = sessionStorage.getItem('portal_creation_request');
      if (!UUID.test(requestId || '')) return;
      try {
        const { response, data } = await apiRequest(`/create-link?request_id=${encodeURIComponent(requestId)}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (response.ok && UUID.test(data?.id || '')) {
          setCreatedLink(`${window.location.origin}/pay/${data.id}`); setLastLinkWasEmailed(data.email_sent === true); setEmailFailed(false);
          sessionStorage.removeItem('portal_creation_request');
        } else if (response.status !== 404) setError('An earlier creation request still needs recovery. Re-enter the same billing details or contact the administrator.');
      } catch { if (!controller.signal.aborted) setError('An earlier creation request could not be checked. Retry after your connection recovers.'); }
    };
    void recover();
    return () => controller.abort();
  }, [sessionReady]);

  const parsed = uploadedInvoices.filter((inv) => ['success', 'review'].includes(inv.status));
  const total = parsed.reduce((sum, inv) => sum + (moneyCents(inv.amount) || 0), 0);
  const first = parsed[0];
  const defaults = { orderNumber: parsed.map((inv) => inv.orderNumber).filter(Boolean).join(', '), amount: total > 0 ? decimalAmount(total) : '', customerName: first?.customerName || '', companyName: first?.companyName || '', customerEmail: first?.customerEmail || '' };
  const { orderNumber, amount, customerName, companyName, customerEmail } = { ...defaults, ...billingEdits };
  const autofilledFields = new Set(Object.keys(defaults).filter((name) => defaults[name] && !(name in billingEdits)));
  const editField = (name, value) => {
    setBillingEdits((previous) => ({ ...previous, [name]: value })); setBillingReviewed(false);
  };

  const processInvoiceFile = async (file) => {
    if (!file || submissionRef.current || creationUncertain) return;
    if (!ACCEPTED_TYPES.includes(file.type) && !ACCEPTED_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext))) { setError('Choose a PDF, PNG, JPEG or WebP invoice.'); return; }
    if (!file.size || file.size > MAX_FILE_BYTES || filesRef.current.size >= MAX_FILES || [...filesRef.current.values()].reduce((sum, item) => sum + item.file.size, file.size) > MAX_ATTACHMENT_BYTES) { setError('Use up to 5 invoices, at most 5 MB each and 10 MB total.'); return; }
    if ([...filesRef.current.values()].some((item) => item.file.name === file.name && item.file.size === file.size && item.file.lastModified === file.lastModified)) { setError('This file is already in the batch. Remove it before adding a replacement.'); return; }
    const id = crypto.randomUUID();
    const epoch = workflowRef.current;
    filesRef.current.set(id, { file, hash: '' });
    setBillingReviewed(false); setError(null);
    setUploadedInvoices((prev) => [...prev, { id, filename: file.name, orderNumber: '', amount: '', customerName: '', companyName: '', customerEmail: '', attachment: null, status: 'scanning', reviewed: false, message: 'Reading invoice…' }]);
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

  const handleVerifyPasscode = async (event) => {
    event.preventDefault(); setPasscodeError(null); setIsLoading(true);
    try {
      const { response, data } = await apiRequest('/staff-session', postJson({ passcode: passcodeEntry }));
      if (!response.ok || data?.authenticated !== true) {
        setPasscodeError(response.status === 429 ? 'Too many attempts. Wait a few minutes before signing in again.' : response.status >= 500 ? 'Staff access is temporarily unavailable. Contact the administrator.' : 'The passcode was not accepted. Try again.');
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
            <img src="/logo.png" alt="Overnight Printing Seattle" className="passcode-logo" />
          </div>
          <h1 className="passcode-title">Staff portal</h1>
          <p className="passcode-subtitle">Please enter the staff passcode to access this page.</p>
          
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

  // Drag event handlers
  const handleDragEnter = (e) => {
    e.preventDefault();
    dragCounterRef.current += 1;
    setIsDraggingOver(true);
  };
  const handleDragLeave = (e) => {
    e.preventDefault();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current === 0) setIsDraggingOver(false);
  };
  const handleDragOver = (e) => { e.preventDefault(); };
  const handleDrop = (e) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDraggingOver(false);
    if (submissionRef.current || creationUncertain) return;
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      files.forEach(processInvoiceFile);
    }
  };
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
    if (!requestRef.current && (issue || !billingReviewed)) { setError(issue || 'Confirm that you reviewed the invoice, customer and amount.'); return; }
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
      setCreatedLink(`${window.location.origin}/pay/${data.id}`);
      setCreationUncertain(false); requestRef.current = null; sessionStorage.removeItem('portal_creation_request');
      resetBilling(); filesRef.current.clear(); setUploadedInvoices([]);
    } finally { submissionRef.current = false; setIsLoading(false); setActiveSubmitAction(''); }
  };

  const issue = batchIssue(uploadedInvoices);
  const locked = isLoading || creationUncertain;

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
    <main className="card staff-card fade-in">
      <header className="staff-page-header">
        <img src="/logo.png" alt="Overnight Printing Seattle" className="staff-brand-logo" />
        <div className="staff-heading">
          <p className="staff-eyebrow">Staff workspace</p>
          <h1>Create payment link</h1>
          <p className="subtitle">Upload invoices or enter verified billing details to create a customer checkout link.</p>
        </div>
        <button
          type="button"
          className="btn-logout"
          disabled={isLoading || creationUncertain}
          onClick={() => { void logout(); }}
        >
          <Icon name="lock" size={16} />
          Log out
        </button>
      </header>

      <div className="staff-workspace">
        <section className="staff-panel staff-intake-panel" aria-labelledby="invoice-intake-title">
          <div className="staff-panel-heading">
            <span className="staff-step" aria-hidden="true">1</span>
            <div>
              <h2 id="invoice-intake-title">Invoice intake</h2>
              <p>Upload one or more invoices to fill the billing details automatically.</p>
            </div>
          </div>

      {/* ---- Drag & Drop Zone ---- */}
      <div
        className={`dropzone${isDraggingOver ? ' dragging-over' : ''}`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={() => { if (!locked) fileInputRef.current?.click(); }}
        role="button"
        aria-label="Drop invoice file to auto-fill"
        tabIndex={locked ? -1 : 0}
        aria-disabled={locked}
        onKeyDown={(event) => {
          if (!locked && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            fileInputRef.current?.click();
          }
        }}
      >
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

        <>
          <span className="dropzone-icon"><Icon name="document" size={32} /></span>
          <p className="dropzone-title">
            {isDraggingOver ? 'Release to analyze invoices' : 'Drop invoice(s) here to auto-fill'}
          </p>
          <p className="dropzone-sub">PDF, PNG, JPEG or WebP · Up to 5 files, 5 MB each, 10 MB total. Always review extracted values.</p>
        </>
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
                      : inv.message}
                  </span>
                  {inv.status === 'review' && <label className="review-check"><input type="checkbox" checked={inv.reviewed} disabled={locked || !inv.attachment} onChange={(event) => { setUploadedInvoices((prev) => prev.map((item) => item.id === inv.id ? { ...item, reviewed: event.target.checked } : item)); setBillingReviewed(false); }} />I reviewed this attachment and entered its missing billing details.</label>}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  scanControllersRef.current.get(inv.id)?.abort();
                  filesRef.current.delete(inv.id);
                  setUploadedInvoices(prev => prev.filter(item => item.id !== inv.id));
                  setBillingReviewed(false);
                  if (!filesRef.current.size) resetBilling();
                  window.requestAnimationFrame(() => fileInputRef.current?.parentElement?.focus());
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

        </section>

        <section className="staff-panel staff-details-panel" aria-labelledby="billing-details-title">
          <div className="staff-panel-heading">
            <span className="staff-step" aria-hidden="true">2</span>
            <div>
              <h2 id="billing-details-title">Billing details</h2>
              <p>Review the extracted values or enter the invoice information manually.</p>
            </div>
          </div>

      {error && (
        <div className="alert alert-error" role="alert">
          <Icon name="warning" />
          <div><strong>Link not created</strong><p>{error}</p></div>
        </div>
      )}

      {createdLink && (
        <div className={`alert ${emailFailed ? 'alert-warning' : 'alert-success'} alert-stacked fade-in`} role="status" aria-live="polite">
          <div className="alert-heading">
            <Icon name="check" />
            <strong>Payment link generated</strong>
          </div>
          <p>
            {emailFailed ? 'The link was created, but the customer email was not accepted. Copy the link to share it manually.' : lastLinkWasEmailed ? 'The customer email was accepted for delivery.' : 'Copy the link below to share it manually.'}
          </p>
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
        <p className="form-instructions">All fields are required unless marked optional.</p>
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

        <label className="review-check billing-review"><input type="checkbox" checked={billingReviewed} disabled={locked || Boolean(issue)} onChange={(event) => setBillingReviewed(event.target.checked)} />I verified the invoice numbers, amount due and customer email against the invoices.</label>
        <div className="staff-submit-actions">
          <button type="submit" name="submitAction" value="link-only" className="btn btn-secondary" disabled={isLoading || (!creationUncertain && (Boolean(issue) || !billingReviewed))}>
            {activeSubmitAction === 'link-only' ? (
              <><span className="spinner spinner-accent" aria-hidden="true" /> Generating link…</>
            ) : (
              <><Icon name="link" /> {creationUncertain ? 'Recover existing request' : 'Generate link only'}</>
            )}
          </button>
          <button type="submit" name="submitAction" value="send-email" className="btn btn-primary" disabled={isLoading || creationUncertain || Boolean(issue) || !billingReviewed}>
            {activeSubmitAction === 'send-email' ? (
              <><span className="spinner" aria-hidden="true" /> Generating & sending…</>
            ) : (
              <><Icon name="mail" /> Generate & send email</>
            )}
          </button>
        </div>
      </form>
        </section>
      </div>
    </main>
  );
}

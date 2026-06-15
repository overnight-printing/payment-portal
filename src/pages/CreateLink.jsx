import { useState, useRef, useCallback } from 'react';

// All API calls go to same-origin Cloudflare Pages Functions.
// In local dev, Wrangler serves both the Pages Functions and the static assets on the same port.
const API_BASE = '';

// Dynamically load PDF.js from CDN on first use
let pdfJsLoaded = false;
async function loadPdfJs() {
  if (pdfJsLoaded || window.pdfjsLib) {
    pdfJsLoaded = true;
    return window.pdfjsLib;
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    script.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      pdfJsLoaded = true;
      resolve(window.pdfjsLib);
    };
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

// Extract all text from a PDF file as a single string, grouping by line height to preserve document structure
async function extractTextFromPdf(arrayBuffer) {
  const pdfjsLib = await loadPdfJs();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
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
}

// Resize + compress an image File/Blob to max 1500px wide, JPEG quality 0.85
// Returns base64 string (without the data:...;base64, prefix)
async function compressImageToBase64(arrayBuffer, mimeType) {
  return new Promise((resolve, reject) => {
    const blob = new Blob([arrayBuffer], { type: mimeType || 'image/png' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const MAX_WIDTH = 1500;
      let { width, height } = img;
      if (width > MAX_WIDTH) {
        height = Math.round((height * MAX_WIDTH) / width);
        width = MAX_WIDTH;
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      // Export as JPEG for smaller payload; strip the data URL prefix
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      resolve(dataUrl.replace(/^data:image\/jpeg;base64,/, ''));
    };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

const ACCEPTED_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
const ACCEPTED_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.webp'];

export default function CreateLink() {
  const [passcode, setPasscode] = useState(() => localStorage.getItem('staff_passcode') || '');
  const [passcodeEntry, setPasscodeEntry] = useState('');
  const [passcodeError, setPasscodeError] = useState(null);

  const [orderNumber, setOrderNumber] = useState('');
  const [amount, setAmount] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [attachment, setAttachment] = useState(null);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [createdLink, setCreatedLink] = useState('');
  const [copied, setCopied] = useState(false);

  // Drag-and-drop state
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [scanStatus, setScanStatus] = useState(null); // null | 'scanning' | 'success' | 'error'
  const [scanMessage, setScanMessage] = useState('');
  const [autofilledFields, setAutofilledFields] = useState(new Set());
  const fileInputRef = useRef(null);
  const dragCounterRef = useRef(0);

  // Reset autofill highlight after animation
  const markAutofilled = useCallback((fields) => {
    setAutofilledFields(new Set(fields));
    setTimeout(() => setAutofilledFields(new Set()), 2200);
  }, []);

  const processInvoiceFile = useCallback(async (file) => {
    if (!file) return;

    const isAccepted = ACCEPTED_TYPES.includes(file.type) ||
      ACCEPTED_EXTENSIONS.some(ext => file.name.toLowerCase().endsWith(ext));

    if (!isAccepted) {
      setScanStatus('error');
      setScanMessage('Unsupported file type. Please drop a PDF or image file.');
      setTimeout(() => setScanStatus(null), 3500);
      return;
    }

    setScanStatus('scanning');
    setScanMessage('Reading invoice...');

    try {
      const buffer = await file.arrayBuffer();

      // Read file to Base64 for Resend attachment
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target.result;
        const base64Content = result.split(',')[1];
        setAttachment({
          content: base64Content,
          filename: file.name
        });
      };
      reader.readAsDataURL(file);

      let requestBody;

      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        // Text PDF: extract text client-side, send as JSON { text }
        setScanMessage('Extracting text from PDF...');
        const text = await extractTextFromPdf(buffer);
        setScanMessage('Analyzing invoice with AI...');
        requestBody = JSON.stringify({ text });
      } else {
        // Image: compress client-side then send as base64 JSON
        setScanMessage('Compressing image...');
        const imageBase64 = await compressImageToBase64(buffer, file.type);
        setScanMessage('Analyzing invoice image with AI...');
        requestBody = JSON.stringify({ imageBase64 });
      }

      const response = await fetch(`${API_BASE}/analyze-invoice`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Staff-Passcode': passcode
        },
        body: requestBody,
      });

      if (response.status === 401) {
        localStorage.removeItem('staff_passcode');
        setPasscode('');
        throw new Error('Session expired or invalid passcode. Access denied.');
      }

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        // Surface the real server error so staff can see what went wrong
        throw new Error(errData.error || errData.message || `Server error ${response.status}`);
      }

      const data = await response.json();

      // Populate fields and track which ones were filled
      const filled = [];
      if (data.order_number) { setOrderNumber(data.order_number); filled.push('orderNumber'); }
      if (data.amount)       { setAmount(data.amount);             filled.push('amount'); }
      if (data.customer_name) { setCustomerName(data.customer_name); filled.push('customerName'); }
      if (data.company_name) { setCompanyName(data.company_name); filled.push('companyName'); }
      if (data.customer_email) { setCustomerEmail(data.customer_email); filled.push('customerEmail'); }

      markAutofilled(filled);

      const filledCount = filled.length;
      if (filledCount > 0) {
        setScanStatus('success');
        setScanMessage(`Auto-filled ${filledCount} field${filledCount > 1 ? 's' : ''} from invoice`);
      } else {
        setScanStatus('error');
        setScanMessage('No data could be extracted. Please fill in the fields manually.');
      }
      setTimeout(() => setScanStatus(null), 4000);
    } catch (err) {
      console.error('Invoice scan error:', err);
      setScanStatus('error');
      setScanMessage(err.message || 'Failed to analyze invoice. Please try again.');
      setTimeout(() => setScanStatus(null), 4000);
    }
  }, [markAutofilled, passcode]);

  const handleVerifyPasscode = async (e) => {
    e.preventDefault();
    setPasscodeError(null);
    setIsLoading(true);

    try {
      // Test the passcode by calling analyze-invoice with an empty request
      const res = await fetch(`${API_BASE}/analyze-invoice`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Staff-Passcode': passcodeEntry,
        },
        body: JSON.stringify({}),
      });

      if (res.status === 401) {
        throw new Error('Invalid passcode. Please try again.');
      }

      // If it returned 400 (Bad Request / invalid JSON) or any other status, passcode is accepted!
      localStorage.setItem('staff_passcode', passcodeEntry);
      setPasscode(passcodeEntry);
      setPasscodeError(null);
    } catch (err) {
      setPasscodeError(err.message || 'Passcode verification failed.');
    } finally {
      setIsLoading(false);
    }
  };

  if (!passcode) {
    return (
      <div className="passcode-container fade-in">
        <div className="passcode-card">
          <div className="passcode-logo-container">
            <img src="/logo.png" alt="Overnight Printing Seattle" className="passcode-logo" />
          </div>
          <h2 className="passcode-title">Staff Portal</h2>
          <p className="passcode-subtitle">Please enter the staff passcode to access this page.</p>
          
          {passcodeError && (
            <div className="alert alert-error" style={{ marginBottom: '16px' }}>
              <div>{passcodeError}</div>
            </div>
          )}

          <form onSubmit={handleVerifyPasscode}>
            <div className="form-group" style={{ textAlign: 'left' }}>
              <label htmlFor="staffPasscode">Passcode</label>
              <input
                id="staffPasscode"
                type="password"
                required
                value={passcodeEntry}
                onChange={(e) => setPasscodeEntry(e.target.value)}
                disabled={isLoading}
                placeholder="••••••"
                style={{ textAlign: 'center', letterSpacing: '0.2em' }}
              />
            </div>
            <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '8px' }} disabled={isLoading}>
              {isLoading ? 'Verifying...' : 'Access Portal'}
            </button>
          </form>
        </div>
      </div>
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
    const file = e.dataTransfer.files[0];
    if (file) processInvoiceFile(file);
  };
  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) processInvoiceFile(file);
    e.target.value = ''; // reset so same file can be dropped again
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setCreatedLink('');
    setCopied(false);

    try {
      if (!orderNumber || !amount || !customerName || !customerEmail) {
        throw new Error('All required fields must be filled.');
      }

      const parsedAmount = parseFloat(amount);
      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        throw new Error('Please enter a valid amount greater than 0.');
      }

      // Combine customer, company name, and job description into customer_name column to preserve DB schema
      let combinedName = customerName;
      if (companyName) {
        combinedName += ` (${companyName})`;
      }

      const workerBase = API_BASE;
      const response = await fetch(`${workerBase}/create-link`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Staff-Passcode': passcode
        },
        body: JSON.stringify({
          order_number: orderNumber,
          amount: parsedAmount.toFixed(2),
          customer_name: combinedName,
          customer_email: customerEmail,
          attachment: attachment,
        }),
      });

      if (response.status === 401) {
        localStorage.removeItem('staff_passcode');
        setPasscode('');
        throw new Error('Session expired or invalid passcode. Access denied.');
      }

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Failed to create payment link.');
      }

      const frontendBase = window.location.origin.includes('localhost')
        ? window.location.origin
        : 'https://pay.overnightprintingseattle.com';

      const link = `${frontendBase}/pay/${data.id}`;
      setCreatedLink(link);

      // Reset form
      setOrderNumber('');
      setAmount('');
      setCustomerName('');
      setCompanyName('');
      setCustomerEmail('');
      setAttachment(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(createdLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const inputClass = (fieldId) =>
    autofilledFields.has(fieldId) ? 'input-autofilled' : '';

  return (
    <div className="card fade-in">
      <div className="staff-header-actions">
        <button
          type="button"
          className="btn-logout"
          onClick={() => {
            localStorage.removeItem('staff_passcode');
            setPasscode('');
            setPasscodeEntry('');
          }}
        >
          🔒 Log Out Staff
        </button>
      </div>
      <div className="brand-logo-container">
        <img src="/logo.png" alt="Overnight Printing Seattle" className="brand-logo" />
      </div>
      <h1>Create Payment Link</h1>
      <p className="subtitle">Staff portal to generate secure custom checkout links for clients.</p>

      {/* ---- Drag & Drop Zone ---- */}
      <div
        className={`dropzone${isDraggingOver ? ' dragging-over' : ''}`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={() => !scanStatus && fileInputRef.current?.click()}
        role="button"
        aria-label="Drop invoice file to auto-fill"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.webp"
          onChange={handleFileChange}
          style={{ display: 'none' }}
          tabIndex={-1}
        />

        {scanStatus === 'scanning' ? (
          <div className="dropzone-scanning">
            <span style={{ fontSize: '28px' }}>🔍</span>
            <p className="dropzone-title">{scanMessage}</p>
            <div className="scan-bar">
              <div className="scan-bar-fill" />
            </div>
          </div>
        ) : scanStatus === 'success' ? (
          <div className="dropzone-scanning">
            <span style={{ fontSize: '28px', color: 'var(--success)' }}>✓</span>
            <p className="dropzone-title" style={{ color: 'var(--success)' }}>{scanMessage}</p>
          </div>
        ) : scanStatus === 'error' ? (
          <div className="dropzone-scanning">
            <span style={{ fontSize: '28px', color: 'var(--error)' }}>⚠</span>
            <p className="dropzone-title" style={{ color: 'var(--error)' }}>{scanMessage}</p>
          </div>
        ) : (
          <>
            <span className="dropzone-icon">📄</span>
            <p className="dropzone-title">
              {isDraggingOver ? 'Release to analyze invoice' : 'Drop invoice here to auto-fill'}
            </p>
            <p className="dropzone-sub">PDF or image (PNG, JPG) • AI will extract invoice details</p>
          </>
        )}
      </div>

      {/* ---- Attachment Pill ---- */}
      {attachment && (
        <div className="attachment-pill" style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'rgba(30, 47, 102, 0.05)',
          border: '1px dashed rgba(30, 47, 102, 0.2)',
          padding: '8px 12px',
          borderRadius: '8px',
          marginBottom: '16px',
          fontSize: '14px',
        }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>📎</span>
            <strong style={{ color: 'var(--navy)' }}>{attachment.filename}</strong>
            <span style={{ opacity: 0.6 }}>(Invoice attached)</span>
          </span>
          <button
            type="button"
            onClick={() => setAttachment(null)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--error)',
              cursor: 'pointer',
              fontWeight: 'bold',
              padding: '0 4px',
            }}
          >
            ✕
          </button>
        </div>
      )}

      <div className="form-divider">or fill in manually</div>

      {error && (
        <div className="alert alert-error">
          <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div>{error}</div>
        </div>
      )}

      {createdLink && (
        <div className="alert alert-success fade-in" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
            <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <strong style={{ fontSize: '15px' }}>Payment Link Generated!</strong>
          </div>
          <p style={{ fontSize: '13px', marginBottom: '12px', opacity: 0.9 }}>
            An email containing this link has been automatically sent to the customer.
          </p>
          <div className="copy-block">
            <input
              type="text"
              readOnly
              value={createdLink}
              className="copy-input"
              onClick={(e) => e.target.select()}
            />
            <button type="button" className="btn btn-secondary" onClick={handleCopy} style={{ padding: '8px 16px', fontSize: '14px' }}>
              {copied ? 'Copied! ✓' : 'Copy Link'}
            </button>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="orderNumber">Invoice Number</label>
          <input
            id="orderNumber"
            type="text"
            required
            value={orderNumber}
            onChange={(e) => setOrderNumber(e.target.value)}
            disabled={isLoading}
            className={inputClass('orderNumber')}
          />
        </div>

        <div className="form-group">
          <label htmlFor="amount">Amount (USD)</label>
          <input
            id="amount"
            type="number"
            step="0.01"
            min="0.01"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={isLoading}
            className={inputClass('amount')}
          />
        </div>

        <div className="form-group">
          <label htmlFor="customerName">Customer Name</label>
          <input
            id="customerName"
            type="text"
            required
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            disabled={isLoading}
            className={inputClass('customerName')}
          />
        </div>

        <div className="form-group">
          <label htmlFor="companyName">Company Name <span style={{ opacity: 0.5, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(Optional)</span></label>
          <input
            id="companyName"
            type="text"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            disabled={isLoading}
            className={inputClass('companyName')}
          />
        </div>

        <div className="form-group">
          <label htmlFor="customerEmail">Customer Email</label>
          <input
            id="customerEmail"
            type="email"
            required
            value={customerEmail}
            onChange={(e) => setCustomerEmail(e.target.value)}
            disabled={isLoading}
            className={inputClass('customerEmail')}
          />
        </div>

        <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '10px' }} disabled={isLoading}>
          {isLoading ? (
            <>
              <div className="spinner"></div>
              <span>Generating Link...</span>
            </>
          ) : (
            'Generate & Send Link'
          )}
        </button>
      </form>
    </div>
  );
}

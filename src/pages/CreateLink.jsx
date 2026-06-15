import { useState, useRef, useCallback, useEffect } from 'react';

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
  const [uploadedInvoices, setUploadedInvoices] = useState([]);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [createdLink, setCreatedLink] = useState('');
  const [copied, setCopied] = useState(false);

  // Drag-and-drop state
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [autofilledFields, setAutofilledFields] = useState(new Set());
  const fileInputRef = useRef(null);
  const dragCounterRef = useRef(0);

  // Reset autofill highlight after animation
  const markAutofilled = useCallback((fields) => {
    setAutofilledFields(new Set(fields));
    setTimeout(() => setAutofilledFields(new Set()), 2200);
  }, []);

  // Consolidate parsed values when uploadedInvoices state changes
  useEffect(() => {
    const successfulInvoices = uploadedInvoices.filter(inv => inv.status === 'success');
    if (successfulInvoices.length === 0) return;

    // Comma join order numbers
    const orderNumbers = successfulInvoices
      .map(inv => inv.orderNumber)
      .filter(Boolean);
    const uniqueOrderNumbers = [...new Set(orderNumbers)];
    setOrderNumber(uniqueOrderNumbers.join(', '));

    // Sum amounts
    const totalAmount = successfulInvoices
      .reduce((sum, inv) => {
        const amt = parseFloat(inv.amount);
        return isNaN(amt) ? sum : sum + amt;
      }, 0);
    setAmount(totalAmount > 0 ? totalAmount.toFixed(2) : '');

    // Autofill name/company/email from first successful invoice
    const firstWithEmail = successfulInvoices.find(inv => inv.customerEmail);
    if (firstWithEmail) {
      setCustomerEmail(firstWithEmail.customerEmail);
    }
    const firstWithName = successfulInvoices.find(inv => inv.customerName);
    if (firstWithName) {
      setCustomerName(firstWithName.customerName);
    }
    const firstWithCompany = successfulInvoices.find(inv => inv.companyName);
    if (firstWithCompany) {
      setCompanyName(firstWithCompany.companyName);
    }

    // Trigger autofill visual cue
    const fieldsToHighlight = [];
    if (orderNumbers.length > 0) fieldsToHighlight.push('orderNumber');
    if (totalAmount > 0) fieldsToHighlight.push('amount');
    if (firstWithName) fieldsToHighlight.push('customerName');
    if (firstWithCompany) fieldsToHighlight.push('companyName');
    if (firstWithEmail) fieldsToHighlight.push('customerEmail');
    markAutofilled(fieldsToHighlight);
  }, [uploadedInvoices, markAutofilled]);

  const processInvoiceFile = useCallback(async (file) => {
    if (!file) return;

    const isAccepted = ACCEPTED_TYPES.includes(file.type) ||
      ACCEPTED_EXTENSIONS.some(ext => file.name.toLowerCase().endsWith(ext));

    if (!isAccepted) {
      setError(`Unsupported file type: ${file.name}. Please select a PDF or image file.`);
      return;
    }

    const uniqueId = Date.now() + Math.random().toString(36).substring(2, 7);

    const newInvoice = {
      id: uniqueId,
      filename: file.name,
      orderNumber: '',
      amount: '',
      customerName: '',
      companyName: '',
      customerEmail: '',
      attachment: null,
      status: 'scanning',
      message: 'Reading invoice...',
    };

    setUploadedInvoices(prev => [...prev, newInvoice]);

    try {
      const buffer = await file.arrayBuffer();

      // Read file to Base64 for Resend attachment
      const base64Content = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const result = e.target.result;
          resolve(result.split(',')[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const fileAttachment = {
        content: base64Content,
        filename: file.name
      };

      let requestBody;

      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        const text = await extractTextFromPdf(buffer);
        requestBody = JSON.stringify({ text });
      } else {
        const imageBase64 = await compressImageToBase64(buffer, file.type);
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
        throw new Error(errData.error || errData.message || `Server error ${response.status}`);
      }

      const data = await response.json();

      setUploadedInvoices(prev => prev.map(inv => inv.id === uniqueId ? {
        ...inv,
        orderNumber: data.order_number || '',
        amount: data.amount || '',
        customerName: data.customer_name || '',
        companyName: data.company_name || '',
        customerEmail: data.customer_email || '',
        attachment: fileAttachment,
        status: 'success',
        message: 'Parsed successfully'
      } : inv));

    } catch (err) {
      console.error('Invoice scan error:', err);
      setUploadedInvoices(prev => prev.map(inv => inv.id === uniqueId ? {
        ...inv,
        status: 'error',
        message: err.message || 'Failed to scan'
      } : inv));
    }
  }, [passcode]);

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

      // Combine customer and company name into customer_name column to preserve DB schema
      let combinedName = customerName;
      if (companyName) {
        combinedName += ` (${companyName})`;
      }

      // Collect attachments from successfully uploaded invoices
      const attachmentsPayload = uploadedInvoices
        .filter(inv => inv.status === 'success' && inv.attachment)
        .map(inv => inv.attachment);

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
          attachment: attachmentsPayload[0] || null, // backwards compatibility
          attachments: attachmentsPayload,
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
      setUploadedInvoices([]);
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
        onClick={() => fileInputRef.current?.click()}
        role="button"
        aria-label="Drop invoice file to auto-fill"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.webp"
          multiple
          onChange={handleFileChange}
          style={{ display: 'none' }}
          tabIndex={-1}
        />

        <>
          <span className="dropzone-icon">📄</span>
          <p className="dropzone-title">
            {isDraggingOver ? 'Release to analyze invoices' : 'Drop invoice(s) here to auto-fill'}
          </p>
          <p className="dropzone-sub">PDF or image (PNG, JPG) • AI will extract details • Multiple files supported</p>
        </>
      </div>

      {/* ---- Uploaded Invoices List ---- */}
      {uploadedInvoices.length > 0 && (
        <div className="uploaded-invoices-list" style={{
          marginTop: '16px',
          marginBottom: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}>
          <h3 style={{ fontSize: '15px', color: 'var(--navy)', margin: '0 0 4px 0' }}>Uploaded Invoices</h3>
          {uploadedInvoices.map((inv) => (
            <div key={inv.id} className={`invoice-item-row ${inv.status}`} style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 14px',
              borderRadius: '8px',
              border: '1px solid',
              borderColor: inv.status === 'success' ? '#e2e8f0' : inv.status === 'error' ? 'rgba(239, 68, 68, 0.2)' : '#e2e8f0',
              background: inv.status === 'success' ? '#f8fafc' : inv.status === 'error' ? 'rgba(239, 68, 68, 0.05)' : '#ffffff',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', overflow: 'hidden' }}>
                {inv.status === 'scanning' ? (
                  <div style={{
                    width: '14px',
                    height: '14px',
                    border: '2px solid rgba(30, 47, 102, 0.1)',
                    borderTopColor: 'var(--navy)',
                    borderRadius: '50%',
                    animation: 'spin 0.8s ease-in-out infinite',
                  }} />
                ) : inv.status === 'success' ? (
                  <span style={{ color: 'var(--success)', fontWeight: 'bold' }}>✓</span>
                ) : (
                  <span style={{ color: 'var(--error)', fontWeight: 'bold' }}>⚠</span>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                  <span style={{ fontWeight: 600, fontSize: '13.5px', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                    {inv.filename}
                  </span>
                  <span style={{ fontSize: '11px', opacity: 0.7 }}>
                    {inv.status === 'success' 
                      ? `Invoice #${inv.orderNumber || 'Unknown'} • $${inv.amount || '0.00'}` 
                      : inv.message}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setUploadedInvoices(prev => prev.filter(item => item.id !== inv.id));
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--error)',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  fontSize: '14px',
                  padding: '4px 8px',
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Mismatched Details Warning */}
      {(() => {
        const successful = uploadedInvoices.filter(inv => inv.status === 'success');
        if (successful.length <= 1) return null;
        const firstEmail = successful[0].customerEmail?.toLowerCase().trim();
        const firstName = successful[0].customerName?.toLowerCase().trim();
        const mismatch = successful.some(inv => 
          (inv.customerEmail?.toLowerCase().trim() !== firstEmail) ||
          (inv.customerName?.toLowerCase().trim() !== firstName)
        );
        if (!mismatch) return null;
        return (
          <div className="alert alert-error" style={{
            background: 'rgba(217, 119, 6, 0.1)',
            borderColor: 'rgba(217, 119, 6, 0.3)',
            color: '#d97706',
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
          }}>
            <span style={{ fontSize: '20px' }}>⚠️</span>
            <div style={{ fontSize: '13.5px', lineHeight: '1.4' }}>
              <strong>Mismatched Customer Details:</strong> The uploaded invoices contain different customer names or email addresses. Please verify and correct the final fields below.
            </div>
          </div>
        );
      })()}

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

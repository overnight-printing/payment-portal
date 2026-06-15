import { useState } from 'react';

export default function CreateLink() {
  const [orderNumber, setOrderNumber] = useState('');
  const [amount, setAmount] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [createdLink, setCreatedLink] = useState('');
  const [copied, setCopied] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setCreatedLink('');
    setCopied(false);

    try {
      // Validate inputs (company name is optional)
      if (!orderNumber || !amount || !customerName || !customerEmail) {
        throw new Error('All required fields must be filled.');
      }
      
      const parsedAmount = parseFloat(amount);
      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        throw new Error('Please enter a valid amount greater than 0.');
      }

      // Combine customer and company name into the customer_name column to preserve DB schema
      const combinedName = companyName ? `${customerName} (${companyName})` : customerName;

      const response = await fetch('/create-link', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          order_number: orderNumber, // maps to Invoice Number
          amount: parsedAmount.toFixed(2),
          customer_name: combinedName,
          customer_email: customerEmail,
        }),
      });

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

  return (
    <div className="card fade-in">
      <div className="brand-logo-container">
        <img src="/logo.png" alt="Overnight Printing Seattle" className="brand-logo" />
      </div>
      <h1>Create Payment Link</h1>
      <p className="subtitle">Staff portal to generate secure custom checkout links for clients.</p>

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
          />
        </div>

        <div className="form-group">
          <label htmlFor="companyName">Company Name (Optional)</label>
          <input
            id="companyName"
            type="text"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            disabled={isLoading}
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

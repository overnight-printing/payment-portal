import { useState, useEffect, useRef } from 'react';

export default function PaymentForm({ amount, paymentLinkId, onPaymentSuccess }) {
  const [expiry, setExpiry] = useState('');
  const [cvv, setCvv] = useState('');
  const [zip, setZip] = useState('');
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState(null);
  
  const iframeRef = useRef(null);
  const resolveTokenRef = useRef(null);
  const rejectTokenRef = useRef(null);

  // Compute fixed iframe URL only once on mount to prevent the iframe from reloading
  // when component props or processing state changes (e.g. isProcessing toggling)
  const [iframeUrl] = useState(() => {
    const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const textColor = isDark ? '#f4f4f5' : '#0f0b21';
    const placeholderColor = isDark ? '#52525b' : '#a1a1aa';
    
    // Safely write standard CSS and encode it via encodeURIComponent to prevent tokenizer script errors
    const cssStyle = `
      input {
        font-family: 'Outfit', system-ui, sans-serif;
        font-size: 16px;
        color: ${textColor};
        border: none;
        outline: none;
        background: transparent;
        width: 100%;
        box-sizing: border-box;
      }
      input::placeholder {
        color: ${placeholderColor};
      }
    `;
    
    const url = `https://fts.cardconnect.com/itoke/ajax-tokenizer.html?css=${encodeURIComponent(cssStyle)}`;
    console.log('PaymentForm - Computed Static iframe URL:', url);
    return url;
  });

  // Listen to message events from CardPointe iFrame
  useEffect(() => {
    const handleFrameMessage = (event) => {
      // VERBOSE LOGGING: Log EVERY incoming message on the window to debug origin mismatch
      console.log('PaymentForm - Global window received postMessage:', {
        origin: event.origin,
        data: event.data,
        dataType: typeof event.data
      });

      // Ensure the message is coming from CardPointe domains (allowing sandbox/subdomains & port variations)
      const isCardPointe = event.origin.endsWith('cardconnect.com') || event.origin.includes('cardconnect.com:');
      if (!isCardPointe) {
        return;
      }

      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        console.log('PaymentForm - Parsed CardPointe payload:', data);
        
        if (data.token) {
          console.log('PaymentForm - Token received successfully:', data.token);
          if (resolveTokenRef.current) {
            resolveTokenRef.current(data.token);
            resolveTokenRef.current = null;
            rejectTokenRef.current = null;
          }
        } else if (data.errorCode || data.error) {
          const errMsg = data.error || `Error Code: ${data.errorCode}`;
          console.warn('PaymentForm - Error tokenizing card:', errMsg);
          if (rejectTokenRef.current) {
            rejectTokenRef.current(new Error(`Card Validation Failed: ${errMsg}`));
            resolveTokenRef.current = null;
            rejectTokenRef.current = null;
          }
        }
      } catch (err) {
        console.error('PaymentForm - Failed to parse postMessage data:', err);
      }
    };

    window.addEventListener('message', handleFrameMessage);
    return () => window.removeEventListener('message', handleFrameMessage);
  }, []);

  // Format expiry input as MM/YY automatically
  const handleExpiryChange = (e) => {
    let value = e.target.value.replace(/\D/g, ''); // Numbers only
    if (value.length > 4) value = value.slice(0, 4);
    
    if (value.length > 2) {
      setExpiry(`${value.slice(0, 2)}/${value.slice(2)}`);
    } else {
      setExpiry(value);
    }
  };

  // Trigger tokenizer in iframe and wait for the token via promise
  const requestCardToken = () => {
    return new Promise((resolve, reject) => {
      resolveTokenRef.current = resolve;
      rejectTokenRef.current = reject;

      if (iframeRef.current && iframeRef.current.contentWindow) {
        console.log('PaymentForm - Sending "tokenize" commands to iframe contentWindow. TargetOrigin: https://fts.cardconnect.com');
        // Send both plain string and JSON formats with fts.cardconnect.com targetOrigin
        iframeRef.current.contentWindow.postMessage('tokenize', 'https://fts.cardconnect.com');
        iframeRef.current.contentWindow.postMessage(JSON.stringify({ action: 'tokenize' }), 'https://fts.cardconnect.com');
      } else {
        console.error('PaymentForm - iframeRef contentWindow is null or iframe not mounted');
        reject(new Error('Payment tokenizer frame is not loaded.'));
      }
    });
  };

  const handlePaySubmit = async (e) => {
    e.preventDefault();
    console.log('PaymentForm - handlePaySubmit triggered');
    setIsProcessing(true);
    setError(null);

    try {
      // 1. Local Validations
      if (!expiry || !cvv || !zip) {
        throw new Error('All fields are required.');
      }

      const expiryClean = expiry.replace(/\//g, '');
      if (expiryClean.length !== 4) {
        throw new Error('Invalid Expiration Date format. Use MM/YY.');
      }

      const expMonth = parseInt(expiryClean.slice(0, 2), 10);
      if (expMonth < 1 || expMonth > 12) {
        throw new Error('Expiration month must be between 01 and 12.');
      }

      if (!/^\d{3,4}$/.test(cvv)) {
        throw new Error('CVV must be 3 or 4 digits.');
      }

      if (!/^\d{5}$/.test(zip)) {
        throw new Error('ZIP code must be 5 digits.');
      }

      console.log('PaymentForm - Local validation passed. Expiry:', expiryClean, 'ZIP:', zip);

      // 2. Request token from CardPointe iframe tokenizer
      let token;
      try {
        console.log('PaymentForm - Awaiting requestCardToken()...');
        token = await requestCardToken();
        console.log('PaymentForm - Token promise resolved! Token:', token);
      } catch (tokenErr) {
        console.error('PaymentForm - requestCardToken() promise rejected:', tokenErr);
        throw new Error('Failed to secure card token. Please verify card number.');
      }

      // 3. Post charge request to Cloudflare Pages Function
      console.log('PaymentForm - Sending /charge POST to Pages Function');
      const response = await fetch('/charge', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          token,
          amount: parseFloat(amount).toFixed(2),
          expiry: expiryClean, // MMYY format e.g. "1228"
          cvv2: cvv,
          zip,
          paymentLinkId
        }),
      });

      console.log('PaymentForm - Received response status from Worker:', response.status);
      const result = await response.json();
      console.log('PaymentForm - Received body from Worker:', result);

      if (!response.ok) {
        throw new Error(result.message || 'Payment processing failed.');
      }

      // Success
      console.log('PaymentForm - Payment successful! retref:', result.retref);
      if (onPaymentSuccess) {
        onPaymentSuccess(result.retref);
      }
    } catch (err) {
      console.error('PaymentForm - Submission catch block caught error:', err);
      setError(err.message);
      setIsProcessing(false);
    }
  };

  return (
    <form onSubmit={handlePaySubmit} className="fade-in">
      {error && (
        <div className="alert alert-error">
          <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div>{error}</div>
        </div>
      )}

      <div className="form-group">
        <label>Card Number</label>
        <div className="iframe-container">
          <iframe
            ref={iframeRef}
            id="tokenFrame"
            name="tokenFrame"
            src={iframeUrl}
            title="Secure Card Input"
            scrolling="no"
          />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label htmlFor="expiry">Expiration Date</label>
          <input
            id="expiry"
            type="text"
            required
            placeholder="MM/YY"
            value={expiry}
            onChange={handleExpiryChange}
            disabled={isProcessing}
            maxLength="5"
          />
        </div>

        <div className="form-group" style={{ marginBottom: 0 }}>
          <label htmlFor="cvv">CVV</label>
          <input
            id="cvv"
            type="password"
            required
            placeholder="e.g. 123"
            value={cvv}
            onChange={(e) => setCvv(e.target.value.replace(/\D/g, '').slice(0, 4))}
            disabled={isProcessing}
            maxLength="4"
          />
        </div>
      </div>

      <div className="form-group">
        <label htmlFor="zip">Billing ZIP Code</label>
        <input
          id="zip"
          type="text"
          required
          placeholder="e.g. 98101"
          value={zip}
          onChange={(e) => setZip(e.target.value.replace(/\D/g, '').slice(0, 5))}
          disabled={isProcessing}
          maxLength="5"
        />
      </div>

      <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '10px' }} disabled={isProcessing}>
        {isProcessing ? (
          <>
            <div className="spinner"></div>
            <span>Securing Payment...</span>
          </>
        ) : (
          `Pay $${parseFloat(amount).toFixed(2)}`
        )}
      </button>
    </form>
  );
}

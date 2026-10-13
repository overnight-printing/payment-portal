import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import { apiRequest, postJson } from '../lib/api';
import { CARD_TOKEN, validCardholderName } from '../../shared/validation';

const TOKEN_TIMEOUT_MS = 10000;

function validateExpiry(value) {
  const match = /^(0[1-9]|1[0-2])\/(\d{2})$/.exec(value);
  if (!match) return 'Enter a valid expiration date in MM/YY format.';

  const month = Number(match[1]);
  const year = 2000 + Number(match[2]);
  const now = new Date();
  const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const enteredMonth = new Date(year, month - 1, 1);

  return enteredMonth < currentMonth ? 'Use a card that has not expired.' : '';
}

function validateField(name, value) {
  if (name === 'cardholderName') return validCardholderName(value) ? '' : 'Enter the name on the card, up to 30 characters.';
  if (name === 'expiry') return validateExpiry(value);
  if (name === 'cvv') return /^\d{3,4}$/.test(value) ? '' : 'Enter the 3 or 4 digit security code.';
  if (name === 'zip') return /^\d{5}$/.test(value) ? '' : 'Enter the 5 digit billing ZIP code.';
  return '';
}

export default function PaymentForm({ amount, paymentLinkId, onPaymentSuccess, onPaymentPending, onInvoiceUnavailable, onInvoiceChanged, tokenizerOrigin }) {
  const [cardholderName, setCardholderName] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvv, setCvv] = useState('');
  const [zip, setZip] = useState('');
  const [touched, setTouched] = useState({});
  const [errors, setErrors] = useState({});
  const [isProcessing, setIsProcessing] = useState(false);
  const [isIframeReady, setIsIframeReady] = useState(false);
  const [formError, setFormError] = useState('');
  const [frameVersion, setFrameVersion] = useState(0);
  const [frameFailed, setFrameFailed] = useState(false);

  const iframeRef = useRef(null);
  const fieldRefs = useRef({});
  const pendingTokenRef = useRef(null);
  const tokenRef = useRef(null);
  const trustedFrameRef = useRef(null);
  const chargeControllerRef = useRef(null);
  const processingRef = useRef(false);
  const mountedRef = useRef(true);

  const [iframeUrl] = useState(() => {
    const cssStyle = `
      input {
        font-family: Arial, Helvetica, sans-serif;
        font-size: 16px;
        color: #1e293b;
        border: none;
        outline: none;
        background: transparent;
        width: 100%;
        box-sizing: border-box;
      }
      input::placeholder { color: #64748b; }
    `;
    const origin = tokenizerOrigin;
    return `${origin}/itoke/ajax-tokenizer.html?formatinput=true&enhancedresponse=true&sendcardtypingevent=true&css=${encodeURIComponent(cssStyle)}`;
  });

  const clearPendingToken = () => {
    if (pendingTokenRef.current?.timeoutId) {
      window.clearTimeout(pendingTokenRef.current.timeoutId);
    }
    pendingTokenRef.current = null;
  };

  useEffect(() => {
    mountedRef.current = true;

    const handleFrameMessage = (event) => {
      if (!iframeRef.current || event.source !== iframeRef.current.contentWindow || event.source !== trustedFrameRef.current) return;

      if (event.origin !== new URL(iframeUrl).origin) return;
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (data?.cardTyping || data?.message === '' || data?.validationError || data?.errorCode && String(data.errorCode) !== '0') {
          tokenRef.current = null;
          if (pendingTokenRef.current && !data?.cardTyping) {
            const { reject } = pendingTokenRef.current;
            clearPendingToken();
            reject(new Error('tokenization_failed'));
          }
          return;
        }
        const token = data?.token || data?.message;
        if (typeof token !== 'string' || !CARD_TOKEN.test(token)) return;
        if (pendingTokenRef.current) {
          const { resolve } = pendingTokenRef.current;
          clearPendingToken();
          tokenRef.current = null;
          resolve(token);
        } else tokenRef.current = token;
      } catch {
        tokenRef.current = null;
      }
    };

    window.addEventListener('message', handleFrameMessage);
    return () => {
      mountedRef.current = false;
      pendingTokenRef.current?.reject(new Error('tokenizer_unavailable'));
      clearPendingToken();
      tokenRef.current = null;
      chargeControllerRef.current?.abort();
      window.removeEventListener('message', handleFrameMessage);
    };
  }, [iframeUrl]);

  useEffect(() => {
    const timer = window.setTimeout(() => { if (!isIframeReady) setFrameFailed(true); }, 12000);
    return () => window.clearTimeout(timer);
  }, [frameVersion, isIframeReady]);

  const reloadFrame = () => {
    tokenRef.current = null;
    trustedFrameRef.current = null;
    setIsIframeReady(false);
    setFrameFailed(false);
    setFrameVersion((value) => value + 1);
  };

  const handleExpiryChange = (event) => {
    const digits = event.target.value.replace(/\D/g, '').slice(0, 4);
    const value = digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
    setExpiry(value);
    if (touched.expiry) setErrors((current) => ({ ...current, expiry: validateField('expiry', value) }));
  };

  const updateNumericField = (name, value, limit, setter) => {
    const nextValue = value.replace(/\D/g, '').slice(0, limit);
    setter(nextValue);
    if (touched[name]) setErrors((current) => ({ ...current, [name]: validateField(name, nextValue) }));
  };

  const handleBlur = (name, value) => {
    setTouched((current) => ({ ...current, [name]: true }));
    setErrors((current) => ({ ...current, [name]: validateField(name, value) }));
  };

  const requestCardToken = () => new Promise((resolve, reject) => {
    if (!isIframeReady || !iframeRef.current?.contentWindow) {
      reject(new Error('tokenizer_unavailable'));
      return;
    }

    if (tokenRef.current) {
      const token = tokenRef.current;
      tokenRef.current = null;
      resolve(token);
      return;
    }
    clearPendingToken();
    const timeoutId = window.setTimeout(() => {
      const pending = pendingTokenRef.current;
      clearPendingToken();
      pending?.reject(new Error('tokenization_timeout'));
    }, TOKEN_TIMEOUT_MS);
    // CardPointe tokenizes on blur; a result can arrive after the Pay button receives focus.
    pendingTokenRef.current = { resolve, reject, timeoutId };
  });

  const validateAll = () => {
    const nextErrors = {
      cardholderName: validateField('cardholderName', cardholderName),
      expiry: validateField('expiry', expiry),
      cvv: validateField('cvv', cvv),
      zip: validateField('zip', zip),
    };
    setTouched({ cardholderName: true, expiry: true, cvv: true, zip: true });
    setErrors(nextErrors);

    const firstInvalid = ['cardholderName', 'expiry', 'cvv', 'zip'].find((name) => nextErrors[name]);
    if (firstInvalid) {
      window.requestAnimationFrame(() => fieldRefs.current[firstInvalid]?.focus());
      return false;
    }
    return true;
  };

  const handlePaySubmit = async (event) => {
    event.preventDefault();
    if (processingRef.current || !validateAll()) return;

    processingRef.current = true;
    setIsProcessing(true);
    setFormError('');

    try {
      let token;
      try {
        token = await requestCardToken();
      } catch (tokenError) {
        if (tokenError.message === 'tokenization_timeout') {
          throw new Error('Card verification took too long. Check your connection and try again.', { cause: tokenError });
        }
        if (tokenError.message === 'tokenizer_unavailable') {
          throw new Error('The secure card field is still loading. Wait a moment and try again.', { cause: tokenError });
        }
        throw new Error('We could not verify the card number. Review it and try again.', { cause: tokenError });
      }

      const controller = new AbortController();
      chargeControllerRef.current = controller;
      let outcome;
      try {
        outcome = await apiRequest('/charge', {
          ...postJson({ amount, token, cardholderName: cardholderName.trim(), expiry: expiry.replace('/', ''), cvv2: cvv, zip, paymentLinkId }),
          timeout: 60000, signal: controller.signal,
        });
      } catch {
        if (mountedRef.current) onPaymentPending?.();
        return;
      }
      if (!mountedRef.current) return;
      const { response, data } = outcome;
      if (response.ok && data?.success === true && typeof data.retref === 'string') {
        setCvv('');
        onPaymentSuccess?.(data);
      } else if (response.status === 202 || response.status >= 500 || !data) {
        setCvv('');
        onPaymentPending?.();
      } else if (response.status === 404) {
        setCvv(''); onInvoiceUnavailable?.();
      } else if (data.code === 'amount_changed') {
        setCvv(''); onInvoiceChanged?.();
      } else {
        reloadFrame();
        setCvv('');
        setFormError(response.status === 402 ? 'Your card was declined. Re-enter the card details or try another card.' : response.status === 404 ? 'This invoice is unavailable. Contact the merchant before trying again.' : response.status === 429 ? 'Too many attempts. Wait a few minutes and check payment status.' : 'Check the payment details and try again.');
      }
    } catch {
      if (!mountedRef.current) return;
      reloadFrame();
      setFormError('We could not verify the card number. Re-enter it, then move to the expiration field and try again.');
      window.requestAnimationFrame(() => iframeRef.current?.focus());

    } finally {
      processingRef.current = false;
      if (mountedRef.current) setIsProcessing(false);
    }
  };

  return (
    <form onSubmit={handlePaySubmit} className="payment-form" aria-busy={isProcessing} noValidate>
      {formError && (
        <div className="alert alert-error" role="alert">
          <Icon name="warning" />
          <div>
            <strong>Payment needs attention</strong>
            <p>{formError}</p>
          </div>
        </div>
      )}

      <div className="form-group">
        <label htmlFor="cardholderName">Name on card</label>
        <input ref={(node) => { fieldRefs.current.cardholderName = node; }} id="cardholderName" type="text" required value={cardholderName} maxLength={30} autoComplete="cc-name" autoCapitalize="words" disabled={isProcessing} onChange={(event) => { const value = event.target.value; setCardholderName(value); if (touched.cardholderName) setErrors((current) => ({ ...current, cardholderName: validateField('cardholderName', value) })); }} onBlur={() => handleBlur('cardholderName', cardholderName)} aria-invalid={Boolean(errors.cardholderName)} aria-describedby="cardholder-error" />
        <p className="field-error" id="cardholder-error" aria-live="polite">{errors.cardholderName || ''}</p>
      </div>

      <div className="form-group" role="group" aria-labelledby="card-number-label" aria-describedby={!isIframeReady ? 'card-number-help' : undefined}>
        <span className="form-label" id="card-number-label">Card number<span className="sr-only">, required</span></span>
        <div className={`iframe-container${isIframeReady ? '' : ' is-loading'}`} inert={isProcessing ? true : undefined}>
          <iframe
            key={frameVersion}
            ref={iframeRef}
            id="tokenFrame"
            name="tokenFrame"
            src={iframeUrl}
            title="Secure card number field"
            scrolling="no"
            onLoad={() => { trustedFrameRef.current = iframeRef.current?.contentWindow; tokenRef.current = null; setIsIframeReady(true); setFrameFailed(false); }}
          />
        </div>
        {!isIframeReady && <p className="field-help" id="card-number-help">{frameFailed ? 'The card field did not load. Reload it to continue.' : 'Loading card field…'}</p>}
      </div>

      {frameFailed && <button type="button" className="btn btn-secondary" onClick={reloadFrame}>Reload secure card field</button>}
      <p className="sr-only" role="status">{isProcessing ? 'Processing payment. Please keep this page open.' : ''}</p>

      <div className="payment-field-grid">
        <div className="form-group">
          <label htmlFor="expiry">Expiration date</label>
          <input
            ref={(node) => { fieldRefs.current.expiry = node; }}
            id="expiry"
            required
            type="text"
            value={expiry}
            onChange={handleExpiryChange}
            onBlur={() => handleBlur('expiry', expiry)}
            disabled={isProcessing}
            maxLength="5"
            inputMode="numeric"
            autoComplete="cc-exp"
            placeholder="MM/YY"
            aria-invalid={Boolean(errors.expiry)}
            aria-describedby="expiry-error"
          />
          <p className="field-error" id="expiry-error" aria-live="polite">{errors.expiry || ''}</p>
        </div>

        <div className="form-group">
          <label htmlFor="cvv">Security code (CVV)</label>
          <input
            ref={(node) => { fieldRefs.current.cvv = node; }}
            id="cvv"
            required
            type="password"
            value={cvv}
            onChange={(event) => updateNumericField('cvv', event.target.value, 4, setCvv)}
            onBlur={() => handleBlur('cvv', cvv)}
            disabled={isProcessing}
            maxLength="4"
            inputMode="numeric"
            autoComplete="cc-csc"
            aria-invalid={Boolean(errors.cvv)}
            aria-describedby="cvv-help cvv-error"
          />
          <p className="field-help" id="cvv-help">3 or 4 digits</p>
          <p className="field-error" id="cvv-error" aria-live="polite">{errors.cvv || ''}</p>
        </div>
      </div>

      <div className="form-group">
        <label htmlFor="zip">Billing ZIP code</label>
        <input
          ref={(node) => { fieldRefs.current.zip = node; }}
          id="zip"
          required
          type="text"
          value={zip}
          onChange={(event) => updateNumericField('zip', event.target.value, 5, setZip)}
          onBlur={() => handleBlur('zip', zip)}
          disabled={isProcessing}
          maxLength="5"
          inputMode="numeric"
          autoComplete="postal-code"
          aria-invalid={Boolean(errors.zip)}
          aria-describedby="zip-error"
        />
        <p className="field-error" id="zip-error" aria-live="polite">{errors.zip || ''}</p>
      </div>

      <button type="submit" className="btn btn-primary btn-full" disabled={isProcessing || !isIframeReady}>
        {isProcessing ? (
          <>
            <span className="spinner" aria-hidden="true" />
            <span>Securing payment…</span>
          </>
        ) : (
          <>
            <Icon name="lock" />
            <span>Pay ${Number(amount).toFixed(2)}</span>
          </>
        )}
      </button>
      <p className="payment-support">Need help? Email <a href="mailto:contact@overnightprintingseattle.com">contact@overnightprintingseattle.com</a>.</p>
    </form>
  );
}

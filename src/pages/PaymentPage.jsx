import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import Icon from '../components/Icon';
import PaymentForm from '../components/PaymentForm';
import { apiRequest } from '../lib/api';
import { validPaymentLink } from '../../shared/validation';

const LOOKUP_TIMEOUT_MS = 12000;

function formatAmount(value) {
  const amount = Number(value);
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
}

function parseCustomerName(rawValue = '') {
  const match = rawValue.match(/^(.*?)(?:\s*\((.*?)\))?(?:\s*\[Job:[^\]]*\])?$/);
  return {
    customerName: match?.[1]?.trim() || '',
    companyName: match?.[2]?.trim() || '',
  };
}

export default function PaymentPage() {
  const { id } = useParams();
  const [loading, setLoading] = useState(true);
  const [errorKind, setErrorKind] = useState('');
  const [paymentLink, setPaymentLink] = useState(null);
  const [localPaid, setLocalPaid] = useState(false);
  const [retref, setRetref] = useState('');
  const [retryCount, setRetryCount] = useState(0);
  const [pending, setPending] = useState(false);
  const [receiptSent, setReceiptSent] = useState(false);
  const [paidAt, setPaidAt] = useState(null);
  const [cardLast4, setCardLast4] = useState(null);
  const receiptTitleRef = useRef(null);

  const fetchPaymentDetails = useCallback(async (signal) => {
    await Promise.resolve();

    if (!id) {
      setErrorKind('unavailable');
      setLoading(false);
      return;
    }

    setLoading(true);
    setErrorKind('');

    try {
      const { response, data } = await apiRequest(`/payment-link?id=${encodeURIComponent(id)}`, { signal, timeout: LOOKUP_TIMEOUT_MS });
      if (signal.aborted) return;

      if (response.status === 404 || response.status === 400) {
        setErrorKind('unavailable');
        return;
      }
      if (!response.ok || !validPaymentLink(data) || data.id.toLowerCase() !== id.toLowerCase()) {
        setErrorKind('temporary');
        return;
      }

      setPaymentLink(data);
      setLocalPaid(data.status === 'paid');
      setPending(['processing', 'review'].includes(data.status));
      setReceiptSent(data.receipt_sent === true);
      setPaidAt(data.paid_at);
      setCardLast4(data.card_last4);
      setRetref(data.retref || '');
    } catch {
      if (!signal.aborted) setErrorKind('temporary');
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    const controller = new AbortController();
    const startId = window.setTimeout(() => fetchPaymentDetails(controller.signal), 0);
    return () => {
      window.clearTimeout(startId);
      controller.abort();
    };
  }, [fetchPaymentDetails, retryCount]);

  useEffect(() => {
    if (localPaid && !loading) receiptTitleRef.current?.focus();
  }, [localPaid, loading]);

  const handlePaymentSuccess = (result) => {
    setLocalPaid(true);
    setPending(false);
    setRetref(result.retref);
    setPaidAt(result.paid_at);
    setCardLast4(result.card_last4);
    setReceiptSent(result.receipt_sent === true);
    window.scrollTo({ top: 0, behavior: 'auto' });
  };

  if (loading) {
    return (
      <main className="card payment-card state-card fade-in" aria-busy="true">
        <span className="spinner spinner-accent spinner-large" aria-hidden="true" />
        <h1>Loading invoice</h1>
        <p role="status" aria-live="polite">Retrieving secure payment details…</p>
      </main>
    );
  }

  if (errorKind) {
    const unavailable = errorKind === 'unavailable';
    const changed = errorKind === 'changed';
    return (
      <main className="card payment-card fade-in">
        <div className="brand-logo-container">
          <img width={761} height={240} src="/logo.png" alt="Overnight Printing Seattle" className="brand-logo" />
        </div>
        <div className="alert alert-error" role="alert">
          <Icon name="warning" size={24} />
          <div>
            <h1>{changed ? 'Invoice amount updated' : unavailable ? 'Payment link unavailable' : 'We could not load this invoice'}</h1>
            <p>
              {changed ? 'The amount changed before payment started. Reload the invoice and review the new total before paying.' : unavailable
                ? 'This link may be missing, expired, or no longer active.'
                : 'A temporary connection problem prevented the invoice from loading.'}
            </p>
          </div>
        </div>
        <div className="recovery-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setLoading(true);
              setErrorKind('');
              setRetryCount((count) => count + 1);
            }}
          >
            <Icon name="refresh" />
            {changed ? 'Review updated invoice' : 'Try again'}
          </button>
          <a className="btn btn-secondary" href="mailto:contact@overnightprintingseattle.com?subject=Payment%20link%20help">
            Contact support
          </a>
        </div>
        <p className="support-note">If you contact us, include your invoice number if you have it. Do not email card details.</p>
      </main>
    );
  }

  const { customerName, companyName } = parseCustomerName(paymentLink?.customer_name);

  if (localPaid) {
    return (
      <main className="card payment-card fade-in">
        <div className="brand-logo-container">
          <img width={761} height={240} src="/logo.png" alt="Overnight Printing Seattle" className="brand-logo" />
        </div>
        <section className="success-state" aria-labelledby="payment-received-title">
          <p className="sr-only" role="status">Payment received. Your receipt is ready.</p>
          <div className="status-icon status-icon-success"><Icon name="check" size={36} /></div>
          <h1 id="payment-received-title" ref={receiptTitleRef} tabIndex={-1}>Payment received</h1>
          <p className="subtitle">Thank you. This invoice has been successfully processed.</p>

          <div className="receipt" aria-label="Payment receipt">
            <div className="receipt-row">
              <span className="receipt-label">Invoice number</span>
              <span className="receipt-value">#{paymentLink?.order_number}</span>
            </div>
            <div className="receipt-row">
              <span className="receipt-label">Customer name</span>
              <span className="receipt-value">{customerName}</span>
            </div>
            {companyName && (
              <div className="receipt-row">
                <span className="receipt-label">Company name</span>
                <span className="receipt-value">{companyName}</span>
              </div>
            )}
            {retref && (
              <div className="receipt-row">
                <span className="receipt-label">Reference number</span>
                <span className="receipt-value receipt-reference">{retref}</span>
              </div>
            )}
            {cardLast4 && <div className="receipt-row"><span className="receipt-label">Payment method</span><span className="receipt-value">Card ending in {cardLast4}</span></div>}
            {paidAt && <div className="receipt-row"><span className="receipt-label">Paid on</span><span className="receipt-value">{new Date(paidAt).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', timeZoneName: 'short' })}</span></div>}
            <div className="receipt-row receipt-total">
              <span className="receipt-label">Amount paid</span>
              <span className="receipt-value amount-value">${formatAmount(paymentLink?.amount)} USD</span>
            </div>
          </div>
          <p className="support-note">{receiptSent ? <>Your receipt email was accepted for delivery to <span className="breakable">{paymentLink?.customer_email}</span>.</> : <>Keep this receipt for your records. If you need an email copy, <a href="mailto:contact@overnightprintingseattle.com">contact us</a>.</>}</p>
          <button type="button" className="btn btn-secondary receipt-print" onClick={() => window.print()}>Print or save receipt</button>
        </section>
      </main>
    );
  }

  return (
    <main className="card payment-card payment-checkout-card fade-in">
      <header className="payment-page-header">
        <img width={761} height={240} src="/logo.png" alt="Overnight Printing Seattle" className="payment-brand-logo" />
        <div className="payment-header-copy">
          <h1>Complete payment</h1>
        </div>
        <div className="payment-header-badge">
          <Icon name="lock" size={17} />
          <span>Secure checkout</span>
        </div>
      </header>

      <div className="payment-workspace">
        <section className="payment-context-panel" aria-labelledby="invoice-summary-title">
          <div className="payment-section-heading">
            <h2 id="invoice-summary-title">Invoice summary</h2>
          </div>

          <div className="receipt" aria-label="Invoice summary">
            <div className="receipt-row">
              <span className="receipt-label">Invoice number</span>
              <span className="receipt-value">#{paymentLink.order_number}</span>
            </div>
            <div className="receipt-row">
              <span className="receipt-label">Customer name</span>
              <span className="receipt-value">{customerName}</span>
            </div>
            {companyName && (
              <div className="receipt-row">
                <span className="receipt-label">Company name</span>
                <span className="receipt-value">{companyName}</span>
              </div>
            )}
          </div>

          <div className="amount-due" aria-label="Total due">
            <div>
              <span className="amount-label">Total due</span>
            </div>
            <strong className="amount-value">${formatAmount(paymentLink.amount)} <small>USD</small></strong>
          </div>

          <div className="accepted-cards" aria-label="Accepted cards">
            <Icon name="card" />
            <span>Visa · Mastercard · American Express · Discover</span>
          </div>
        </section>

        <section className="payment-entry-panel" aria-labelledby="payment-details-title">
          <div className="payment-section-heading">
            <h2 id="payment-details-title">Payment details</h2>
          </div>
          {pending ? <div className="alert alert-warning alert-stacked" role="status">
            <h2>Checking your payment</h2>
            <p>Your payment may still be processing. Please do not pay again or use a different link.</p>
            <button type="button" className="btn btn-primary" onClick={() => { setLoading(true); setRetryCount((count) => count + 1); }}>Check payment status</button>
            <p>If this stays unresolved, <a href={`mailto:contact@overnightprintingseattle.com?subject=${encodeURIComponent(`Payment status: invoice ${paymentLink.order_number}`)}`}>contact the merchant</a> and include invoice #{paymentLink.order_number}. Do not send card details.</p>
          </div> : <PaymentForm
            amount={paymentLink.amount}
            paymentLinkId={id}
            tokenizerOrigin={paymentLink.tokenizer_origin}
            onPaymentSuccess={handlePaymentSuccess}
            onPaymentPending={() => { setPending(true); window.scrollTo({ top: 0, behavior: 'auto' }); }}
            onInvoiceUnavailable={() => setErrorKind('unavailable')}
            onInvoiceChanged={() => setErrorKind('changed')}
          />}
        </section>
      </div>
    </main>
  );
}

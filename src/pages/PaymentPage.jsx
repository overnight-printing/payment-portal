import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import PaymentForm from '../components/PaymentForm';

export default function PaymentPage() {
  const { id } = useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [paymentLink, setPaymentLink] = useState(null);
  const [localPaid, setLocalPaid] = useState(false);
  const [retref, setRetref] = useState('');

  useEffect(() => {
    async function fetchPaymentDetails() {
      if (!id) {
        setError('Invalid payment link ID.');
        setLoading(false);
        return;
      }

      try {
        const response = await fetch(`/payment-link?id=${id}`);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.message || 'Payment link not found or has expired.');
        }

        setPaymentLink(data);
        if (data.status === 'paid') {
          setLocalPaid(true);
          setRetref(data.retref || '');
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    fetchPaymentDetails();
  }, [id]);

  const handlePaymentSuccess = (transactionRef) => {
    setLocalPaid(true);
    setRetref(transactionRef);
  };

  if (loading) {
    return (
      <div className="card fade-in" style={{ textAlign: 'center', padding: '60px 40px' }}>
        <div className="spinner" style={{ borderTopColor: 'var(--accent)', width: '32px', height: '32px', borderWidth: '4px', margin: '0 auto 20px' }}></div>
        <p>Loading invoice details...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card fade-in">
        <div className="alert alert-error" style={{ marginBottom: 0 }}>
          <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div>
            <strong style={{ display: 'block', marginBottom: '4px', fontSize: '16px' }}>Error loading payment</strong>
            <span style={{ opacity: 0.9 }}>{error}</span>
          </div>
        </div>
      </div>
    );
  }

  // Parse out customer name and company name
  const customerNameRaw = paymentLink?.customer_name || '';
  let customerName = customerNameRaw;
  let companyName = '';

  const match = customerNameRaw.match(/^(.*?)(?:\s*\((.*?)\))?(?:\s*\[Job:[^\]]*\])?$/);
  if (match) {
    customerName = match[1] ? match[1].trim() : '';
    companyName = match[2] ? match[2].trim() : '';
  }

  if (localPaid) {
    return (
      <div className="card fade-in" style={{ textAlign: 'center' }}>
        <div className="brand-logo-container">
          <img src="/logo.png" alt="Overnight Printing Seattle" className="brand-logo" />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '10px 0' }}>
          <div style={{ 
            backgroundColor: 'var(--success-bg)', 
            color: 'var(--success)', 
            width: '64px', 
            height: '64px', 
            borderRadius: '50%', 
            display: 'flex', 
            justifyContent: 'center', 
            alignItems: 'center', 
            marginBottom: '24px' 
          }}>
            <svg width="36" height="36" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1>Payment Received</h1>
          <p className="subtitle">Thank you for your payment! This invoice has already been successfully processed.</p>
          
          <div className="receipt" style={{ width: '100%', boxSizing: 'border-box', textAlign: 'left' }}>
            <div className="receipt-row">
              <span className="receipt-label">Invoice Number</span>
              <span className="receipt-value">#{paymentLink?.order_number}</span>
            </div>
            <div className="receipt-row">
              <span className="receipt-label">Customer Name</span>
              <span className="receipt-value">{customerName}</span>
            </div>
            {companyName && (
              <div className="receipt-row">
                <span className="receipt-label">Company Name</span>
                <span className="receipt-value">{companyName}</span>
              </div>
            )}

            {retref && (
              <div className="receipt-row">
                <span className="receipt-label">Ref Number</span>
                <span className="receipt-value" style={{ fontFamily: 'var(--mono)', fontSize: '13px' }}>{retref}</span>
              </div>
            )}
            <div className="receipt-row">
              <span className="receipt-label">Amount Paid</span>
              <span className="receipt-value">${parseFloat(paymentLink?.amount).toFixed(2)} USD</span>
            </div>
          </div>
          <p style={{ fontSize: '13px', opacity: 0.7 }}>
            A confirmation receipt will be generated and sent to {paymentLink?.customer_email}.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="card fade-in">
      <div className="brand-logo-container">
        <img src="/logo.png" alt="Overnight Printing Seattle" className="brand-logo" />
      </div>
      <h1>Complete Payment</h1>
      <p className="subtitle">Please review the printing invoice details below and securely pay with your card.</p>

      <div className="receipt">
        <div className="receipt-row">
          <span className="receipt-label">Invoice Number</span>
          <span className="receipt-value">#{paymentLink.order_number}</span>
        </div>
        <div className="receipt-row">
          <span className="receipt-label">Customer Name</span>
          <span className="receipt-value">{customerName}</span>
        </div>
        {companyName && (
          <div className="receipt-row">
            <span className="receipt-label">Company Name</span>
            <span className="receipt-value">{companyName}</span>
          </div>
        )}

        <div className="receipt-row">
          <span className="receipt-label">Total Due</span>
          <span className="receipt-value">${parseFloat(paymentLink.amount).toFixed(2)} USD</span>
        </div>
      </div>

      <PaymentForm 
        amount={paymentLink.amount}
        paymentLinkId={id}
        onPaymentSuccess={handlePaymentSuccess}
      />
    </div>
  );
}

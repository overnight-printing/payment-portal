import { BrowserRouter, Routes, Route, useParams, Link } from 'react-router-dom';
import CreateLink from './pages/CreateLink';
import PaymentPage from './pages/PaymentPage';
import { decodePaymentCode } from '../shared/payment-link';

function InvoiceRoute() {
  const { id, code } = useParams();
  const paymentLinkId = id || decodePaymentCode(code);
  return <PaymentPage key={paymentLinkId || code} paymentLinkId={paymentLinkId} />;
}

function UnavailablePage() {
  return <main className="card payment-card state-card">
    <h1>Payment link unavailable</h1>
    <p>Check the complete link in your invoice email or contact the merchant for help.</p>
    <a className="btn btn-primary" href="mailto:contact@overnightprintingseattle.com?subject=Payment%20link%20help">Contact support</a>
    <Link to="/" className="support-note">Staff portal</Link>
  </main>;
}

export default function App() {
  return <BrowserRouter><Routes>
    <Route element={<CreateLink />}>
      <Route path="/" />
      <Route path="/dashboard" />
      <Route path="/invoices" />
      <Route path="/send" />
      <Route path="/customers" />
    </Route>
    <Route path="/pay/:id" element={<InvoiceRoute />} />
    <Route path="/p/:code" element={<InvoiceRoute />} />
    <Route path="*" element={<UnavailablePage />} />
  </Routes></BrowserRouter>;
}

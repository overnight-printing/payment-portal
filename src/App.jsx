import { BrowserRouter, Routes, Route } from 'react-router-dom';
import CreateLink from './pages/CreateLink';
import PaymentPage from './pages/PaymentPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<CreateLink />} />
        <Route path="/pay/:id" element={<PaymentPage />} />
      </Routes>
    </BrowserRouter>
  );
}

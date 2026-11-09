import { BrowserRouter, Route, Routes } from 'react-router-dom';
import LandingPage from './pages/LandingPage';
import TankPage from './pages/TankPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/tank" element={<TankPage />} />
      </Routes>
    </BrowserRouter>
  );
}

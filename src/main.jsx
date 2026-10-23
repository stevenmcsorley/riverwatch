import React from 'react';
import { createRoot } from 'react-dom/client';
import 'leaflet/dist/leaflet.css';
import './style.css';
import App from './ui.jsx';

createRoot(document.getElementById('root')).render(<App />);

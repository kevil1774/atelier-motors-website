import axios from 'axios';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import App from './App.jsx';
import './index.css';

const api = axios.create({
    baseURL: import.meta.env.VITE_API_URL || '/api'
});

api.interceptors.request.use((config) => {
    const token = localStorage.getItem('atelier-token');

    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }

    return config;
});

const mediaUrl = (path) =>
    path?.startsWith('/uploads/') ? path : path;

function CarCard({ car: c }) {
    const image = c.images?.[0];

    return (
        <Link className="car-card" to={`/cars/${c._id}`}>
            <div className="car-photo">
                {image && (
                    <img
                        src={mediaUrl(image)}
                        alt={`${c.brand} ${c.model}`}
                    />
                )}

                <span className="status-pill">{c.year}</span>

                <button
                    className="heart"
                    onClick={(e) => {
                        e.preventDefault();
                        e.currentTarget.classList.toggle('liked');
                    }}
                    aria-label="Save vehicle"
                >
                    ♥
                </button>
            </div>

            <div className="car-info">
                <div>
                    <h3>
                        {c.brand} {c.model}
                    </h3>

                    <p>
                        {c.variant || c.transmission || 'Curated selection'}
                        <span> · </span>
                        {Number(c.mileage || 0).toLocaleString()} mi
                    </p>
                </div>

                <b>${Number(c.price || 0).toLocaleString()}</b>
            </div>

            <div className="card-bottom">
                <span>
                    {c.location || 'Atelier Motors'}
                </span>
                <span>↗</span>
            </div>
        </Link>
    );
}

createRoot(document.getElementById('root')).render(
    <BrowserRouter>
        <App />
    </BrowserRouter>
);
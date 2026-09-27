import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import mongoSanitize from 'express-mongo-sanitize';
import morgan from 'morgan';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
    collectDefaultMetrics,
    Counter,
    Histogram,
    Registry
} from '@prometheus-io/client';

import api from './src/routes.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

/*
 * Prometheus monitoring
 *
 * A dedicated registry keeps application metrics separate
 * from the default global registry.
 */
const metricsRegistry = new Registry();

collectDefaultMetrics({
    register: metricsRegistry,
    prefix: 'atelier_'
});

const httpRequestsTotal = new Counter({
    name: 'atelier_http_requests_total',
    help: 'Total number of HTTP requests received by the Atelier Motors API.',
    labelNames: ['method', 'route', 'status_code'],
    registers: [metricsRegistry]
});

const httpRequestDuration = new Histogram({
    name: 'atelier_http_request_duration_seconds',
    help: 'HTTP request duration in seconds.',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
    registers: [metricsRegistry]
});

/*
 * HTTP request metrics middleware.
 *
 * The response event fires after the response status is known,
 * allowing the metrics to record the final HTTP status code.
 */
app.use((req, res, next) => {
    const start = process.hrtime.bigint();

    res.on('finish', () => {
        const duration =
            Number(process.hrtime.bigint() - start) / 1_000_000_000;

        const route =
            req.route?.path ||
            (req.path.startsWith('/api') ? '/api' : req.path);

        const labels = {
            method: req.method,
            route,
            status_code: String(res.statusCode)
        };

        httpRequestsTotal.inc(labels);
        httpRequestDuration.observe(labels, duration);
    });

    next();
});

app.use(
    helmet({
        crossOriginResourcePolicy: {
            policy: 'cross-origin'
        }
    })
);

app.use(
    cors({
        origin: process.env.CLIENT_URL || 'http://localhost:5173'
    })
);

app.use(express.json({ limit: '1mb' }));

app.use(mongoSanitize());

app.use(morgan('dev'));

app.use(
    '/api',
    rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: 300,
        standardHeaders: true,
        legacyHeaders: false
    })
);

const uploadDir = path.resolve(
    process.env.UPLOAD_DIR || path.join(dirname, 'uploads')
);

fs.mkdirSync(uploadDir, {
    recursive: true
});

app.use('/uploads', express.static(uploadDir));

app.get('/api/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        version: process.env.APP_VERSION || '1.0.0'
    });
});

/*
 * Prometheus metrics endpoint.
 *
 * This endpoint intentionally sits outside /api so that
 * Prometheus can scrape it without consuming the API
 * rate-limit budget.
 */
app.get('/metrics', async (req, res) => {
    try {
        res.set('Content-Type', metricsRegistry.contentType);
        res.end(await metricsRegistry.metrics());
    } catch (error) {
        console.error('Failed to generate Prometheus metrics:', error);
        res.status(500).end();
    }
});

app.use('/api', api);

app.use((req, res) =>
    res.status(404).json({
        message: 'The requested resource was not found.'
    })
);

app.use((err, req, res, next) => {
    console.error(err);

    const status =
        err.status ||
        err.statusCode ||
        (
            err.name === 'ValidationError' ||
            err.name === 'CastError'
                ? 400
                : 500
        );

    res.status(status).json({
        message:
            status >= 500
                ? 'Something went wrong. Please try again.'
                : err.message
    });
});

export default app;
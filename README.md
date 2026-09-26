# Atelier Motors

A premium car dealership platform with a public inventory website, protected dealer workspace, Express REST API and MongoDB persistence.

## Features

- Public home, inventory search, vehicle detail, about and contact pages.
- JWT administrator sign-in; passwords are hashed with bcrypt.
- Vehicle, customer, enquiry and sale CRUD through authenticated API endpoints.
- Vehicle image uploads (JPEG, PNG, WebP and AVIF; up to 10 files, 5 MB each).
- Completing a sale marks the vehicle sold; pending sales reserve it, and cancelling/deleting releases it when no completed sale remains.
- Live dashboard counts and revenue aggregates from MongoDB.
- Responsive public pages and dealer portal.

## Tech stack and structure

- `frontend/`: React, Vite, React Router, Axios and Lucide.
- `backend/`: Express, Mongoose, JWT, bcrypt, Multer, Helmet and rate limiting.
- MongoDB stores all application records and object references.

## Requirements

- Node.js 20 or later and npm.
- MongoDB 6 or later, running locally or available through a connection URI.

## Install and configure

From the repository root:

```sh
cp .env.example .env
npm install
```

On Windows PowerShell, copy the environment template with:

```powershell
Copy-Item .env.example .env
npm install
```

Set `MONGODB_URI`, a long random `JWT_SECRET`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` in `.env`. `UPLOAD_DIR` defaults to `backend/uploads`; `CLIENT_URL` defaults to `http://localhost:5173`.

## Seed and run

Start MongoDB first, then from the project root:

```sh
npm run seed
npm run dev
```

Open <http://localhost:5173>. The API listens on <http://localhost:5000>. The seed command reads the admin credentials from `.env` and creates sample records; it resets the sample cars, customers, enquiries, and sales each time it runs. It upserts the administrator account.

To build the frontend and run the API in production mode:

```sh
npm run build
npm start
```

The seed creates an administrator using the environment credentials. No password is embedded in the browser bundle.

## API tests

The integration tests use a separate MongoDB database so they can clear their collections safely. Set `TEST_MONGODB_URI` to a disposable test database URI and run `npm test -w backend`. They cover login, CRUD for cars/customers/enquiries/sales, sale availability updates, and dashboard statistics. Tests are skipped when `TEST_MONGODB_URI` is unset.

## Environment variables

| Variable | Purpose |
|---|---|
| `PORT` | API port (default 5000) |
| `MONGODB_URI` | MongoDB connection string |
| `JWT_SECRET` | Signing key for 12-hour JWTs |
| `UPLOAD_DIR` | Destination for uploaded vehicle images |
| `CLIENT_URL` | Allowed browser origin |
| `ADMIN_NAME` | Seeded admin display name |
| `ADMIN_EMAIL` | Seeded admin email |
| `ADMIN_PASSWORD` | Seeded admin password |

## API overview

All routes are prefixed with `/api`.

| Method and path | Access | Purpose |
|---|---|---|
| `POST /auth/login` | Public | Sign in and receive a JWT |
| `POST /auth/register` | Admin | Create a staff/admin user |
| `GET /cars`, `GET /cars/:id` | Public | Search and read available inventory |
| `POST /cars`, `PUT /cars/:id`, `DELETE /cars/:id` | Admin | Manage vehicles |
| `POST /upload` | Admin | Upload multiple vehicle images |
| `GET/POST/PUT/DELETE /customers[/:id]` | Admin | Customer CRUD |
| `GET/POST/PUT/DELETE /enquiries[/:id]` | Admin | Enquiry CRUD |
| `POST /public/enquiries` | Public | Submit a website enquiry |
| `GET/POST/PUT/DELETE /sales[/:id]` | Admin | Sales CRUD and inventory status sync |
| `GET /dashboard/stats` | Admin | Live counts, revenue and monthly totals |
| `GET /health` | Public | API and database readiness |

List endpoints return `{ items, total, page, pages }`, accept `search`, `page`, `limit` and `sort`; vehicle lists also accept `brand`, `fuelType`, `transmission`, `minPrice`, `maxPrice`, `minYear`, `maxYear`, and `status`.

Admin sign-in is at `/login`. Use the `ADMIN_EMAIL` and `ADMIN_PASSWORD` set in `.env` after running the seed command.

## Troubleshooting

- **MongoDB connection failed:** ensure the MongoDB service is running and `MONGODB_URI` is reachable.
- **Sign in fails:** run `npm run seed` after checking the admin email/password in `.env`.
- **Browser API errors:** verify the API is on port 5000 and `CLIENT_URL` matches the frontend origin.
- **Uploads fail:** ensure `UPLOAD_DIR` can be created and written by the backend process.
- **Port is busy:** set `PORT` in `.env` and set `VITE_API_URL` in `frontend/.env.local` to the corresponding `/api` URL.

## Current scope notes

The admin CRUD views are generic data-table/forms; sale entry uses MongoDB customer and vehicle IDs. Public inventory search is backed by MongoDB. If the API is not running, the home/inventory pages use curated display cards as a graceful public fallback; admin data never uses fake records.

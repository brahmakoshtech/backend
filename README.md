# Brahmakosh

**A holistic spiritual wellness platform** — astrology, numerology, spiritual activities, expert consultations, karma points, sankalpas, and AI-powered chat with astrologer partners.

---

## Table of Contents

- [Overview](#overview)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [User Roles & Access](#user-roles--access)
- [Login Flow (Complete)](#login-flow-complete)
- [API Reference](#api-reference)
- [Environment Setup](#environment-setup)
- [Running the Project](#running-the-project)
- [Key Features](#key-features)

---

## Overview

Brahmakosh is a full-stack spiritual wellness application that provides:

- **Multi-tenant architecture** — Clients (organizations) manage their own users
- **Role-based dashboards** — Super Admin, Admin, Client, User, Partner
- **Astrology & Numerology** — Birth charts, kundali, panchang, remedies, doshas
- **Partner Chat** — Real-time chat between users and astrologer partners
- **Spiritual Activities** — Meditation, chanting, prayer, sankalpas, karma points
- **Mobile-first** — Multi-step registration, Firebase/Google auth, OTP verification

---

## Tech Stack

| Layer      | Technology                          |
|-----------|--------------------------------------|
| **Backend** | Node.js, Express, MongoDB, Socket.io |
| **Frontend** | Vue 3, Vite, Bootstrap 5             |
| **Auth**    | JWT, bcrypt, Google OAuth, Firebase  |
| **APIs**    | AstrologyAPI, Gemini AI, Deepgram    |
| **Storage** | AWS S3                               |

---

## Project Structure

```
Brahmakosh/
├── backend/                    # Node.js API server
│   ├── config/                 # initSuperAdmin, etc.
│   ├── middleware/             # auth.js, partnerAuth.js
│   ├── models/                 # User, Admin, Client, Partner, Astrology, etc.
│   ├── routes/
│   │   ├── auth/               # superAdminAuth, adminAuth, clientAuth, userAuth
│   │   ├── mobile/             # userProfile, clientProfile, userRegistration, chat
│   │   └── *.js                # client, admin, superAdmin, chatRoutes
│   ├── services/               # astrologyService, numerologyService, chatWebSocket
│   └── utils/                  # s3, otp, firebaseAuth
├── frontend/                   # Vue 3 SPA
│   └── src/
│       ├── router/             # Route definitions
│       ├── views/              # admin, client, super-admin, mobile, partner
│       └── store/              # Auth store
└── testing/                    # Test frontend
```

---

## User Roles & Access

| Role          | Model      | Scope                                      |
|---------------|------------|--------------------------------------------|
| **Super Admin** | Admin      | Full system, create admins, approve logins |
| **Admin**       | Admin      | Manage clients/users, settings, prompts    |
| **Client**      | Client     | Own users, spiritual content, karma, tools |
| **User**        | User       | App users (web/mobile), astrology, chat    |
| **Partner**     | Partner    | Astrologers, chat with users, earnings     |

---

## Login Flow (Complete)

### 1. Super Admin Dashboard Login

**API:** `POST /api/auth/super-admin/login`  
**Frontend:** `/super-admin/login` → `/super-admin/overview`

| Step | Description |
|------|-------------|
| 1 | User submits **email + password** |
| 2 | Backend finds `Admin` with `role: 'super_admin'` |
| 3 | Validates password via `comparePassword()` |
| 4 | Checks `isActive === true` |
| 5 | Generates JWT with `role: 'super_admin'` |
| 6 | Returns `{ user, token }` |
| 7 | Frontend stores token and redirects to dashboard |

**Credentials:** Set via env — `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASSWORD`. Auto-created on first server start.

---

### 2. Admin Dashboard Login

**API:** `POST /api/auth/admin/login`  
**Frontend:** `/admin/login` → `/admin/overview`

| Step | Description |
|------|-------------|
| 1 | User submits **email + password** |
| 2 | Backend finds `Admin` with `role: 'admin'` |
| 3 | Validates password |
| 4 | Checks `isActive === true` |
| 5 | Checks `loginApproved === true` (Super Admin approval required) |
| 6 | Generates JWT with `role: 'admin'` |
| 7 | Returns `{ user, token }` |

**Note:** Admins are created by Super Admin. `loginApproved` must be set by Super Admin before they can log in.

---

### 3. Client Dashboard Login

**API:** `POST /api/auth/client/login`  
**Frontend:** `/client/login` → `/client/overview`

| Step | Description |
|------|-------------|
| 1 | User submits **email + password** |
| 2 | Backend finds `Client` by email |
| 3 | Validates password |
| 4 | Checks `isActive === true` |
| 5 | Generates JWT with `role: 'client'` |
| 6 | Returns `{ user, token }` |

**Registration:** `POST /api/auth/client/register` — Client can self-register (no approval needed).

---

### 4. User Dashboard / Mobile User Login

Two paths:

#### A. Web User Login (no client)

**API:** `POST /api/auth/user/login`  
**Frontend:** `/user/login` → `/user/overview`

| Step | Description |
|------|-------------|
| 1 | User submits **email + password** |
| 2 | Backend finds `User` by email |
| 3 | Validates password |
| 4 | Checks `isActive === true` |
| 5 | Checks `loginApproved === true` (or `registrationStep === 3` for mobile users) |
| 6 | Generates JWT with `role: 'user'`, `clientId` if present |
| 7 | Returns `{ user, token, clientId, clientName }` |

**Registration:** `POST /api/auth/user/register` — Web users need Super Admin approval (`loginApproved`).

#### B. Mobile User (Multi-step, with Client)

**Base:** `clientId` required. Users belong to a Client (org).

| Step | API | Purpose |
|------|-----|---------|
| 1 | `POST /api/mobile/user/register/step1` | Email OTP sent |
| 2 | `POST /api/mobile/user/register/step1/verify` | Email verified |
| 3 | `POST /api/mobile/user/register/step2` | Mobile OTP sent |
| 4 | `POST /api/mobile/user/register/step2/verify` | Mobile verified |
| 5 | `POST /api/mobile/user/register/step3` | Profile (name, dob, place, etc.) saved |
| 6 | `POST /api/mobile/user/login` | Email + password login |

**Alternatives:**
- **Google:** `POST /api/mobile/user/register/google`
- **Firebase:** `POST /api/mobile/user/register/firebase`, `POST /api/mobile/user/login/firebase`

**Mobile login:** `POST /api/auth/user/login` or `POST /api/mobile/user/login` — Same logic; mobile users with `registrationStep === 3` are auto-approved.

---

### 5. Partner (Astrologer) Login

**API:** `POST /api/partners/login`  
**Frontend:** `/partner/login` → `/partner/dashboard`

| Step | Description |
|------|-------------|
| 1 | Partner submits **email + password** |
| 2 | Backend finds `Partner` by email |
| 3 | Validates password |
| 4 | Checks `isActive === true` |
| 5 | Generates JWT with `role: 'partner'` |
| 6 | Returns `{ partner, token }` |

**Google login:** `POST /api/partners/google-login` with Google credential.

---

### Auth Middleware Flow

```
Request → Authorization: Bearer <token>
       → jwt.verify(token) → decoded { userId, role, clientId? }
       → Load user from Admin | Client | User | Partner based on role
       → req.user = user
       → authorize(...roles) checks req.user.role
```

### Login Flow Summary (Quick Reference)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ROLE          │ LOGIN ENDPOINT                    │ APPROVAL REQUIRED?       │
├───────────────┼──────────────────────────────────┼──────────────────────────┤
│ Super Admin   │ POST /api/auth/super-admin/login  │ No (env-created)         │
│ Admin         │ POST /api/auth/admin/login        │ Yes (Super Admin)        │
│ Client        │ POST /api/auth/client/login       │ No (isActive only)       │
│ User (Web)    │ POST /api/auth/user/login         │ Yes (Super Admin)        │
│ User (Mobile) │ POST /api/auth/user/login         │ No (registrationStep=3)  │
│ Partner       │ POST /api/partners/login          │ No (isActive only)       │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## API Reference

### Auth Endpoints

| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/super-admin/login` | Public | Super Admin login |
| POST | `/api/auth/admin/login` | Public | Admin login |
| GET | `/api/auth/admin/me` | Admin | Current admin |
| POST | `/api/auth/client/login` | Public | Client login |
| POST | `/api/auth/client/register` | Public | Client registration |
| GET | `/api/auth/client/me` | Client | Current client |
| POST | `/api/auth/user/login` | Public | User login |
| POST | `/api/auth/user/register` | Public | User registration |
| POST | `/api/auth/user/google` | Public | User Google OAuth |
| GET | `/api/auth/user/me` | User | Current user |
| POST | `/api/auth/user/forgot-password` | Public | Request password reset OTP |
| POST | `/api/auth/user/verify-reset-otp` | Public | Verify OTP |
| POST | `/api/auth/user/reset-password` | Public | Reset password |
| POST | `/api/partners/login` | Public | Partner login |
| POST | `/api/partners/google-login` | Public | Partner Google login |

### Mobile User Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/mobile/user/register/step1` | Send email OTP |
| POST | `/api/mobile/user/register/step1/verify` | Verify email |
| POST | `/api/mobile/user/register/step2` | Send mobile OTP |
| POST | `/api/mobile/user/register/step2/verify` | Verify mobile |
| POST | `/api/mobile/user/register/step3` | Complete profile |
| POST | `/api/mobile/user/login` | Mobile login |
| GET | `/api/mobile/user/profile` | Get profile |
| PUT | `/api/mobile/user/profile` | Update profile |

### Client API (User Management)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/client/users` | List users |
| GET | `/api/client/users/:userId` | Get user |
| PUT | `/api/client/users/:userId` | Update user (profile triggers astrology refresh) |
| PUT | `/api/client/users/:userId/live-location` | Update live location |
| GET | `/api/client/users/:userId/complete-details` | User + astrology + doshas |

### Chat & WebSocket

| Service | URL | Description |
|---------|-----|-------------|
| REST | `/api/chat/*` | Partners, conversations, messages |
| WebSocket | `ws://host/socket.io/?token=JWT` | Real-time chat (Socket.io) |
| Voice | `ws://host/api/voice/agent` | Voice agent WebSocket |

---

## Environment Setup

Create `.env` in `backend/`:

```env
# Server
PORT=4000
NODE_ENV=development

# MongoDB
MONGODB_URI=mongodb://localhost:27017/brahmakosh

# JWT
JWT_SECRET=your-super-secret-jwt-key-change-in-production

# Super Admin (auto-created on startup)
SUPER_ADMIN_EMAIL=superadmin@brahmakosh.com
SUPER_ADMIN_PASSWORD=YourSecurePassword123

# Astrology API
ASTROLOGY_API_USER_ID=your_id
ASTROLOGY_API_KEY=your_key

# Optional: Google OAuth
GOOGLE_CLIENT_ID=your_google_client_id

# Optional: Firebase (for mobile)
# Firebase service account JSON or config

# Optional: AWS S3 (for uploads)
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=
AWS_BUCKET_NAME=

# Optional: Email (Nodemailer, etc.)
# SMS: Twilio, Gupshup, etc.
```

---

## Running the Project

### Backend

```bash
cd backend
npm install
npm run dev
# Server: http://localhost:4000
# Health: http://localhost:4000/api/health
```

### Frontend

```bash
cd frontend
npm install
npm run dev
# App: http://localhost:5173
```

---

## Key Features

- **Astrology**: Birth details, planets, kundali, doshas, remedies, gemstones, vdasha, chardasha, yogini, sade sati, pitra dosha, panchang, numerology
- **Partner Chat**: Partner list, conversations, real-time messaging, astrology context
- **Spiritual**: Sankalpas, puja padhati, meditations, chantings, spiritual activities, karma points
- **Client Tools**: Testimonials, sponsors, experts, Geeta chapters/shlokas, branding
- **Karma & Rewards**: Spiritual stats, rewards, redemptions

---

## For Developers

1. **Token usage**: Include `Authorization: Bearer <token>` for protected routes.
2. **Role check**: Use `authorize('super_admin', 'admin')` etc. on routes.
3. **User vs Client users**: Web users may have no `clientId`; mobile users always have `clientId`.
4. **Profile updates**: When `profile` (dob, timeOfBirth, lat, lon) changes, astrology data is refreshed in the background.
5. **Partner token**: Use `role: 'partner'` and `partnerId` in JWT for chat WebSocket.

---

*Brahmakosh — Spiritual Wellness Platform*

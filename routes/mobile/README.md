# Mobile API Routes - Profile Section

This folder contains mobile-specific API endpoints for profile management.

## Client Profile Endpoints

Base URL: `/api/mobile/client`

### 1. Client Login
- **Endpoint:** `POST /api/mobile/client/login`
- **Description:** Login for client users (mobile)
- **Request Body:**
  ```json
  {
    "email": "client@example.com",
    "password": "password123"
  }
  ```
- **Response:**
  ```json
  {
    "success": true,
    "message": "Login successful",
    "data": {
      "client": {
        "_id": "...",
        "email": "client@example.com",
        "businessName": "...",
        "businessType": "...",
        "contactNumber": "...",
        "address": "...",
        "role": "client",
        ...
      },
      "token": "jwt_token_here"
    }
  }
  ```

### 2. Client Registration
- **Endpoint:** `POST /api/mobile/client/register`
- **Description:** Register a new client (mobile)
- **Request Body:**
  ```json
  {
    "email": "client@example.com",
    "password": "password123",
    "businessName": "My Business",
    "businessType": "Retail",
    "contactNumber": "1234567890",
    "address": "123 Main St"
  }
  ```
- **Response:**
  ```json
  {
    "success": true,
    "message": "Client registered successfully. Please wait for super admin approval to login.",
    "data": {
      "client": {
        "_id": "...",
        "email": "client@example.com",
        ...
      }
    }
  }
  ```

### 3. Get Client Profile
- **Endpoint:** `GET /api/mobile/client/profile`
- **Description:** Get current client profile (requires authentication)
- **Headers:**
  ```
  Authorization: Bearer <token>
  ```
- **Response:**
  ```json
  {
    "success": true,
    "data": {
      "client": {
        "_id": "...",
        "email": "client@example.com",
        "businessName": "...",
        "businessType": "...",
        "contactNumber": "...",
        "address": "...",
        "role": "client",
        ...
      }
    }
  }
  ```

### 4. Update Client Profile
- **Endpoint:** `PUT /api/mobile/client/profile`
- **Description:** Update client profile (requires authentication)
- **Headers:**
  ```
  Authorization: Bearer <token>
  ```
- **Request Body:**
  ```json
  {
    "businessName": "Updated Business Name",
    "businessType": "Updated Type",
    "contactNumber": "9876543210",
    "address": "456 New St",
    "email": "newemail@example.com",
    "password": "newpassword" // optional
  }
  ```
- **Response:**
  ```json
  {
    "success": true,
    "message": "Profile updated successfully",
    "data": {
      "client": {
        "_id": "...",
        "email": "newemail@example.com",
        ...
      }
    }
  }
  ```

## User Profile Endpoints

Base URL: `/api/mobile/user`

### 1. User Login
- **Endpoint:** `POST /api/mobile/user/login`
- **Description:** Login for user accounts (mobile)
- **Request Body:**
  ```json
  {
    "email": "user@example.com",
    "password": "password123"
  }
  ```
- **Response:**
  ```json
  {
    "success": true,
    "message": "Login successful",
    "data": {
      "user": {
        "_id": "...",
        "email": "user@example.com",
        "profile": {
          "name": "...",
          "dob": "...",
          "placeOfBirth": "...",
          "timeOfBirth": "...",
          "gowthra": "...",
          "profession": "..."
        },
        "role": "user",
        ...
      },
      "token": "jwt_token_here"
    }
  }
  ```

### 2. User Registration
- **Endpoint:** `POST /api/mobile/user/register`
- **Description:** Register a new user (mobile)
- **Request Body:**
  ```json
  {
    "email": "user@example.com",
    "password": "password123",
    "profile": {
      "name": "John Doe",
      "dob": "1990-01-01",
      "placeOfBirth": "City",
      "timeOfBirth": "10:00",
      "gowthra": "Gowthra Name",
      "profession": "student"
    }
  }
  ```
- **Response:**
  ```json
  {
    "success": true,
    "message": "User registered successfully. Please wait for super admin approval to login.",
    "data": {
      "user": {
        "_id": "...",
        "email": "user@example.com",
        "profile": {...},
        ...
      }
    }
  }
  ```

### 3. Get User Profile
- **Endpoint:** `GET /api/mobile/user/profile`
- **Description:** Get current user profile (requires authentication)
- **Headers:**
  ```
  Authorization: Bearer <token>
  ```
- **Response:**
  ```json
  {
    "success": true,
    "data": {
      "user": {
        "_id": "...",
        "email": "user@example.com",
        "profile": {
          "name": "...",
          "dob": "...",
          "placeOfBirth": "...",
          "timeOfBirth": "...",
          "gowthra": "...",
          "profession": "..."
        },
        "clientId": {...}, // populated client info
        "role": "user",
        ...
      }
    }
  }
  ```

### 4. Update User Profile
- **Endpoint:** `PUT /api/mobile/user/profile`
- **Description:** Update user profile (requires authentication)
- **Headers:**
  ```
  Authorization: Bearer <token>
  ```
- **Request Body:**
  ```json
  {
    "email": "newemail@example.com",
    "password": "newpassword", // optional
    "profile": {
      "name": "Updated Name",
      "dob": "1990-01-01",
      "placeOfBirth": "Updated City",
      "timeOfBirth": "11:00",
      "gowthra": "Updated Gowthra",
      "profession": "private job"
    }
  }
  ```
- **Response:**
  ```json
  {
    "success": true,
    "message": "Profile updated successfully",
    "data": {
      "user": {
        "_id": "...",
        "email": "newemail@example.com",
        "profile": {...},
        ...
      }
    }
  }
  ```

## Error Responses

All endpoints may return error responses in the following format:

```json
{
  "success": false,
  "message": "Error message here"
}
```

### Common HTTP Status Codes:
- `400` - Bad Request (missing required fields, validation errors)
- `401` - Unauthorized (invalid credentials, no token, inactive account)
- `403` - Forbidden (login not approved, insufficient permissions)
- `404` - Not Found (user/client not found)
- `500` - Internal Server Error

## Authentication

Protected endpoints require a JWT token in the Authorization header:
```
Authorization: Bearer <your_jwt_token>
```

The token is obtained from the login endpoints and should be included in all subsequent requests.


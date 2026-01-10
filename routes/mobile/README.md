# Mobile User Registration API

This document describes the multi-step registration flow for mobile users.

## Registration Flow Overview

The registration process consists of 3 steps:
1. **Email/Firebase OTP Verification** - Verify user's email address
2. **Mobile OTP Verification** - Verify user's mobile number
3. **Profile Completion** - Collect user details and profile image

## API Endpoints

### Step 1: Email/Firebase OTP Verification

#### Initiate Email OTP
**POST** `/api/mobile/user/register/step1`

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "optional_password" // Optional for Firebase sign-in
}
```

**Response:**
```json
{
  "success": true,
  "message": "OTP sent to your email. Please verify to continue.",
  "data": {
    "email": "user@example.com",
    "registrationStep": 1
  }
}
```

#### Verify Email OTP
**POST** `/api/mobile/user/register/step1/verify`

**Request Body:**
```json
{
  "email": "user@example.com",
  "otp": "123456"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Email verified successfully",
  "data": {
    "email": "user@example.com",
    "registrationStep": 1,
    "nextStep": "mobile_verification"
  }
}
```

#### Resend Email OTP
**POST** `/api/mobile/user/register/resend-email-otp`

**Request Body:**
```json
{
  "email": "user@example.com"
}
```

---

### Step 2: Mobile OTP Verification

#### Initiate Mobile OTP
**POST** `/api/mobile/user/register/step2`

**Request Body:**
```json
{
  "email": "user@example.com",
  "mobile": "+1234567890"
}
```

**Response:**
```json
{
  "success": true,
  "message": "OTP sent to your mobile number. Please verify to continue.",
  "data": {
    "email": "user@example.com",
    "mobile": "+1234567890",
    "registrationStep": 2
  }
}
```

#### Verify Mobile OTP
**POST** `/api/mobile/user/register/step2/verify`

**Request Body:**
```json
{
  "email": "user@example.com",
  "otp": "123456"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Mobile verified successfully",
  "data": {
    "email": "user@example.com",
    "mobile": "+1234567890",
    "registrationStep": 2,
    "nextStep": "profile_completion"
  }
}
```

#### Resend Mobile OTP
**POST** `/api/mobile/user/register/resend-mobile-otp`

**Request Body:**
```json
{
  "email": "user@example.com"
}
```

---

### Step 3: Profile Completion

#### Complete Profile
**POST** `/api/mobile/user/register/step3`

**Request Body:**
```json
{
  "email": "user@example.com",
  "name": "John Doe",
  "dob": "1990-01-15",
  "timeOfBirth": "10:30 AM",
  "placeOfBirth": "New York, USA",
  "gowthra": "Bharadwaja",
  "imageFileName": "profile.jpg", // Optional
  "imageContentType": "image/jpeg" // Optional
}
```

**Response:**
```json
{
  "success": true,
  "message": "Profile completed successfully. Registration complete!",
  "data": {
    "user": {
      "_id": "...",
      "email": "user@example.com",
      "mobile": "+1234567890",
      "profile": {
        "name": "John Doe",
        "dob": "1990-01-15T00:00:00.000Z",
        "timeOfBirth": "10:30 AM",
        "placeOfBirth": "New York, USA",
        "gowthra": "Bharadwaja"
      },
      "registrationStep": 3,
      "role": "user"
    },
    "registrationStep": 3,
    "registrationComplete": true,
    "imageUpload": {
      "presignedUrl": "https://s3.amazonaws.com/...",
      "key": "images/user/.../profile/..."
    }
  }
}
```

**Note:** If `imageFileName` and `imageContentType` are provided, the response will include a `presignedUrl` for uploading the image directly to S3. After receiving the response, upload the image file to the provided `presignedUrl` using a PUT request.

---

## Login

**POST** `/api/mobile/user/login`

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "userpassword"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "user": {
      "_id": "...",
      "email": "user@example.com",
      "role": "user",
      ...
    },
    "token": "jwt_token_here"
  }
}
```

**Note:** Users can only login after completing all 3 registration steps.

---

## Profile Management

### Get Profile
**GET** `/api/mobile/user/profile`

**Headers:**
```
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "_id": "...",
      "email": "user@example.com",
      "mobile": "+1234567890",
      "profile": {...},
      "profileImageUrl": "https://s3.amazonaws.com/...",
      "role": "user"
    }
  }
}
```

### Update Profile
**PUT** `/api/mobile/user/profile`

**Headers:**
```
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "name": "Updated Name",
  "dob": "1990-01-15",
  "timeOfBirth": "10:30 AM",
  "placeOfBirth": "New York, USA",
  "gowthra": "Bharadwaja",
  "imageFileName": "new-profile.jpg", // Optional
  "imageContentType": "image/jpeg" // Optional
}
```

---

## Error Responses

All endpoints return errors in the following format:

```json
{
  "success": false,
  "message": "Error message here"
}
```

Common HTTP status codes:
- `400` - Bad Request (missing/invalid parameters)
- `401` - Unauthorized (invalid credentials/token)
- `403` - Forbidden (insufficient permissions)
- `404` - Not Found (user/resource not found)
- `500` - Internal Server Error

---

## Registration Flow Diagram

```
1. POST /register/step1
   ↓
   [OTP sent to email]
   ↓
2. POST /register/step1/verify
   ↓
   [Email verified]
   ↓
3. POST /register/step2
   ↓
   [OTP sent to mobile]
   ↓
4. POST /register/step2/verify
   ↓
   [Mobile verified]
   ↓
5. POST /register/step3
   ↓
   [Profile completed]
   ↓
6. POST /login
   [User can now login]
```

---

## OTP Configuration

OTPs are valid for **10 minutes**. To integrate actual email/SMS sending:

1. **Email OTP**: Update `backend/utils/otp.js` - `sendEmailOTP()` function
   - Recommended services: Nodemailer, SendGrid, AWS SES

2. **Mobile OTP**: Update `backend/utils/otp.js` - `sendMobileOTP()` function
   - Recommended services: Twilio, AWS SNS, MessageBird

Currently, OTPs are logged to console for development purposes.

---

## Notes

- Users can register and login directly without admin approval
- Email and mobile numbers must be unique
- Profile image is stored in S3 and accessed via presigned URLs
- All OTP fields are automatically cleared after successful verification
- Registration step is tracked to ensure users complete all steps in order

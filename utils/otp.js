/**
 * OTP Utility Service
 * Handles generation, validation, and expiration of OTPs for email and mobile verification
 */

import nodemailer from 'nodemailer';
import twilio from 'twilio';
import axios from 'axios';
import dotenv from 'dotenv';
import OTP from '../models/OTP.js';

dotenv.config();

// Generate a random 6-digit OTP
export const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Set OTP expiry time (10 minutes from now)
export const getOTPExpiry = () => {
  return new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
};

// Check if OTP is expired
export const isOTPExpired = (expiryDate) => {
  return new Date() > new Date(expiryDate);
};

// Validate OTP
export const validateOTP = (storedOTP, providedOTP, expiryDate) => {
  if (!storedOTP || !providedOTP) {
    return { valid: false, message: 'OTP is required' };
  }
  
  if (isOTPExpired(expiryDate)) {
    return { valid: false, message: 'OTP has expired. Please request a new one.' };
  }
  
  if (storedOTP !== providedOTP) {
    return { valid: false, message: 'Invalid OTP. Please try again.' };
  }
  
  return { valid: true, message: 'OTP is valid' };
};

// Create nodemailer transporter
const createEmailTransporter = () => {
  const emailService = process.env.EMAIL_SERVICE || 'gmail'; // gmail, outlook, yahoo, custom
  
  // Common connection options for cloud environments
  // Increased timeouts for cloud environments like Render
  const connectionOptions = {
    connectionTimeout: parseInt(process.env.SMTP_CONNECTION_TIMEOUT || '120000'), // 120 seconds (increased)
    greetingTimeout: parseInt(process.env.SMTP_GREETING_TIMEOUT || '60000'), // 60 seconds (increased)
    socketTimeout: parseInt(process.env.SMTP_SOCKET_TIMEOUT || '120000'), // 120 seconds (increased)
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD
    },
    // Pool connections for better performance in cloud environments
    pool: process.env.SMTP_POOL === 'true',
    maxConnections: parseInt(process.env.SMTP_MAX_CONNECTIONS || '5'),
    maxMessages: parseInt(process.env.SMTP_MAX_MESSAGES || '100')
  };

  // For Gmail - use explicit SMTP configuration for better cloud compatibility
  if (emailService.toLowerCase() === 'gmail') {
    const port = parseInt(process.env.SMTP_PORT || '587');
    const useSSL = port === 465 || process.env.SMTP_SECURE === 'true';
    
    return nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: port,
      secure: useSSL, // true for 465, false for 587
      requireTLS: !useSSL, // Only require TLS if not using SSL
      ...connectionOptions,
      tls: {
        rejectUnauthorized: process.env.SMTP_REJECT_UNAUTHORIZED !== 'false',
        minVersion: 'TLSv1.2'
      }
    });
  }
  
  // For Outlook/Hotmail
  if (emailService.toLowerCase() === 'outlook') {
    return nodemailer.createTransport({
      host: 'smtp-mail.outlook.com',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: false,
      requireTLS: true,
      ...connectionOptions,
      tls: {
        rejectUnauthorized: process.env.SMTP_REJECT_UNAUTHORIZED !== 'false'
      }
    });
  }
  
  // For Yahoo
  if (emailService.toLowerCase() === 'yahoo') {
    return nodemailer.createTransport({
      host: 'smtp.mail.yahoo.com',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: false,
      requireTLS: true,
      ...connectionOptions,
      tls: {
        rejectUnauthorized: process.env.SMTP_REJECT_UNAUTHORIZED !== 'false'
      }
    });
  }
  
  // For custom SMTP servers
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
    requireTLS: process.env.SMTP_REQUIRE_TLS === 'true',
    ...connectionOptions,
    tls: {
      rejectUnauthorized: process.env.SMTP_REJECT_UNAUTHORIZED !== 'false'
    }
  });
};

// Send email OTP using Brevo (Sendinblue) API (recommended for cloud environments)
const sendEmailViaBrevo = async (email, otp) => {
  const BREVO_API_KEY = process.env.BREVO_API_KEY;
  const BREVO_FROM_EMAIL = process.env.BREVO_FROM_EMAIL || process.env.EMAIL_FROM || process.env.EMAIL_USER;
  const BREVO_FROM_NAME = process.env.BREVO_FROM_NAME || process.env.APP_NAME || 'Brahmakosh';
  const appName = process.env.APP_NAME || 'Brahmakosh';

  if (!BREVO_API_KEY) {
    throw new Error('Brevo API key not configured');
  }

  const url = 'https://api.brevo.com/v3/smtp/email';
  const headers = {
    'api-key': BREVO_API_KEY,
    'Content-Type': 'application/json'
  };

  const emailHtml = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #333;">OTP Verification</h2>
      <p>Hello,</p>
      <p>Your OTP for ${appName} registration is:</p>
      <div style="background-color: #f4f4f4; padding: 20px; text-align: center; margin: 20px 0;">
        <h1 style="color: #007bff; font-size: 32px; margin: 0; letter-spacing: 5px;">${otp}</h1>
      </div>
      <p>This OTP will expire in <strong>10 minutes</strong>.</p>
      <p>If you didn't request this OTP, please ignore this email.</p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
      <p style="color: #999; font-size: 12px;">This is an automated message. Please do not reply.</p>
    </div>
  `;

  const data = {
    sender: {
      name: BREVO_FROM_NAME,
      email: BREVO_FROM_EMAIL
    },
    to: [
      {
        email: email
      }
    ],
    subject: `Your OTP for ${appName} Registration`,
    htmlContent: emailHtml,
    textContent: `Your OTP for ${appName} registration is: ${otp}. This OTP will expire in 10 minutes.`
  };

  const response = await axios.post(url, data, { headers });
  return response.data;
};

// Send email OTP using SendGrid API (alternative option)
const sendEmailViaSendGrid = async (email, otp) => {
  const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
  const SENDGRID_FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || process.env.EMAIL_FROM || process.env.EMAIL_USER;
  const appName = process.env.APP_NAME || 'Brahmakosh';

  if (!SENDGRID_API_KEY) {
    throw new Error('SendGrid API key not configured');
  }

  const url = 'https://api.sendgrid.com/v3/mail/send';
  const headers = {
    'Authorization': `Bearer ${SENDGRID_API_KEY}`,
    'Content-Type': 'application/json'
  };

  const data = {
    personalizations: [{
      to: [{ email: email }],
      subject: `Your OTP for ${appName} Registration`
    }],
    from: {
      email: SENDGRID_FROM_EMAIL,
      name: appName
    },
    content: [
      {
        type: 'text/html',
        value: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">OTP Verification</h2>
            <p>Hello,</p>
            <p>Your OTP for ${appName} registration is:</p>
            <div style="background-color: #f4f4f4; padding: 20px; text-align: center; margin: 20px 0;">
              <h1 style="color: #007bff; font-size: 32px; margin: 0; letter-spacing: 5px;">${otp}</h1>
            </div>
            <p>This OTP will expire in <strong>10 minutes</strong>.</p>
            <p>If you didn't request this OTP, please ignore this email.</p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
            <p style="color: #999; font-size: 12px;">This is an automated message. Please do not reply.</p>
          </div>
        `
      }
    ]
  };

  const response = await axios.post(url, data, { headers });
  return response.data;
};

// Send email OTP using nodemailer
export const sendEmailOTP = async (email, otp) => {
  try {
    // Check if email service is enabled
    if (process.env.EMAIL_ENABLED !== 'true') {
      console.log(`📧 Email OTP for ${email}: ${otp} (Email service disabled - check console)`);
      return { success: true, message: 'OTP sent to email (logged to console)' };
    }

    // Try Brevo (Sendinblue) first if configured (recommended for cloud environments like Render)
    if (process.env.USE_BREVO === 'true' || process.env.BREVO_API_KEY) {
      try {
        const result = await sendEmailViaBrevo(email, otp);
        console.log(`✅ Email OTP sent via Brevo to ${email}. Message ID: ${result.messageId || 'N/A'}`);
        
        // Mark old unverified OTPs as used (allow unlimited retries if not verified)
        await OTP.updateMany(
          { email, type: 'email', isUsed: false },
          { $set: { isUsed: true } }
        );
        
        // Save new OTP to database
        const expiresAt = getOTPExpiry();
        await OTP.create({
          email,
          otp,
          expiresAt,
          type: 'email',
          client: 'brahmakosh'
        });
        
        return { success: true, message: 'OTP sent to email via Brevo', messageId: result.messageId };
      } catch (brevoError) {
        console.error('Brevo error:', brevoError.response?.data || brevoError.message);
        // Fall back to other services if Brevo fails
        console.log('⚠️ Brevo failed, trying alternatives...');
      }
    }

    // Try SendGrid as alternative if configured
    if (process.env.USE_SENDGRID === 'true' || process.env.SENDGRID_API_KEY) {
      try {
        const result = await sendEmailViaSendGrid(email, otp);
        console.log(`✅ Email OTP sent via SendGrid to ${email}`);
        
        // Mark old unverified OTPs as used (allow unlimited retries if not verified)
        await OTP.updateMany(
          { email, type: 'email', isUsed: false },
          { $set: { isUsed: true } }
        );
        
        // Save new OTP to database
        const expiresAt = getOTPExpiry();
        await OTP.create({
          email,
          otp,
          expiresAt,
          type: 'email',
          client: 'brahmakosh'
        });
        
        return { success: true, message: 'OTP sent to email via SendGrid' };
      } catch (sendGridError) {
        console.error('SendGrid error:', sendGridError.response?.data || sendGridError.message);
        // Fall back to SMTP if SendGrid fails
        console.log('⚠️ SendGrid failed, falling back to SMTP...');
      }
    }

    // Validate required environment variables for SMTP
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
      console.error('Email configuration missing. Please set EMAIL_USER and EMAIL_PASSWORD in .env');
      console.error('💡 TIP: For cloud deployments (Render, Heroku), use SendGrid instead:');
      console.error('   Set USE_SENDGRID=true and SENDGRID_API_KEY=your-api-key');
      console.log(`📧 Email OTP for ${email}: ${otp} (Email not configured - check console)`);
      return { success: true, message: 'OTP logged to console (email not configured)' };
    }

    const transporter = createEmailTransporter();
    
    // Optionally verify connection (can be disabled for faster sends)
    if (process.env.SMTP_VERIFY_CONNECTION === 'true') {
      try {
        await transporter.verify();
        console.log('✅ SMTP server connection verified');
      } catch (verifyError) {
        console.warn('⚠️ SMTP verification failed, but attempting to send anyway:', verifyError.message);
        // Continue anyway - sometimes verification fails but sending works
      }
    }
    
    const emailFrom = process.env.EMAIL_FROM || process.env.EMAIL_USER;
    const appName = process.env.APP_NAME || 'Brahmakosh';

    const mailOptions = {
      from: `"${appName}" <${emailFrom}>`,
      to: email,
      subject: `Your OTP for ${appName} Registration`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">OTP Verification</h2>
          <p>Hello,</p>
          <p>Your OTP for ${appName} registration is:</p>
          <div style="background-color: #f4f4f4; padding: 20px; text-align: center; margin: 20px 0;">
            <h1 style="color: #007bff; font-size: 32px; margin: 0; letter-spacing: 5px;">${otp}</h1>
          </div>
          <p>This OTP will expire in <strong>10 minutes</strong>.</p>
          <p>If you didn't request this OTP, please ignore this email.</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
          <p style="color: #999; font-size: 12px;">This is an automated message. Please do not reply.</p>
        </div>
      `,
      text: `Your OTP for ${appName} registration is: ${otp}. This OTP will expire in 10 minutes.`
    };

    // Retry logic with port fallback for cloud environments
    const maxRetries = parseInt(process.env.SMTP_MAX_RETRIES || '3');
    const emailService = process.env.EMAIL_SERVICE || 'gmail';
    let info;
    let currentTransporter = transporter;
    let triedPort465 = false;
    const originalPort = parseInt(process.env.SMTP_PORT || '587');
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        info = await currentTransporter.sendMail(mailOptions);
        if (attempt > 0) {
          console.log(`✅ Email sent successfully on attempt ${attempt + 1}${triedPort465 ? ' (using port 465)' : ''}`);
        }
        break; // Success, exit retry loop
      } catch (sendError) {
        const isTimeoutError = sendError.code === 'ETIMEDOUT' || 
                               sendError.code === 'ECONNRESET' || 
                               sendError.code === 'ESOCKETTIMEDOUT' ||
                               sendError.code === 'ECONNREFUSED' ||
                               sendError.message?.includes('timeout') ||
                               sendError.message?.includes('Connection');
        
        // Try port 465 (SSL) as fallback if port 587 fails (common in cloud environments)
        if (attempt === 1 && isTimeoutError && emailService.toLowerCase() === 'gmail' && originalPort === 587 && !triedPort465) {
          console.warn(`⚠️ Port 587 failed, trying port 465 (SSL) as fallback...`);
          triedPort465 = true;
          try {
            currentTransporter.close();
          } catch (closeError) {
            // Ignore close errors
          }
          // Create transporter with port 465
          currentTransporter = nodemailer.createTransport({
            host: 'smtp.gmail.com',
            port: 465,
            secure: true, // SSL required for port 465
            auth: {
              user: process.env.EMAIL_USER,
              pass: process.env.EMAIL_PASSWORD
            },
            connectionTimeout: parseInt(process.env.SMTP_CONNECTION_TIMEOUT || '120000'),
            greetingTimeout: parseInt(process.env.SMTP_GREETING_TIMEOUT || '60000'),
            socketTimeout: parseInt(process.env.SMTP_SOCKET_TIMEOUT || '120000'),
            tls: {
              rejectUnauthorized: process.env.SMTP_REJECT_UNAUTHORIZED !== 'false',
              minVersion: 'TLSv1.2'
            }
          });
          continue; // Retry immediately with new port
        }
        
        if (attempt < maxRetries && isTimeoutError) {
          const delay = (attempt + 1) * 2000; // Exponential backoff: 2s, 4s, 6s
          console.warn(`⚠️ Email send attempt ${attempt + 1} failed (${sendError.code || sendError.message}), retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          // Create a new transporter for retry (helps with connection issues)
          try {
            currentTransporter.close(); // Close old connection if possible
          } catch (closeError) {
            // Ignore close errors
          }
          currentTransporter = createEmailTransporter();
        } else {
          throw sendError; // Not a retryable error or max retries reached
        }
      }
    }
    console.log(`✅ Email OTP sent to ${email}. Message ID: ${info.messageId}`);
    
    // Save OTP to database
    const expiresAt = getOTPExpiry();
    await OTP.create({
      email,
      otp,
      expiresAt,
      type: 'email',
      client: 'brahmakosh'
    });
    
    return { success: true, message: 'OTP sent to email', messageId: info.messageId };
  } catch (error) {
    console.error('Error sending email OTP:', error);
    
    // Check if it's a connection timeout (common in cloud environments)
    const isConnectionError = error.code === 'ETIMEDOUT' || 
                             error.code === 'ECONNREFUSED' || 
                             error.code === 'ECONNRESET' ||
                             error.message?.includes('timeout') ||
                             error.message?.includes('Connection');
    
    if (isConnectionError) {
      console.error('❌ SMTP connection failed. This is common in cloud environments like Render.');
      console.error('💡 SOLUTION: Use Brevo (HTTP API) instead of SMTP:');
      console.error('   1. Sign up at https://www.brevo.com (free tier: 300 emails/day)');
      console.error('   2. Create API Key in Brevo dashboard (Settings → API Keys)');
      console.error('   3. Verify your sender email in Brevo');
      console.error('   4. Set in Render environment variables:');
      console.error('      USE_BREVO=true');
      console.error('      BREVO_API_KEY=your-api-key');
      console.error('      BREVO_FROM_EMAIL=your-verified-email@domain.com');
      console.error('   Alternative: Use SendGrid with USE_SENDGRID=true');
    }
    
    // Fallback: log to console if email fails
    console.log(`📧 Email OTP for ${email}: ${otp} (Email failed - check console)`);
    
    // In development, don't throw error, just log
    if (process.env.NODE_ENV === 'development') {
      return { success: true, message: 'OTP logged to console (email service error)' };
    }
    
    throw new Error('Failed to send email OTP');
  }
};

// Send WhatsApp OTP using Facebook Graph API
const sendWhatsAppTemplateOtp = async ({ to, otp }) => {
  const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
  const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;
  const GRAPH_VERSION = process.env.GRAPH_VERSION || 'v20.0';

  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID) {
    throw new Error('WhatsApp API credentials are not configured');
  }

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${WHATSAPP_PHONE_ID}/messages`;
  const headers = {
    Authorization: `Bearer ${WHATSAPP_TOKEN}`,
    'Content-Type': 'application/json',
  };

  const data = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: process.env.WHATSAPP_TEMPLATE_NAME || 'otp_verification',
      language: { code: process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en_US' },
      components: [
        {
          type: 'body',
          parameters: [
            {
              type: 'text',
              text: otp,
            },
          ],
        },
        {
          type: 'button',
          sub_type: 'url',
          index: '0',
          parameters: [
            {
              type: 'text',
              text: otp,
            },
          ],
        },
      ],
    },
  };

  const response = await axios.post(url, data, { headers });
  return response.data;
};

// Create Twilio client for SMS
const createTwilioClient = () => {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    return null;
  }
  return twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
};

// Send mobile OTP via SMS (Twilio) or WhatsApp (Facebook API)
export const sendMobileOTP = async (mobile, otp) => {
  try {
    const useWhatsApp = process.env.USE_WHATSAPP === 'true';
    const useSMS = process.env.USE_SMS === 'true' || !useWhatsApp;
    
    // Check if SMS/WhatsApp service is enabled
    if (process.env.SMS_ENABLED !== 'true' && process.env.WHATSAPP_ENABLED !== 'true') {
      console.log(`📱 Mobile OTP for ${mobile}: ${otp} (SMS/WhatsApp service disabled - check console)`);
      return { success: true, message: 'OTP sent to mobile (logged to console)' };
    }

    const appName = process.env.APP_NAME || 'Brahmakosh';
    const expiresAt = getOTPExpiry();

    // Normalize mobile number (remove whatsapp: prefix if present for storage)
    const normalizedMobile = mobile.replace(/^whatsapp:/, '');

    if (useWhatsApp && process.env.WHATSAPP_ENABLED === 'true') {
      // Send via Facebook WhatsApp Business API
      if (!process.env.WHATSAPP_TOKEN || !process.env.WHATSAPP_PHONE_ID) {
        console.error('WhatsApp configuration missing. Please set WHATSAPP_TOKEN and WHATSAPP_PHONE_ID in .env');
        console.log(`📱 Mobile OTP for ${mobile}: ${otp} (WhatsApp not configured - check console)`);
        return { success: true, message: 'OTP logged to console (WhatsApp not configured)' };
      }

      try {
        // Ensure mobile number has country code and no whatsapp: prefix for API call
        const whatsappTo = normalizedMobile.startsWith('+') ? normalizedMobile : `+${normalizedMobile}`;
        
        const result = await sendWhatsAppTemplateOtp({ to: whatsappTo, otp });
        
        console.log(`✅ WhatsApp OTP sent to ${whatsappTo}. Message ID: ${result.messages?.[0]?.id || 'N/A'}`);
        
      // Mark old unverified OTPs as used (allow unlimited retries if not verified)
      await OTP.updateMany(
        { mobile: normalizedMobile, type: { $in: ['whatsapp', 'sms', 'mobile'] }, isUsed: false },
        { $set: { isUsed: true } }
      );
      
      // Save new OTP to database
      await OTP.create({
        mobile: normalizedMobile,
        otp,
        expiresAt,
        type: 'whatsapp',
        client: 'brahmakosh'
      });
        
        return { 
          success: true, 
          message: 'OTP sent via WhatsApp', 
          messageId: result.messages?.[0]?.id 
        };
      } catch (error) {
        console.error('WhatsApp API error:', error.response?.data || error.message);
        throw error;
      }
    } else if (useSMS && process.env.SMS_ENABLED === 'true') {
      // Send via Twilio SMS
      if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
        console.error('Twilio configuration missing. Please set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in .env');
        console.log(`📱 Mobile OTP for ${mobile}: ${otp} (SMS not configured - check console)`);
        return { success: true, message: 'OTP logged to console (SMS not configured)' };
      }

      if (!process.env.TWILIO_PHONE_NUMBER) {
        throw new Error('TWILIO_PHONE_NUMBER is required for SMS');
      }

      const client = createTwilioClient();
      if (!client) {
        throw new Error('Twilio client not initialized');
      }

      const messageBody = `Your ${appName} OTP is: ${otp}. Valid for 10 minutes.`;
      
      const message = await client.messages.create({
        body: messageBody,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: normalizedMobile
      });
      
      console.log(`✅ SMS OTP sent to ${normalizedMobile}. Message SID: ${message.sid}`);
      
      // Mark old unverified OTPs as used (allow unlimited retries if not verified)
      await OTP.updateMany(
        { mobile: normalizedMobile, type: { $in: ['whatsapp', 'sms', 'mobile'] }, isUsed: false },
        { $set: { isUsed: true } }
      );
      
      // Save new OTP to database
      await OTP.create({
        mobile: normalizedMobile,
        otp,
        expiresAt,
        type: 'sms',
        client: 'brahmakosh'
      });
      
      return { success: true, message: 'OTP sent via SMS', messageSid: message.sid };
    } else {
      // Fallback: log to console
      console.log(`📱 Mobile OTP for ${mobile}: ${otp} (SMS/WhatsApp not enabled - check console)`);
      return { success: true, message: 'OTP logged to console' };
    }
  } catch (error) {
    console.error('Error sending mobile OTP:', error);
    
    // Fallback: log to console if SMS/WhatsApp fails
    console.log(`📱 Mobile OTP for ${mobile}: ${otp} (SMS/WhatsApp failed - check console)`);
    
    // In development, don't throw error, just log
    if (process.env.NODE_ENV === 'development') {
      return { success: true, message: 'OTP logged to console (SMS/WhatsApp service error)' };
    }
    
    throw new Error('Failed to send mobile OTP');
  }
};

// Verify OTP from database (alternative method)
export const verifyOTPFromDB = async (mobile, otp, type = 'mobile') => {
  try {
    const normalizedMobile = mobile.replace(/^whatsapp:/, '');
    
    const record = await OTP.findOne({ 
      mobile: normalizedMobile, 
      otp, 
      type: type === 'mobile' ? { $in: ['whatsapp', 'sms', 'mobile'] } : type,
      isUsed: false 
    });
    
    if (!record) {
      return { valid: false, message: 'Invalid OTP' };
    }

    if (new Date(record.expiresAt).getTime() < Date.now()) {
      return { valid: false, message: 'OTP expired' };
    }

    // Mark as used
    record.isUsed = true;
    await record.save();

    return { valid: true, message: 'OTP verified successfully' };
  } catch (error) {
    console.error('Error verifying OTP from DB:', error);
    return { valid: false, message: 'OTP verification failed' };
  }
};

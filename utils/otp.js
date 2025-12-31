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
  
  // For Gmail, Outlook, Yahoo - use OAuth2 or App Password
  if (['gmail', 'outlook', 'yahoo'].includes(emailService.toLowerCase())) {
    return nodemailer.createTransport({
      service: emailService,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD // Use App Password for Gmail
      }
    });
  }
  
  // For custom SMTP servers
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD
    },
    tls: {
      rejectUnauthorized: process.env.SMTP_REJECT_UNAUTHORIZED !== 'false'
    }
  });
};

// Send email OTP using nodemailer
export const sendEmailOTP = async (email, otp) => {
  try {
    // Check if email service is enabled
    if (process.env.EMAIL_ENABLED !== 'true') {
      console.log(`📧 Email OTP for ${email}: ${otp} (Email service disabled - check console)`);
      return { success: true, message: 'OTP sent to email (logged to console)' };
    }

    // Validate required environment variables
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
      console.error('Email configuration missing. Please set EMAIL_USER and EMAIL_PASSWORD in .env');
      console.log(`📧 Email OTP for ${email}: ${otp} (Email not configured - check console)`);
      return { success: true, message: 'OTP logged to console (email not configured)' };
    }

    const transporter = createEmailTransporter();
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

    const info = await transporter.sendMail(mailOptions);
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
        
        // Save OTP to database
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
      
      // Save OTP to database
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

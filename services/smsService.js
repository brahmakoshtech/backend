import axios from 'axios';

const sendSMS = async (mobile, message) => {
  try {
    if (!mobile || !message) {
      throw new Error('Mobile number and message are required');
    }

    // Remove +91 if present and ensure 10 digits
    const cleanMobile = mobile.replace(/^\+91/, '').replace(/\D/g, '');
    
    if (cleanMobile.length !== 10) {
      throw new Error('Invalid mobile number format');
    }

    const userId = process.env.GUPSHUP_USERID;
    const password = process.env.GUPSHUP_PASSWORD;
    const mask = process.env.MASK || 'MOBISL';
    const principalEntityId = process.env.PRINCIPAL_ENTITY_ID;

    if (!userId || !password) {
      console.error('[SMS Service] Gupshup credentials not configured');
      return { success: false, error: 'SMS service not configured' };
    }

    const url = 'https://enterprise.smsgupshup.com/GatewayAPI/rest';
    
    const params = {
      method: 'SendMessage',
      send_to: cleanMobile,
      msg: message,
      msg_type: 'TEXT',
      userid: userId,
      auth_scheme: 'plain',
      password: password,
      v: '1.1',
      format: 'text',
      mask: mask,
      principalEntityId: principalEntityId
    };

    console.log('[SMS Service] Sending SMS to:', cleanMobile);

    const response = await axios.get(url, { params, timeout: 10000 });

    if (response.data && response.data.includes('success')) {
      console.log('[SMS Service] SMS sent successfully to:', cleanMobile);
      return { success: true, response: response.data };
    } else {
      console.error('[SMS Service] SMS failed:', response.data);
      return { success: false, error: response.data };
    }
  } catch (error) {
    console.error('[SMS Service] Error sending SMS:', error.message);
    return { success: false, error: error.message };
  }
};

export default { sendSMS };

import User from '../models/User.js';
import Partner from '../models/Partner.js';

const normalizeEmail = (email) => (email || '').trim().toLowerCase();
const normalizePhone = (phone) => (phone || '').replace(/\D/g, '');

export async function emailUsedByOtherAccountType(email, registeringAs) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;

  if (registeringAs === 'partner') {
    const user = await User.findOne({ email: normalized }).select('_id email').lean();
    if (user) {
      return 'This email is already registered as a user account. User and expert accounts must use different email addresses.';
    }
  } else if (registeringAs === 'user') {
    const partner = await Partner.findOne({ email: normalized }).select('_id email').lean();
    if (partner) {
      return 'This email is already registered as an expert account. User and expert accounts must use different email addresses.';
    }
  }
  return null;
}

export async function phoneUsedByOtherAccountType(phone, clientId, registeringAs) {
  const normalized = normalizePhone(phone);
  if (!normalized || normalized.length < 10) return null;

  if (registeringAs === 'partner') {
    const user = await User.findOne({ clientId, phone: normalized }).select('_id phone').lean();
    if (user) {
      return 'This mobile number is already registered as a user account. User and expert accounts must use different mobile numbers.';
    }
  } else if (registeringAs === 'user') {
    const partner = await Partner.findOne({ clientId, phone: normalized }).select('_id phone').lean();
    if (partner) {
      return 'This mobile number is already registered as an expert account. User and expert accounts must use different mobile numbers.';
    }
  }
  return null;
}

export async function validateUserPartnerNotSameContact(userId, partnerId) {
  const [user, partner] = await Promise.all([
    User.findById(userId).select('email phone profile.name').lean(),
    Partner.findById(partnerId).select('email phone name').lean()
  ]);

  if (!user || !partner) return null;

  const userEmail = normalizeEmail(user.email);
  const partnerEmail = normalizeEmail(partner.email);
  const userPhone = normalizePhone(user.phone);
  const partnerPhone = normalizePhone(partner.phone);

  if (userEmail && partnerEmail && userEmail === partnerEmail) {
    return 'Cannot connect: user and expert accounts share the same email. Please use different email addresses for each account type.';
  }

  if (userPhone && partnerPhone && userPhone === partnerPhone) {
    return 'Cannot connect: user and expert accounts share the same mobile number. Please use different numbers for each account type.';
  }

  return null;
}

export function getUserDisplayName(user) {
  if (!user) return 'User';
  return user.profile?.name || user.name || user.email || 'User';
}

export function getPartnerDisplayName(partner) {
  if (!partner) return 'Expert';
  return partner.name || partner.email || 'Expert';
}

// src/services/doshaService.js
// Fetches all Indian Astrology Dosha APIs and combines results

import axios from 'axios';

const DOSHA_ENDPOINTS = {
  kalsarpa: '/kalsarpa_details',
  manglik: '/manglik',
  pitra: '/pitra_dosha',
  sadeSati: '/sade_sati',
  shani: '/shani_dosha',
  gandmool: '/gandmool_dosha'
};

class DoshaService {
  constructor() {
    this.baseUrl = process.env.ASTROLOGY_API_BASE_URL || 'https://json.astrologyapi.com/v1';
    this.apiUserId = process.env.ASTROLOGY_API_USER_ID;
    this.apiKey = process.env.ASTROLOGY_API_KEY;

    this.apiClient = axios.create({
      baseURL: this.baseUrl,
      headers: { 'Content-Type': 'application/json' },
      auth: {
        username: this.apiUserId,
        password: this.apiKey
      },
      timeout: 30000
    });
  }

  /**
   * Prepare birth data for Dosha APIs from user profile
   * Uses: profile.dob, profile.timeOfBirth, liveLocation.latitude, liveLocation.longitude
   */
  prepareBirthData(user) {
    const profile = user.profile || {};
    const liveLocation = user.liveLocation || {};
    const dob = profile.dob;

    if (!dob) {
      throw new Error('User profile must have date of birth (dob)');
    }

    const birthDate = new Date(dob);
    if (isNaN(birthDate.getTime())) {
      throw new Error('Invalid date of birth');
    }

    const lat = liveLocation.latitude ?? profile.latitude ?? 28.6139;
    const lon = liveLocation.longitude ?? profile.longitude ?? 77.209;

    let hour = 12;
    let minute = 30;
    const timeStr = (profile.timeOfBirth || '12:30').toString().trim();
    if (timeStr) {
      if (timeStr.includes('AM') || timeStr.includes('PM')) {
        const [time, period] = timeStr.split(' ');
        const [h, m] = (time || '12:30').split(':').map(Number);
        hour = h || 12;
        minute = m || 30;
        if (period === 'PM' && hour !== 12) hour += 12;
        else if (period === 'AM' && hour === 12) hour = 0;
      } else {
        [hour, minute] = timeStr.split(':').map(Number);
        hour = hour ?? 12;
        minute = minute ?? 30;
      }
    }

    return {
      day: birthDate.getDate(),
      month: birthDate.getMonth() + 1,
      year: birthDate.getFullYear(),
      hour,
      min: minute,
      lat: parseFloat(lat),
      lon: parseFloat(lon),
      tzone: 5.5
    };
  }

  /**
   * Call a single dosha API
   */
  async fetchDosha(name, birthData) {
    const endpoint = DOSHA_ENDPOINTS[name];
    if (!endpoint) return { error: `Unknown dosha: ${name}` };

    try {
      const response = await this.apiClient.post(endpoint, birthData);
      return { success: true, data: response.data };
    } catch (error) {
      console.error(`[Dosha Service] ${name} error:`, error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.message || error.message,
        data: null
      };
    }
  }

  /**
   * Get all dosha data for a user (from User model)
   * Fetches from all 6 APIs in parallel
   */
  async getAllDoshas(user) {
    const birthData = this.prepareBirthData(user);

    const results = await Promise.all([
      this.fetchDosha('kalsarpa', birthData),
      this.fetchDosha('manglik', birthData),
      this.fetchDosha('pitra', birthData),
      this.fetchDosha('sadeSati', birthData),
      this.fetchDosha('shani', birthData),
      this.fetchDosha('gandmool', birthData)
    ]);

    const [kalsarpa, manglik, pitra, sadeSati, shani, gandmool] = results;

    const doshas = {
      kalsarpa: kalsarpa.success && kalsarpa.data ? this.normalizeKalsarpa(kalsarpa.data) : { present: false, error: kalsarpa.error },
      manglik: manglik.success && manglik.data ? this.normalizeManglik(manglik.data) : { present: false, error: manglik.error },
      pitra: pitra.success && pitra.data ? this.normalizePitra(pitra.data) : { present: false, error: pitra.error },
      sadeSati: sadeSati.success && sadeSati.data ? this.normalizeSadeSati(sadeSati.data) : { present: false, error: sadeSati.error },
      shani: shani.success && shani.data ? this.normalizeShani(shani.data) : { present: false, error: shani.error },
      gandmool: gandmool.success && gandmool.data ? this.normalizeGandmool(gandmool.data) : { present: false, error: gandmool.error }
    };

    const summary = {
      kalsarpa: doshas.kalsarpa.present,
      manglik: doshas.manglik.present,
      pitra: doshas.pitra.present,
      sadeSati: doshas.sadeSati.present,
      shani: doshas.shani.present,
      gandmool: doshas.gandmool.present,
      anyPresent: Object.values(doshas).some(d => d && d.present)
    };

    return {
      birthData: {
        day: birthData.day,
        month: birthData.month,
        year: birthData.year,
        hour: birthData.hour,
        min: birthData.min,
        lat: birthData.lat,
        lon: birthData.lon,
        tzone: birthData.tzone
      },
      doshas,
      summary
    };
  }

  normalizeKalsarpa(data) {
    const present = !!(data?.kalsarpa_present || data?.kalsarpa_status);
    return {
      present,
      status: data?.kalsarpa_status || data?.status || null,
      type: data?.kalsarpa_type || data?.type || null,
      description: data?.description || data?.remedy || null,
      raw: data
    };
  }

  normalizeManglik(data) {
    const present = !!(data?.manglik_present || (data?.manglik_status && data.manglik_status !== 'Non-Manglik'));
    return {
      present,
      status: data?.manglik_status || null,
      percentage: data?.percentage ?? null,
      description: data?.description || null,
      raw: data
    };
  }

  normalizePitra(data) {
    const present = !!(data?.present || data?.pitra_present);
    return {
      present,
      oneLine: data?.one_line || data?.oneLine || null,
      description: data?.description || null,
      raw: data
    };
  }

  normalizeSadeSati(data) {
    const status = data?.sadhesati_status || data?.sade_sati_status || data?.status;
    const present = !!(status && (status.includes('Under') || status.includes('undergoing')));
    return {
      present,
      status,
      considerationDate: data?.consideration_date || null,
      isUndergoing: data?.is_undergoing ?? present,
      raw: data
    };
  }

  normalizeShani(data) {
    const present = !!(data?.shani_dosha_present || data?.present || data?.dosha_present);
    return {
      present,
      status: data?.status || data?.shani_status || null,
      description: data?.description || null,
      raw: data
    };
  }

  normalizeGandmool(data) {
    const present = !!(data?.gandmool_present || data?.present || data?.dosha_present);
    return {
      present,
      nakshatra: data?.nakshatra || null,
      description: data?.description || null,
      raw: data
    };
  }
}

const doshaService = new DoshaService();
export default doshaService;

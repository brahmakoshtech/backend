// src/services/panchangService.js

import axios from 'axios';
import Panchang from '../models/Panchang.js';

class PanchangService {
  constructor() {
    // Astrology API configuration
    this.baseUrl = process.env.ASTROLOGY_API_BASE_URL || 'https://json.astrologyapi.com/v1';
    this.apiUserId = process.env.ASTROLOGY_API_USER_ID;
    this.apiKey = process.env.ASTROLOGY_API_KEY;
    
    // Create axios instance with basic auth
    this.apiClient = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      auth: {
        username: this.apiUserId,
        password: this.apiKey
      },
      timeout: 30000
    });
  }

  /**
   * Retry helper for AWS/first-hit warmup
   */
  async withRetry(fn, retries = 2) {
    try {
      return await fn();
    } catch (err) {
      if (retries > 0 && (err.message?.includes('first') || err.code === 'ECONNREFUSED' || err.response?.status >= 500)) {
        console.log('[Panchang Service] Retrying after initial failure...');
        await new Promise(r => setTimeout(r, 1500));
        return this.withRetry(fn, retries - 1);
      }
      throw err;
    }
  }

  /**
   * Main method: Get complete panchang data
   * Uses current date and user's live location from request
   * Checks DB first (for today's date), then fetches from API if needed
   */
  async getCompletePanchangData(userId, currentDate, latitude, longitude, forceRefresh = false) {
    try {
      // Step 1: Validate input
      this.validatePanchangInput(currentDate, latitude, longitude);

      // Get today's date string for cache key
      const todayKey = this.getTodayKey(currentDate);

      // Step 2: Check if data exists in DB for today (unless force refresh)
      if (!forceRefresh) {
        const existingData = await Panchang.findOne({ 
          userId,
          dateKey: todayKey 
        });
        
        if (existingData) {
          console.log('[Panchang Service] Returning cached data from DB for user:', userId, 'Date:', todayKey);
          return this.formatPanchangResponse(existingData);
        }
        console.log('[Panchang Service] No cached data found for today, fetching from API');
      } else {
        console.log('[Panchang Service] Force refresh requested, fetching fresh data from API');
      }

      // Step 3: Prepare current date and location data for API
      const requestData = this.prepareRequestData(currentDate, latitude, longitude);

      // Step 4: Fetch data from all 4 Panchang API endpoints in parallel
      console.log('[Panchang Service] Fetching from 4 Panchang API endpoints for date:', todayKey);
      const [basicPanchangData, advancedPanchangData, chaughadiyaData, nakshatraPredictionData] = await Promise.all([
        this.fetchBasicPanchang(requestData),
        this.fetchAdvancedPanchangSunrise(requestData),
        this.fetchChaughadiyaMuhurta(requestData),
        this.fetchDailyNakshatraPrediction(requestData)
      ]);

      console.log('[Panchang Service] All API calls completed successfully');

      // Step 5: Process and structure the data
      const panchangData = this.processPanchangData(
        userId,
        todayKey,
        currentDate,
        latitude,
        longitude,
        basicPanchangData,
        advancedPanchangData,
        chaughadiyaData,
        nakshatraPredictionData
      );

      // Step 6: Save to database (upsert for today's date)
      const savedData = await Panchang.findOneAndUpdate(
        { userId, dateKey: todayKey },
        panchangData,
        { upsert: true, new: true }
      );

      console.log('[Panchang Service] Data saved to DB for user:', userId, 'Date:', todayKey);

      // Step 7: Return formatted response
      return this.formatPanchangResponse(savedData);

    } catch (error) {
      console.error('[Panchang Service] Error:', error);
      throw new Error(`Failed to get panchang data: ${error.message}`);
    }
  }

  /**
   * Validate panchang input
   */
  validatePanchangInput(currentDate, latitude, longitude) {
    if (!currentDate) {
      throw new Error('Current date is required');
    }
    
    if (latitude === null || latitude === undefined) {
      throw new Error('Latitude is required');
    }
    
    if (longitude === null || longitude === undefined) {
      throw new Error('Longitude is required');
    }

    const lat = parseFloat(latitude);
    const lon = parseFloat(longitude);

    if (lat < -90 || lat > 90) {
      throw new Error('Latitude must be between -90 and 90');
    }

    if (lon < -180 || lon > 180) {
      throw new Error('Longitude must be between -180 and 180');
    }
  }

  /**
   * Get today's date key for caching (YYYY-MM-DD)
   */
  getTodayKey(date) {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Prepare request data for API (x-www-form-urlencoded format)
   * Uses current date and time instead of birth details
   */
  prepareRequestData(currentDate, latitude, longitude) {
    const date = new Date(currentDate);
    
    return {
      day: date.getDate(),
      month: date.getMonth() + 1,
      year: date.getFullYear(),
      hour: date.getHours(),
      min: date.getMinutes(),
      lat: parseFloat(latitude),
      lon: parseFloat(longitude),
      tzone: 5.5 // Indian Standard Time, adjust as needed based on location
    };
  }

  /**
   * Convert object to URL-encoded format
   */
  toUrlEncoded(data) {
    return Object.keys(data)
      .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(data[key])}`)
      .join('&');
  }

  /**
   * Fetch basic panchang from API (with retry for AWS first-hit)
   */
  async fetchBasicPanchang(requestData) {
    return this.withRetry(async () => {
      console.log('[Panchang Service] Fetching basic_panchang...');
      const response = await this.apiClient.post('/basic_panchang', this.toUrlEncoded(requestData));
      return response.data;
    });
  }

  /**
   * Fetch advanced panchang sunrise from API
   */
  async fetchAdvancedPanchangSunrise(requestData) {
    return this.withRetry(async () => {
      console.log('[Panchang Service] Fetching advanced_panchang/sunrise...');
      const response = await this.apiClient.post('/advanced_panchang/sunrise', this.toUrlEncoded(requestData));
      return response.data;
    });
  }

  /**
   * Fetch chaughadiya muhurta from API
   */
  async fetchChaughadiyaMuhurta(requestData) {
    return this.withRetry(async () => {
      console.log('[Panchang Service] Fetching chaughadiya_muhurta...');
      const response = await this.apiClient.post('/chaughadiya_muhurta', this.toUrlEncoded(requestData));
      return response.data;
    });
  }

  /**
   * Fetch daily nakshatra prediction from API
   */
  async fetchDailyNakshatraPrediction(requestData) {
    return this.withRetry(async () => {
      console.log('[Panchang Service] Fetching daily_nakshatra_prediction...');
      const response = await this.apiClient.post('/daily_nakshatra_prediction', this.toUrlEncoded(requestData));
      return response.data;
    });
  }

  /**
   * Process and structure panchang data from all 4 API responses
   */
  processPanchangData(userId, dateKey, currentDate, latitude, longitude, basicPanchang, advancedPanchang, chaughadiya, nakshatraPrediction) {
    return {
      userId,
      dateKey,
      requestDate: new Date(currentDate),
      location: {
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude)
      },
      basicPanchang: {
        day: basicPanchang.day || '',
        tithi: basicPanchang.tithi || '',
        nakshatra: basicPanchang.nakshatra || '',
        yog: basicPanchang.yog || '',
        karan: basicPanchang.karan || '',
        sunrise: basicPanchang.sunrise || '',
        sunset: basicPanchang.sunset || '',
        vedicSunrise: basicPanchang.vedic_sunrise || '',
        vedicSunset: basicPanchang.vedic_sunset || ''
      },
      advancedPanchang: {
        day: advancedPanchang.day || '',
        sunrise: advancedPanchang.sunrise || '',
        sunset: advancedPanchang.sunset || '',
        moonrise: advancedPanchang.moonrise || '',
        moonset: advancedPanchang.moonset || '',
        vedicSunrise: advancedPanchang.vedic_sunrise || '',
        vedicSunset: advancedPanchang.vedic_sunset || '',
        sunSignChange: advancedPanchang.sun_sign_change || '',
        moonSignChange: advancedPanchang.moon_sign_change || '',
        ayana: advancedPanchang.ayana || '',
        paksha: advancedPanchang.paksha || '',
        ritu: advancedPanchang.ritu || '',
        sunSign: advancedPanchang.sun_sign || '',
        moonSign: advancedPanchang.moon_sign || '',
        panchangYog: advancedPanchang.panchang_yog || '',
        vikramSamvat: advancedPanchang.vikram_samvat || 0,
        shakaSamvat: advancedPanchang.shaka_samvat || 0,
        vkramSamvatName: advancedPanchang.vkram_samvat_name || '',
        shakaSamvatName: advancedPanchang.shaka_samvat_name || '',
        dishaShool: advancedPanchang.disha_shool || '',
        dishaShoolRemedies: advancedPanchang.disha_shool_remedies || '',
        nakShool: {
          direction: advancedPanchang.nak_shool?.direction || '',
          remedies: advancedPanchang.nak_shool?.remedies || ''
        },
        moonNivas: advancedPanchang.moon_nivas || '',
        hinduMaah: {
          adhikStatus: advancedPanchang.hindu_maah?.adhik_status || false,
          purnimanta: advancedPanchang.hindu_maah?.purnimanta || '',
          amanta: advancedPanchang.hindu_maah?.amanta || '',
          amantaId: advancedPanchang.hindu_maah?.amanta_id || 0,
          purnimantaId: advancedPanchang.hindu_maah?.purnimanta_id || 0
        },
        abhijitMuhurta: {
          start: advancedPanchang.abhijit_muhurta?.start || '',
          end: advancedPanchang.abhijit_muhurta?.end || ''
        },
        rahukaal: {
          start: advancedPanchang.rahukaal?.start || '',
          end: advancedPanchang.rahukaal?.end || ''
        },
        guliKaal: {
          start: advancedPanchang.guliKaal?.start || '',
          end: advancedPanchang.guliKaal?.end || ''
        },
        yamghantKaal: {
          start: advancedPanchang.yamghant_kaal?.start || '',
          end: advancedPanchang.yamghant_kaal?.end || ''
        },
        panchang: {
          tithi: advancedPanchang.tithi || {},
          nakshatra: advancedPanchang.nakshatra || {},
          yog: advancedPanchang.yog || {},
          karan: advancedPanchang.karan || {}
        }
      },
      chaughadiyaMuhurta: {
        day: chaughadiya.chaughadiya?.day || [],
        night: chaughadiya.chaughadiya?.night || []
      },
      dailyNakshatraPrediction: {
        birthMoonSign: nakshatraPrediction.birth_moon_sign || '',
        birthMoonNakshatra: nakshatraPrediction.birth_moon_nakshatra || '',
        predictionDate: nakshatraPrediction.prediction_date || '',
        nakshatra: nakshatraPrediction.nakshatra || '',
        prediction: nakshatraPrediction.prediction || {},
        bot_response: nakshatraPrediction.bot_response || '',
        mood: nakshatraPrediction.mood || '',
        mood_percentage: nakshatraPrediction.mood_percentage || '',
        lucky_color: nakshatraPrediction.lucky_color || [],
        lucky_number: nakshatraPrediction.lucky_number || [],
        lucky_time: nakshatraPrediction.lucky_time || ''
      },
      lastCalculated: new Date(),
      calculationSource: 'api'
    };
  }

  /**
   * Format panchang response from DB document
   */
  formatPanchangResponse(panchangDoc) {
    const obj = panchangDoc.toObject();
    
    return {
      dateKey: obj.dateKey,
      requestDate: obj.requestDate,
      location: obj.location,
      basicPanchang: obj.basicPanchang,
      advancedPanchang: obj.advancedPanchang,
      chaughadiyaMuhurta: obj.chaughadiyaMuhurta,
      dailyNakshatraPrediction: obj.dailyNakshatraPrediction,
      lastCalculated: obj.lastCalculated,
      calculationSource: obj.calculationSource
    };
  }

  /**
   * Delete old panchang data for a user (optional cleanup)
   */
  async deleteOldPanchangData(userId, daysToKeep = 7) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

      const result = await Panchang.deleteMany({ 
        userId,
        requestDate: { $lt: cutoffDate }
      });

      console.log(`[Panchang Service] Deleted ${result.deletedCount} old panchang records for user:`, userId);
      return result.deletedCount;
    } catch (error) {
      console.error('[Panchang Service] Delete old data error:', error);
      throw error;
    }
  }

  /**
   * Delete all panchang data for a user
   */
  async deletePanchangData(userId) {
    try {
      await Panchang.deleteMany({ userId });
      console.log('[Panchang Service] Deleted all panchang data for user:', userId);
    } catch (error) {
      console.error('[Panchang Service] Delete error:', error);
      throw error;
    }
  }

  /**
   * Refresh panchang data (force recalculation from API)
   */
  async refreshPanchangData(userId, currentDate, latitude, longitude) {
    console.log('[Panchang Service] Refreshing data for user:', userId);
    return this.getCompletePanchangData(userId, currentDate, latitude, longitude, true);
  }
}

export default new PanchangService();
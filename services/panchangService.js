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
   * Fetch basic panchang from API
   * Endpoint: /v1/basic_panchang
   */
  async fetchBasicPanchang(requestData) {
    try {
      console.log('[Panchang Service] Fetching basic_panchang...');
      const response = await this.apiClient.post('/basic_panchang', this.toUrlEncoded(requestData));
      return response.data;
    } catch (error) {
      console.error('[Panchang Service] Basic panchang error:', error.message);
      throw new Error(`Failed to fetch basic panchang: ${error.message}`);
    }
  }

  /**
   * Fetch advanced panchang sunrise from API
   * Endpoint: /v1/advanced_panchang/sunrise
   */
  async fetchAdvancedPanchangSunrise(requestData) {
    try {
      console.log('[Panchang Service] Fetching advanced_panchang/sunrise...');
      const response = await this.apiClient.post('/advanced_panchang/sunrise', this.toUrlEncoded(requestData));
      return response.data;
    } catch (error) {
      console.error('[Panchang Service] Advanced panchang error:', error.message);
      throw new Error(`Failed to fetch advanced panchang: ${error.message}`);
    }
  }

  /**
   * Fetch chaughadiya muhurta from API
   * Endpoint: /v1/chaughadiya_muhurta
   */
  async fetchChaughadiyaMuhurta(requestData) {
    try {
      console.log('[Panchang Service] Fetching chaughadiya_muhurta...');
      const response = await this.apiClient.post('/chaughadiya_muhurta', this.toUrlEncoded(requestData));
      return response.data;
    } catch (error) {
      console.error('[Panchang Service] Chaughadiya muhurta error:', error.message);
      throw new Error(`Failed to fetch chaughadiya muhurta: ${error.message}`);
    }
  }

  /**
   * Fetch daily nakshatra prediction from API
   * Endpoint: /v1/daily_nakshatra_prediction
   */
  async fetchDailyNakshatraPrediction(requestData) {
    try {
      console.log('[Panchang Service] Fetching daily_nakshatra_prediction...');
      const response = await this.apiClient.post('/daily_nakshatra_prediction', this.toUrlEncoded(requestData));
      return response.data;
    } catch (error) {
      console.error('[Panchang Service] Nakshatra prediction error:', error.message);
      throw new Error(`Failed to fetch nakshatra prediction: ${error.message}`);
    }
  }

  /**
   * Process and structure panchang data from all 4 API responses
   */
  processPanchangData(userId, dateKey, currentDate, latitude, longitude, basicPanchang, advancedPanchang, chaughadiya, nakshatraPrediction) {
    return {
      userId,
      dateKey, // Store date key for easy querying
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
        paksha: basicPanchang.paksha || '',
        ritu: basicPanchang.ritu || '',
        month: basicPanchang.month || '',
        moonSign: basicPanchang.moon_sign || basicPanchang.moonSign || '',
        sunSign: basicPanchang.sun_sign || basicPanchang.sunSign || '',
        ayanamsha: basicPanchang.ayanamsha || 0,
        vikramSamvat: basicPanchang.vikram_samvat || basicPanchang.vikramSamvat || '',
        shakaSamvat: basicPanchang.shaka_samvat || basicPanchang.shakaSamvat || '',
        vkramSamvatName: basicPanchang.vkram_samvat_name || basicPanchang.vkramSamvatName || '',
        shakaSamvatName: basicPanchang.shaka_samvat_name || basicPanchang.shakaSamvatName || '',
        dishaShool: basicPanchang.disha_shool || basicPanchang.dishaShool || '',
        dishaShoolRemedies: basicPanchang.disha_shool_remedies || basicPanchang.dishaShoolRemedies || '',
        kundliMuhurta: basicPanchang.kundali_muhurta || basicPanchang.kundliMuhurta || '',
        rahukaal: basicPanchang.rahukaal || '',
        guliKaal: basicPanchang.guliKaal || basicPanchang.gulikai || '',
        yamagandaKaal: basicPanchang.yamaganda || basicPanchang.yamagandaKaal || '',
        abhijitMuhurta: basicPanchang.abhijit_muhurta || basicPanchang.abhijitMuhurta || '',
        sunrise: basicPanchang.sunrise || '',
        sunset: basicPanchang.sunset || '',
        moonrise: basicPanchang.moonrise || '',
        moonset: basicPanchang.moonset || ''
      },
      advancedPanchang: {
        sunrise: advancedPanchang.sunrise || '',
        sunset: advancedPanchang.sunset || '',
        moonrise: advancedPanchang.moonrise || '',
        moonset: advancedPanchang.moonset || '',
        sunSignChange: advancedPanchang.sun_sign_change || advancedPanchang.sunSignChange || '',
        moonSignChange: advancedPanchang.moon_sign_change || advancedPanchang.moonSignChange || '',
        ayana: advancedPanchang.ayana || '',
        panchang: {
          tithi: advancedPanchang.tithi || {},
          nakshatra: advancedPanchang.nakshatra || {},
          yog: advancedPanchang.yog || {},
          karan: advancedPanchang.karan || {}
        }
      },
      chaughadiyaMuhurta: {
        day: chaughadiya.day || [],
        night: chaughadiya.night || []
      },
      dailyNakshatraPrediction: {
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
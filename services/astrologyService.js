// src/services/astrologyService.js

import axios from 'axios';
import Astrology from '../models/Astrology.js';

class AstrologyService {
  constructor() {
    // Astrology API configuration
    this.baseUrl = process.env.ASTROLOGY_API_BASE_URL || 'https://json.astrologyapi.com/v1';
    this.apiUserId = process.env.ASTROLOGY_API_USER_ID;
    this.apiKey = process.env.ASTROLOGY_API_KEY;
    
    // Create axios instance with basic auth - FIXED: Use JSON content-type
    this.apiClient = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'Content-Type': 'application/json'
      },
      auth: {
        username: this.apiUserId,
        password: this.apiKey
      },
      timeout: 30000
    });
  }

  /**
   * Main method: Get complete astrology data
   * Checks DB first, then fetches from API if needed
   */

  
  async getCompleteAstrologyData(userId, profile, forceRefresh = false) {
    try {
      // Step 1: Check if data exists in DB (unless force refresh)
      if (!forceRefresh) {
        const existingData = await Astrology.findOne({ userId });
        if (existingData) {
          console.log('[Astrology Service] Returning cached data from DB for user:', userId);
          return this.formatAstrologyResponse(existingData);
        }
        console.log('[Astrology Service] No cached data found, fetching from API');
      } else {
        console.log('[Astrology Service] Force refresh requested, fetching fresh data from API');
      }

      // Step 2: Validate profile data
      this.validateBirthDetails(profile);

      // Step 3: Prepare birth data for API
      const birthData = this.prepareBirthData(profile);

      // Step 4: Fetch data from all 4 API endpoints in parallel
      console.log('[Astrology Service] Fetching from 4 API endpoints...');
      const [birthDetailsData, astroDetailsData, planetsData, planetsExtendedData] = await Promise.all([
        this.fetchBirthDetails(birthData),
        this.fetchAstroDetails(birthData),
        this.fetchPlanets(birthData),
        this.fetchPlanetsExtended(birthData)
      ]);

      console.log('[Astrology Service] All API calls completed successfully');

      // Step 5: Process and structure the data
      const astrologyData = this.processAstrologyData(
        userId,
        profile,
        birthDetailsData,
        astroDetailsData,
        planetsData,
        planetsExtendedData
      );

      // Step 6: Save to database
      const savedData = await Astrology.findOneAndUpdate(
        { userId },
        astrologyData,
        { upsert: true, new: true }
      );

      console.log('[Astrology Service] Data saved to DB for user:', userId);

      // Step 7: Return formatted response
      return this.formatAstrologyResponse(savedData);

    } catch (error) {
      console.error('[Astrology Service] Error:', error);
      throw new Error(`Failed to get astrology data: ${error.message}`);
    }
  }

  /**
   * Validate birth details
   */
  validateBirthDetails(profile) {
    if (!profile?.dob || !profile?.timeOfBirth || 
        profile?.latitude === null || profile?.latitude === undefined ||
        profile?.longitude === null || profile?.longitude === undefined) {
      throw new Error('Incomplete birth details: dob, timeOfBirth, latitude, and longitude are required');
    }
  }

  /**
   * Prepare birth data for API request (JSON format)
   */
  prepareBirthData(profile) {
    const birthDate = new Date(profile.dob);
    
    // Parse time - handle both "4:45 AM" and "04:45" formats
    let hours, minutes;
    const timeStr = profile.timeOfBirth.trim();
    
    if (timeStr.includes('AM') || timeStr.includes('PM')) {
      // 12-hour format: "4:45 AM" or "11:30 PM"
      const [time, period] = timeStr.split(' ');
      const [h, m] = time.split(':').map(Number);
      
      hours = h;
      if (period === 'PM' && hours !== 12) {
        hours += 12;
      } else if (period === 'AM' && hours === 12) {
        hours = 0;
      }
      minutes = m;
    } else {
      // 24-hour format: "16:30"
      [hours, minutes] = timeStr.split(':').map(Number);
    }
    
    return {
      day: birthDate.getDate(),
      month: birthDate.getMonth() + 1,
      year: birthDate.getFullYear(),
      hour: hours,
      min: minutes,
      lat: parseFloat(profile.latitude),
      lon: parseFloat(profile.longitude),
      tzone: 5.5 // Indian Standard Time, adjust as needed
    };
  }

  /**
   * Fetch birth details from API
   * Endpoint: /birth_details
   */
  async fetchBirthDetails(birthData) {
    try {
      console.log('[Astrology Service] Fetching birth_details...');
      console.log('[Astrology Service] Request data:', JSON.stringify(birthData));
      const response = await this.apiClient.post('/birth_details', birthData);
      return response.data;
    } catch (error) {
      console.error('[Astrology Service] Birth details error:', error.response?.data || error.message);
      throw new Error(`Failed to fetch birth details: ${error.message}`);
    }
  }

  /**
   * Fetch astro details from API
   * Endpoint: /astro_details
   */
  async fetchAstroDetails(birthData) {
    try {
      console.log('[Astrology Service] Fetching astro_details...');
      const response = await this.apiClient.post('/astro_details', birthData);
      return response.data;
    } catch (error) {
      console.error('[Astrology Service] Astro details error:', error.response?.data || error.message);
      throw new Error(`Failed to fetch astro details: ${error.message}`);
    }
  }

  /**
   * Fetch planets from API
   * Endpoint: /planets
   */
  async fetchPlanets(birthData) {
    try {
      console.log('[Astrology Service] Fetching planets...');
      const response = await this.apiClient.post('/planets', birthData);
      return response.data;
    } catch (error) {
      console.error('[Astrology Service] Planets error:', error.response?.data || error.message);
      throw new Error(`Failed to fetch planets: ${error.message}`);
    }
  }

  /**
   * Fetch extended planets from API
   * Endpoint: /planets/extended
   */
  async fetchPlanetsExtended(birthData) {
    try {
      console.log('[Astrology Service] Fetching planets/extended...');
      const response = await this.apiClient.post('/planets/extended', birthData);
      return response.data;
    } catch (error) {
      console.error('[Astrology Service] Extended planets error:', error.response?.data || error.message);
      throw new Error(`Failed to fetch extended planets: ${error.message}`);
    }
  }

  /**
   * Process and structure astrology data from all 4 API responses
   */
  processAstrologyData(userId, profile, birthDetailsData, astroDetailsData, planetsData, planetsExtendedData) {
    const birthDate = new Date(profile.dob);
    
    // Parse time - handle both "4:45 AM" and "04:45" formats
    let hour, minute;
    const timeStr = profile.timeOfBirth.trim();
    
    if (timeStr.includes('AM') || timeStr.includes('PM')) {
      const [time, period] = timeStr.split(' ');
      const [h, m] = time.split(':').map(Number);
      
      hour = h;
      if (period === 'PM' && hour !== 12) {
        hour += 12;
      } else if (period === 'AM' && hour === 12) {
        hour = 0;
      }
      minute = m;
    } else {
      [hour, minute] = timeStr.split(':').map(Number);
    }

    return {
      userId,
      birthDetails: {
        day: birthDetailsData.day || birthDate.getDate(),
        month: birthDetailsData.month || (birthDate.getMonth() + 1),
        year: birthDetailsData.year || birthDate.getFullYear(),
        hour: birthDetailsData.hour || hour,
        minute: birthDetailsData.minute || minute,
        latitude: parseFloat(profile.latitude),
        longitude: parseFloat(profile.longitude),
        ayanamsha: birthDetailsData.ayanamsha || 0,
        sunrise: birthDetailsData.sunrise || '06:00',
        sunset: birthDetailsData.sunset || '18:00'
      },
      astroDetails: {
        // Primary details
        ascendant: astroDetailsData.ascendant || '',
        ascendantLord: astroDetailsData.ascendant_lord || '',
        sign: astroDetailsData.sign || '',
        signLord: astroDetailsData.SignLord || astroDetailsData.sign_lord || '',
        
        // Nakshatra details
        nakshatra: astroDetailsData.Naksahtra || astroDetailsData.nakshatra || '',
        nakshatraLord: astroDetailsData.NaksahtraLord || astroDetailsData.Naksahtra_lord || astroDetailsData.nakshatra_lord || '',
        charan: (astroDetailsData.Charan || astroDetailsData.charan || '').toString(),
        
        // Vedic classifications
        varna: astroDetailsData.Varna || astroDetailsData.varna || '',
        vashya: astroDetailsData.Vashya || astroDetailsData.vashya || '',
        yoni: astroDetailsData.Yoni || astroDetailsData.yoni || '',
        gan: astroDetailsData.Gan || astroDetailsData.gan || '',
        nadi: astroDetailsData.Nadi || astroDetailsData.nadi || '',
        
        // Panchang details
        tithi: astroDetailsData.Tithi || astroDetailsData.tithi || '',
        yog: astroDetailsData.Yog || astroDetailsData.yog || '',
        karan: astroDetailsData.Karan || astroDetailsData.karan || '',
        
        // Additional attributes
        yunja: astroDetailsData.yunja || '',
        tatva: astroDetailsData.tatva || '',
        nameAlphabet: astroDetailsData.name_alphabet || '',
        paya: astroDetailsData.paya || ''
      },
      planets: this.normalizePlanets(planetsData),
      planetsExtended: this.normalizePlanetsExtended(planetsExtendedData),
      birthChart: this.generateBirthChart(planetsData),
      birthExtendedChart: this.generateBirthChart(planetsExtendedData),
      lastCalculated: new Date(),
      calculationSource: 'api'
    };
  }

  /**
   * Normalize planets data from API to match schema
   */
  normalizePlanets(planetsData) {
    // Handle both array and object responses
    const planetsArray = Array.isArray(planetsData) ? planetsData : Object.values(planetsData);
    
    return planetsArray
      .filter(planet => planet && planet.name)
      .map((planet, index) => ({
        id: planet.id !== undefined ? planet.id : index,
        name: planet.name,
        fullDegree: planet.fullDegree || planet.full_degree || 0,
        normDegree: planet.normDegree || planet.norm_degree || 0,
        speed: planet.speed || 0,
        isRetro: (planet.isRetro || planet.is_retro || planet.isRetro === false ? 'false' : 'false').toString(),
        sign: planet.sign || '',
        signLord: planet.signLord || planet.sign_lord || '',
        nakshatra: planet.nakshatra || '',
        nakshatraLord: planet.nakshatraLord || planet.nakshatra_lord || '',
        nakshatra_pad: planet.nakshatra_pad || 0,
        house: planet.house || 0,
        is_planet_set: planet.is_planet_set || false,
        planet_awastha: planet.planet_awastha || 'Neutral'
      }));
  }

  /**
   * Normalize extended planets data from API
   */
  normalizePlanetsExtended(planetsData) {
    // Handle both array and object responses
    const planetsArray = Array.isArray(planetsData) ? planetsData : Object.values(planetsData);
    
    return planetsArray
      .filter(planet => planet && planet.name)
      .map((planet, index) => ({
        id: planet.id || index,
        name: planet.name,
        fullDegree: planet.fullDegree || planet.full_degree || 0,
        normDegree: planet.normDegree || planet.norm_degree || 0,
        speed: planet.speed || 0,
        isRetro: (planet.isRetro || planet.is_retro || 'false').toString(),
        sign: planet.sign || '',
        signLord: planet.signLord || planet.sign_lord || '',
        nakshatra: planet.nakshatra || '',
        nakshatraLord: planet.nakshatraLord || planet.nakshatra_lord || '',
        nakshatra_pad: planet.nakshatra_pad || 0,
        house: planet.house || 0,
        is_planet_set: planet.is_planet_set || false,
        planet_awastha: planet.planet_awastha || 'Neutral'
      }));
  }

  /**
   * Generate birth chart from planets data
   */
  generateBirthChart(planetsData) {
    const houses = {};
    
    // Initialize all 12 houses
    for (let i = 1; i <= 12; i++) {
      houses[i] = [];
    }

    // Handle both array and object responses
    const planetsArray = Array.isArray(planetsData) ? planetsData : Object.values(planetsData);

    // Place planets in houses (excluding Ascendant from chart display)
    planetsArray.forEach(planet => {
      if (planet && planet.house && planet.house >= 1 && planet.house <= 12) {
        // Exclude Ascendant from chart display but keep other planets
        if (!['Ascendant', 'ASCENDANT'].includes(planet.name)) {
          houses[planet.house].push(planet.name);
        }
      }
    });

    return { houses };
  }

  /**
   * Format astrology response from DB document
   */
  formatAstrologyResponse(astrologyDoc) {
    const obj = astrologyDoc.toObject();
    
    // Convert Map to Object for houses
    const formatHouses = (housesMap) => {
      if (!housesMap) return {};
      const formatted = {};
      for (let i = 1; i <= 12; i++) {
        formatted[i] = housesMap.get(i.toString()) || [];
      }
      return formatted;
    };

    return {
      birthDetails: obj.birthDetails,
      astroDetails: obj.astroDetails,
      planets: obj.planets,
      planetsExtended: obj.planetsExtended,
      birthChart: {
        houses: formatHouses(obj.birthChart?.houses)
      },
      birthExtendedChart: {
        houses: formatHouses(obj.birthExtendedChart?.houses)
      },
      lastCalculated: obj.lastCalculated,
      calculationSource: obj.calculationSource
    };
  }

  /**
   * Delete astrology data for a user
   */
  async deleteAstrologyData(userId) {
    try {
      await Astrology.findOneAndDelete({ userId });
      console.log('[Astrology Service] Deleted astrology data for user:', userId);
    } catch (error) {
      console.error('[Astrology Service] Delete error:', error);
      throw error;
    }
  }

  /**
   * Refresh astrology data (force recalculation from API)
   */
  async refreshAstrologyData(userId, profile) {
    console.log('[Astrology Service] Refreshing data for user:', userId);
    return this.getCompleteAstrologyData(userId, profile, true);
  }
}

export default new AstrologyService();
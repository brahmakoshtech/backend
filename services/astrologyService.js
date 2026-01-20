// src/services/astrologyService.js

import axios from 'axios';

const ASTROLOGY_API_BASE_URL = 'https://json.astrologyapi.com/v1';
const ASTROLOGY_USER_ID = process.env.ASTROLOGY_USER_ID || '648891';
const ASTROLOGY_API_KEY = process.env.ASTROLOGY_API_KEY || '2932331f2f8acd62fb79f5f489963d1ddadf7382';

class AstrologyService {
  constructor() {
    this.baseURL = ASTROLOGY_API_BASE_URL;
    this.auth = {
      username: ASTROLOGY_USER_ID,
      password: ASTROLOGY_API_KEY
    };
  }

  prepareBirthData(profile) {
    if (!profile.dob || !profile.timeOfBirth || !profile.latitude || !profile.longitude) {
      throw new Error('Incomplete birth details. Required: DOB, time of birth, latitude, longitude');
    }

    const birthDate = new Date(profile.dob);
    const [hours, minutes] = profile.timeOfBirth.split(':').map(Number);

    return {
      day: birthDate.getDate(),
      month: birthDate.getMonth() + 1,
      year: birthDate.getFullYear(),
      hour: hours,
      min: minutes,
      lat: profile.latitude,
      lon: profile.longitude,
      tzone: 5.5
    };
  }

  async getBirthDetails(birthData) {
    try {
      const response = await axios.post(
        `${this.baseURL}/birth_details`,
        birthData,
        { 
          auth: this.auth,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        }
      );
      return response.data;
    } catch (error) {
      console.error('[Astrology] Birth details error:', error.response?.data || error.message);
      throw new Error('Failed to fetch birth details');
    }
  }

  async getAstroDetails(birthData) {
    try {
      const response = await axios.post(
        `${this.baseURL}/astro_details`,
        birthData,
        { 
          auth: this.auth,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        }
      );
      return response.data;
    } catch (error) {
      console.error('[Astrology] Astro details error:', error.response?.data || error.message);
      throw new Error('Failed to fetch astro details');
    }
  }

  async getPlanets(birthData) {
    try {
      const response = await axios.post(
        `${this.baseURL}/planets`,
        birthData,
        { 
          auth: this.auth,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        }
      );
      return response.data;
    } catch (error) {
      console.error('[Astrology] Planets error:', error.response?.data || error.message);
      throw new Error('Failed to fetch planets data');
    }
  }

  async getPlanetsExtended(birthData) {
    try {
      const response = await axios.post(
        `${this.baseURL}/planets/extended`,
        birthData,
        { 
          auth: this.auth,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        }
      );
      return response.data;
    } catch (error) {
      console.error('[Astrology] Planets extended error:', error.response?.data || error.message);
      throw new Error('Failed to fetch extended planets data');
    }
  }

  async getCompleteAstrologyData(profile) {
    try {
      const birthData = this.prepareBirthData(profile);

      console.log('[Astrology] Fetching complete data with:', birthData);

      const [birthDetails, astroDetails, planets, planetsExtended] = await Promise.all([
        this.getBirthDetails(birthData),
        this.getAstroDetails(birthData),
        this.getPlanets(birthData),
        this.getPlanetsExtended(birthData)
      ]);

      return {
        birthDetails,
        astroDetails,
        planets,
        planetsExtended,
        requestedFor: {
          name: profile.name,
          dob: profile.dob,
          timeOfBirth: profile.timeOfBirth,
          placeOfBirth: profile.placeOfBirth
        }
      };
    } catch (error) {
      console.error('[Astrology] Complete data error:', error);
      throw error;
    }
  }
}

const astrologyService = new AstrologyService();
export default astrologyService;
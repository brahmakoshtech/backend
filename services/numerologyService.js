// src/services/numerologyService.js

import axios from 'axios';
import Numerology from '../models/Numerology.js';

class NumerologyService {
  constructor() {
    this.baseUrl = 'https://json.astrologyapi.com/v1';
    this.apiUserId = process.env.ASTROLOGY_API_USER_ID;
    this.apiKey = process.env.ASTROLOGY_API_KEY;
    
    // Create axios instance with authentication
    this.axiosInstance = axios.create({
      baseURL: this.baseUrl,
      auth: {
        username: this.apiUserId,
        password: this.apiKey
      },
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });
  }

  /**
   * Format date components from Date object or user profile
   */
  extractDateComponents(dateInput) {
    let date;
    
    if (typeof dateInput === 'string' || dateInput instanceof Date) {
      date = new Date(dateInput);
    } else if (typeof dateInput === 'object' && dateInput.day && dateInput.month && dateInput.year) {
      return {
        day: parseInt(dateInput.day),
        month: parseInt(dateInput.month),
        year: parseInt(dateInput.year)
      };
    } else {
      throw new Error('Invalid date format');
    }

    return {
      day: date.getDate(),
      month: date.getMonth() + 1,
      year: date.getFullYear()
    };
  }

  /**
   * Call the numerology API endpoints
   */
  async callNumeroAPI(endpoint, day, month, year, name) {
    try {
      const formData = new URLSearchParams();
      formData.append('day', day.toString());
      formData.append('month', month.toString());
      formData.append('year', year.toString());
      formData.append('name', name);

      console.log(`[Numerology Service] Calling ${endpoint} with params:`, { day, month, year, name });

      const response = await this.axiosInstance.post(endpoint, formData);
      
      console.log(`[Numerology Service] ${endpoint} API response received`);
      return response.data;
    } catch (error) {
      console.error(`[Numerology Service] Error calling ${endpoint}:`, error.message);
      throw new Error(`Failed to fetch ${endpoint}: ${error.message}`);
    }
  }

  /**
   * Fetch all three numerology endpoints
   */
  async fetchAllNumerologyData(day, month, year, name) {
    try {
      console.log('[Numerology Service] Fetching all numerology data...');

      const [numeroReport, numeroTable, dailyPrediction] = await Promise.all([
        this.callNumeroAPI('/numero_report', day, month, year, name),
        this.callNumeroAPI('/numero_table', day, month, year, name),
        this.callNumeroAPI('/numero_prediction/daily', day, month, year, name)
      ]);

      console.log('[Numerology Service] All numerology data fetched successfully');

      return {
        numeroReport,
        numeroTable,
        dailyPrediction
      };
    } catch (error) {
      console.error('[Numerology Service] Error fetching numerology data:', error);
      throw error;
    }
  }

  /**
   * Get or create numerology data for a user
   */
  async getNumerologyData(userId, dateInput, userName, forceRefresh = false) {
    try {
      const { day, month, year } = this.extractDateComponents(dateInput);
      
      // Create a normalized date for comparison (start of day in UTC)
      const normalizedDate = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));

      console.log(`[Numerology Service] Getting numerology data for user ${userId} on ${year}-${month}-${day}`);

      // Check if data exists in database for this user and date
      if (!forceRefresh) {
        const existingData = await Numerology.findOne({
          userId,
          day,
          month,
          year
        }).lean();

        if (existingData) {
          console.log('[Numerology Service] Found existing numerology data in database');
          return {
            source: 'database',
            data: existingData
          };
        }
      }

      console.log('[Numerology Service] No existing data found, fetching from API...');

      // Fetch fresh data from API
      const apiData = await this.fetchAllNumerologyData(day, month, year, userName);

      // Save or update in database
      const numerologyData = await Numerology.findOneAndUpdate(
        { userId, day, month, year },
        {
          userId,
          date: normalizedDate,
          day,
          month,
          year,
          name: userName,
          numeroReport: apiData.numeroReport,
          numeroTable: apiData.numeroTable,
          dailyPrediction: apiData.dailyPrediction,
          apiCallDate: new Date()
        },
        {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true
        }
      ).lean();

      console.log('[Numerology Service] Numerology data saved to database');

      return {
        source: 'api',
        data: numerologyData
      };

    } catch (error) {
      console.error('[Numerology Service] Error in getNumerologyData:', error);
      throw error;
    }
  }

  /**
   * Force refresh numerology data from API
   */
  async refreshNumerologyData(userId, dateInput, userName) {
    console.log('[Numerology Service] Force refreshing numerology data...');
    return this.getNumerologyData(userId, dateInput, userName, true);
  }

  /**
   * Get numerology history for a user
   */
  async getNumerologyHistory(userId, limit = 10, skip = 0) {
    try {
      const history = await Numerology.find({ userId })
        .sort({ date: -1 })
        .limit(limit)
        .skip(skip)
        .lean();

      const total = await Numerology.countDocuments({ userId });

      return {
        history,
        total,
        limit,
        skip,
        hasMore: total > skip + limit
      };
    } catch (error) {
      console.error('[Numerology Service] Error fetching numerology history:', error);
      throw error;
    }
  }

  /**
   * Delete numerology data for a specific date
   */
  async deleteNumerologyData(userId, dateInput) {
    try {
      const { day, month, year } = this.extractDateComponents(dateInput);

      const result = await Numerology.findOneAndDelete({
        userId,
        day,
        month,
        year
      });

      if (!result) {
        throw new Error('Numerology data not found for this date');
      }

      console.log(`[Numerology Service] Deleted numerology data for user ${userId} on ${year}-${month}-${day}`);
      return result;
    } catch (error) {
      console.error('[Numerology Service] Error deleting numerology data:', error);
      throw error;
    }
  }
}

const numerologyService = new NumerologyService();
export default numerologyService;
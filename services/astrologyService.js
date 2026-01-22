// src/services/astrologyService.js

class AstrologyService {
  prepareBirthData(profile) {
    console.log('[Astrology Service] Input profile:', profile);
    
    if (!profile.dob || !profile.timeOfBirth || 
        profile.latitude === null || profile.latitude === undefined || profile.latitude === '' ||
        profile.longitude === null || profile.longitude === undefined || profile.longitude === '') {
      
      console.log('[Astrology Service] Missing fields:', {
        dob: !profile.dob,
        timeOfBirth: !profile.timeOfBirth,
        latitude: profile.latitude === null || profile.latitude === undefined || profile.latitude === '',
        longitude: profile.longitude === null || profile.longitude === undefined || profile.longitude === ''
      });
      
      throw new Error('Incomplete birth details required for astrology calculations');
    }

    const birthDate = new Date(profile.dob);
    const [hours, minutes] = profile.timeOfBirth.split(':').map(Number);
    const lat = parseFloat(profile.latitude);
    const lon = parseFloat(profile.longitude);

    console.log('[Astrology Service] Parsed birth data:', {
      day: birthDate.getDate(),
      month: birthDate.getMonth() + 1,
      year: birthDate.getFullYear(),
      hour: hours,
      min: minutes,
      lat: lat,
      lon: lon
    });

    return {
      day: birthDate.getDate(),
      month: birthDate.getMonth() + 1,
      year: birthDate.getFullYear(),
      hour: hours,
      min: minutes,
      lat: lat,
      lon: lon,
      tzone: 5.5
    };
  }

  async getCompleteAstrologyData(profile) {
    const birthData = this.prepareBirthData(profile);

    return {
      birthDetails: {
        day: birthData.day,
        month: birthData.month,
        year: birthData.year,
        hour: birthData.hour,
        minute: birthData.min,
        latitude: birthData.lat,
        longitude: birthData.lon,
        ayanamsha: 24.1234,
        sunrise: '06:30',
        sunset: '18:45'
      },
      astroDetails: {
        ascendant: 'Leo',
        sign: 'Taurus',
        signLord: 'Venus',
        nakshatra: 'Rohini',
        nakshatraLord: 'Moon',
        charan: '2',
        varna: 'Vaishya',
        gan: 'Manushya',
        yoni: 'Sarpa',
        nadi: 'Madhya'
      },
      planets: [
        { id: 1, name: 'Sun', degree: 45.23, normDegree: 45.23, sign: 'Taurus', nakshatra: 'Rohini', house: 10, isRetro: false, isCombust: false, planet_awastha: 'Exalted', awastha: 'Exalted' },
        { id: 2, name: 'Moon', degree: 123.45, normDegree: 123.45, sign: 'Leo', nakshatra: 'Magha', house: 1, isRetro: false, isCombust: false, planet_awastha: 'Own', awastha: 'Own' },
        { id: 3, name: 'Mars', degree: 234.56, normDegree: 234.56, sign: 'Scorpio', nakshatra: 'Anuradha', house: 4, isRetro: true, isCombust: false, planet_awastha: 'Own', awastha: 'Own' },
        { id: 4, name: 'Mercury', degree: 67.89, normDegree: 67.89, sign: 'Gemini', nakshatra: 'Ardra', house: 11, isRetro: false, isCombust: true, planet_awastha: 'Own', awastha: 'Own' },
        { id: 5, name: 'Jupiter', degree: 156.78, normDegree: 156.78, sign: 'Virgo', nakshatra: 'Hasta', house: 2, isRetro: false, isCombust: false, planet_awastha: 'Debilitated', awastha: 'Debilitated' },
        { id: 6, name: 'Venus', degree: 289.34, normDegree: 289.34, sign: 'Capricorn', nakshatra: 'Shravana', house: 6, isRetro: false, isCombust: false, planet_awastha: 'Neutral', awastha: 'Neutral' },
        { id: 7, name: 'Saturn', degree: 198.12, normDegree: 198.12, sign: 'Libra', nakshatra: 'Swati', house: 3, isRetro: true, isCombust: false, planet_awastha: 'Exalted', awastha: 'Exalted' },
        { id: 8, name: 'Uranus', degree: 145.67, normDegree: 145.67, sign: 'Leo', nakshatra: 'Purva Phalguni', house: 1, isRetro: false, isCombust: false, planet_awastha: 'Neutral', awastha: 'Neutral' },
        { id: 9, name: 'Neptune', degree: 312.45, normDegree: 312.45, sign: 'Aquarius', nakshatra: 'Dhanishta', house: 7, isRetro: false, isCombust: false, planet_awastha: 'Neutral', awastha: 'Neutral' },
        { id: 10, name: 'Pluto', degree: 89.23, normDegree: 89.23, sign: 'Cancer', nakshatra: 'Punarvasu', house: 12, isRetro: true, isCombust: false, planet_awastha: 'Neutral', awastha: 'Neutral' }
      ],
      planetsExtended: [
        { id: 11, name: 'Rahu', degree: 78.90, normDegree: 78.90, sign: 'Cancer', nakshatra: 'Pushya', house: 12, isRetro: true, isCombust: false, planet_awastha: 'Neutral', awastha: 'Neutral' },
        { id: 12, name: 'Ketu', degree: 258.90, normDegree: 258.90, sign: 'Capricorn', nakshatra: 'Uttara Ashadha', house: 6, isRetro: true, isCombust: false, planet_awastha: 'Neutral', awastha: 'Neutral' },
        { id: 13, name: 'Chiron', degree: 167.89, normDegree: 167.89, sign: 'Virgo', nakshatra: 'Hasta', house: 2, isRetro: false, isCombust: false, planet_awastha: 'Neutral', awastha: 'Neutral' },
        { id: 14, name: 'Ceres', degree: 234.12, normDegree: 234.12, sign: 'Scorpio', nakshatra: 'Jyeshtha', house: 4, isRetro: false, isCombust: false, planet_awastha: 'Neutral', awastha: 'Neutral' },
        { id: 15, name: 'Pallas', degree: 56.78, normDegree: 56.78, sign: 'Gemini', nakshatra: 'Mrigashira', house: 11, isRetro: true, isCombust: false, planet_awastha: 'Neutral', awastha: 'Neutral' },
        { id: 16, name: 'Juno', degree: 298.45, normDegree: 298.45, sign: 'Capricorn', nakshatra: 'Uttara Ashadha', house: 6, isRetro: false, isCombust: false, planet_awastha: 'Neutral', awastha: 'Neutral' },
        { id: 17, name: 'Vesta', degree: 123.67, normDegree: 123.67, sign: 'Leo', nakshatra: 'Magha', house: 1, isRetro: false, isCombust: false, planet_awastha: 'Neutral', awastha: 'Neutral' },
        { id: 18, name: 'Lilith', degree: 189.34, normDegree: 189.34, sign: 'Libra', nakshatra: 'Swati', house: 3, isRetro: false, isCombust: false, planet_awastha: 'Neutral', awastha: 'Neutral' },
        { id: 19, name: 'Part of Fortune', degree: 267.12, normDegree: 267.12, sign: 'Sagittarius', nakshatra: 'Purva Ashadha', house: 5, isRetro: false, isCombust: false, planet_awastha: 'Neutral', awastha: 'Neutral' },
        { id: 20, name: 'Vertex', degree: 345.78, normDegree: 345.78, sign: 'Pisces', nakshatra: 'Uttara Bhadrapada', house: 8, isRetro: false, isCombust: false, planet_awastha: 'Neutral', awastha: 'Neutral' },
        { id: 21, name: 'Midheaven', degree: 98.45, normDegree: 98.45, sign: 'Cancer', nakshatra: 'Ashlesha', house: 10, isRetro: false, isCombust: false, planet_awastha: 'Neutral', awastha: 'Neutral' },
        { id: 22, name: 'Ascendant', degree: 156.23, normDegree: 156.23, sign: 'Virgo', nakshatra: 'Hasta', house: 1, isRetro: false, isCombust: false, planet_awastha: 'Neutral', awastha: 'Neutral' },
        { id: 23, name: 'Descendant', degree: 336.23, normDegree: 336.23, sign: 'Pisces', nakshatra: 'Uttara Bhadrapada', house: 7, isRetro: false, isCombust: false, planet_awastha: 'Neutral', awastha: 'Neutral' }
      ],
      birthChart: {
        houses: {
          1: ['Moon'],
          2: ['Jupiter'],
          3: ['Saturn'],
          4: ['Mars'],
          5: [],
          6: ['Venus', 'Ketu'],
          7: [],
          8: [],
          9: [],
          10: ['Sun'],
          11: ['Mercury'],
          12: ['Rahu']
        }
      },
      birthExtendedChart: {
        houses: {
          1: ['Moon'],
          2: ['Jupiter'],
          3: ['Saturn'],
          4: ['Mars'],
          5: [],
          6: ['Venus', 'Ketu'],
          7: [],
          8: [],
          9: [],
          10: ['Sun'],
          11: ['Mercury'],
          12: ['Rahu']
        }
      }
    };
  }
}

const astrologyService = new AstrologyService();
export default astrologyService;
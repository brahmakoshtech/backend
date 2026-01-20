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
        SignLord: 'Venus',
        Naksahtra: 'Rohini',
        NaksahtraLord: 'Moon',
        Charan: '2',
        Varna: 'Vaishya',
        Gan: 'Manushya',
        Yoni: 'Sarpa',
        Nadi: 'Madhya'
      },
      planets: [
        { id: 1, name: 'Sun', degree: 45.23, normDegree: 45.23, sign: 'Taurus', nakshatra: 'Rohini', house: 10, isRetro: false, isCombust: false, planet_awastha: 'Exalted', awastha: 'Exalted' },
        { id: 2, name: 'Moon', degree: 123.45, normDegree: 123.45, sign: 'Leo', nakshatra: 'Magha', house: 1, isRetro: false, isCombust: false, planet_awastha: 'Own', awastha: 'Own' },
        { id: 3, name: 'Mars', degree: 234.56, normDegree: 234.56, sign: 'Scorpio', nakshatra: 'Anuradha', house: 4, isRetro: true, isCombust: false, planet_awastha: 'Own', awastha: 'Own' },
        { id: 4, name: 'Mercury', degree: 67.89, normDegree: 67.89, sign: 'Gemini', nakshatra: 'Ardra', house: 11, isRetro: false, isCombust: true, planet_awastha: 'Own', awastha: 'Own' },
        { id: 5, name: 'Jupiter', degree: 156.78, normDegree: 156.78, sign: 'Virgo', nakshatra: 'Hasta', house: 2, isRetro: false, isCombust: false, planet_awastha: 'Debilitated', awastha: 'Debilitated' },
        { id: 6, name: 'Venus', degree: 289.34, normDegree: 289.34, sign: 'Capricorn', nakshatra: 'Shravana', house: 6, isRetro: false, isCombust: false, planet_awastha: 'Neutral', awastha: 'Neutral' },
        { id: 7, name: 'Saturn', degree: 198.12, normDegree: 198.12, sign: 'Libra', nakshatra: 'Swati', house: 3, isRetro: true, isCombust: false, planet_awastha: 'Exalted', awastha: 'Exalted' }
      ],
      planetsExtended: [
        { id: 8, name: 'Rahu', degree: 78.90, normDegree: 78.90, sign: 'Cancer', nakshatra: 'Pushya', house: 12, isRetro: true, isCombust: false, planet_awastha: 'Neutral', awastha: 'Neutral' },
        { id: 9, name: 'Ketu', degree: 258.90, normDegree: 258.90, sign: 'Capricorn', nakshatra: 'Uttara Ashadha', house: 6, isRetro: true, isCombust: false, planet_awastha: 'Neutral', awastha: 'Neutral' }
      ]
    };
  }
}

const astrologyService = new AstrologyService();
export default astrologyService;
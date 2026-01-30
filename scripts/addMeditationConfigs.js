import mongoose from 'mongoose';
import dotenv from 'dotenv';
import SpiritualConfiguration from '../models/SpiritualConfiguration.js';

dotenv.config();

// Connect to MongoDB (same as server)
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/brahmkosh';
mongoose.connect(MONGODB_URI);

const addMeditationConfigs = async () => {
  try {
    const categoryId = '69787dfbbeaf7e42675a221d'; // Meditation activity ID
    const clientId = '696246d454570f232965ca29'; // From JWT token
    
    const configs = [
      {
        title: 'Morning Meditation',
        duration: '15 minutes',
        description: 'Start your day with peaceful meditation',
        emotion: 'calm',
        type: 'meditation',
        karmaPoints: 10,
        chantingType: '',
        customChantingType: '',
        isActive: true,
        isDeleted: false,
        clientId: clientId,
        categoryId: categoryId
      },
      {
        title: 'Evening Meditation',
        duration: '20 minutes',
        description: 'End your day with peaceful meditation',
        emotion: 'calm',
        type: 'meditation',
        karmaPoints: 15,
        chantingType: '',
        customChantingType: '',
        isActive: true,
        isDeleted: false,
        clientId: clientId,
        categoryId: categoryId
      },
      {
        title: 'Quick Meditation',
        duration: '5 minutes',
        description: 'Quick meditation for busy schedule',
        emotion: 'happy',
        type: 'meditation',
        karmaPoints: 5,
        chantingType: '',
        customChantingType: '',
        isActive: true,
        isDeleted: false,
        clientId: clientId,
        categoryId: categoryId
      }
    ];

    const result = await SpiritualConfiguration.insertMany(configs);
    console.log(`✅ Added ${result.length} meditation configurations`);
    console.log('Configurations:', result.map(c => ({ id: c._id, title: c.title })));
    
  } catch (error) {
    console.error('❌ Error adding configurations:', error);
  } finally {
    mongoose.connection.close();
  }
};

addMeditationConfigs();
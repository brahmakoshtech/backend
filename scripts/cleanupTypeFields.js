import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI;

const cleanupTypeFields = async () => {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    const db = mongoose.connection.db;
    const collection = db.collection('spiritualconfigurations');

    // Find all documents
    const docs = await collection.find({}).toArray();
    console.log(`Found ${docs.length} total documents`);

    let cleanedCount = 0;

    for (const doc of docs) {
      const unsetFields = {};
      
      // Remove empty chantingType if type is not chanting
      if (doc.type !== 'chanting' && doc.chantingType === '') {
        unsetFields.chantingType = '';
      }
      
      // Remove empty meditationType if type is not meditation
      if (doc.type !== 'meditation' && doc.meditationType === '') {
        unsetFields.meditationType = '';
      }
      
      // Remove empty prayerType if type is not prayer
      if (doc.type !== 'prayer' && doc.prayerType === '') {
        unsetFields.prayerType = '';
      }
      
      // Remove customChantingType field completely
      if (doc.customChantingType !== undefined) {
        unsetFields.customChantingType = '';
      }

      if (Object.keys(unsetFields).length > 0) {
        await collection.updateOne(
          { _id: doc._id },
          { $unset: unsetFields }
        );
        console.log(`Cleaned: ${doc.title} (${doc.type}) - Removed: ${Object.keys(unsetFields).join(', ')}`);
        cleanedCount++;
      }
    }

    console.log(`\nCleanup completed successfully!`);
    console.log(`Total documents cleaned: ${cleanedCount}`);

  } catch (error) {
    console.error('Cleanup failed:', error);
  } finally {
    await mongoose.connection.close();
    console.log('Database connection closed');
  }
};

cleanupTypeFields();

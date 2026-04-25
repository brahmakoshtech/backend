// Run once to drop the duplicate email index from partners collection
// Usage: node scripts/fixPartnerIndex.js

import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const fixPartnerIndex = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const collection = mongoose.connection.db.collection('partners');
    const indexes = await collection.indexes();
    console.log('Current indexes:', indexes.map(i => `${i.name}: ${JSON.stringify(i.key)}`));

    // Drop the manually created email_1 index (keep the unique constraint index auto-created by Mongoose)
    try {
      await collection.dropIndex('email_1');
      console.log('Dropped duplicate email_1 index');
    } catch (err) {
      if (err.codeName === 'IndexNotFound') {
        console.log('email_1 index not found, nothing to drop');
      } else {
        throw err;
      }
    }

    const remaining = await collection.indexes();
    console.log('Remaining indexes:', remaining.map(i => `${i.name}: ${JSON.stringify(i.key)}`));

    await mongoose.connection.close();
    console.log('Done');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
};

fixPartnerIndex();

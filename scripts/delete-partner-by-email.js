/**
 * Migration Script: Delete Partner by Email
 *
 * Run with: node backend/scripts/delete-partner-by-email.js <email>
 * Example:  node backend/scripts/delete-partner-by-email.js partner@example.com
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import Partner from '../models/Partner.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/brahmakosh';

const runMigration = async () => {
  const email = process.argv[2];

  if (!email) {
    console.error('❌ Please provide an email address as argument.');
    console.error('   Usage: node backend/scripts/delete-partner-by-email.js <email>');
    process.exit(1);
  }

  try {
    console.log('🚀 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    const partner = await Partner.findOne({ email: email.toLowerCase().trim() });

    if (!partner) {
      console.log(`⚠️  No partner found with email: ${email}`);
      await mongoose.connection.close();
      process.exit(0);
    }

    console.log(`Found partner: ${partner.name || '(no name)'} (ID: ${partner._id})`);

    await Partner.deleteOne({ _id: partner._id });

    console.log(`✅ Partner deleted successfully.`);

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
};

runMigration();

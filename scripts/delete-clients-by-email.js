/**
 * Script: Delete Clients by Email
 * Run: node backend/scripts/delete-clients-by-email.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import Client from '../models/Client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../.env') });

const EMAILS_TO_DELETE = [
  'vijay.wiz@gmail.com',
];

const run = async () => {
  try {
    console.log('🚀 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected\n');

    for (const email of EMAILS_TO_DELETE) {
      const client = await Client.findOne({ email: email.toLowerCase().trim() });
      if (!client) {
        console.log(`⚠️  Not found: ${email}`);
        continue;
      }
      await Client.deleteOne({ _id: client._id });
      console.log(`🗑️  Deleted: ${email} (${client.businessName || client.fullName || 'no name'})`);
    }

    console.log('\n✅ Done.');
    await mongoose.connection.close();
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    await mongoose.connection.close();
    process.exit(1);
  }
};

run();

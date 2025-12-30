import Admin from '../models/Admin.js';
import dotenv from 'dotenv';

dotenv.config();

export const initializeSuperAdmin = async () => {
  try {
    const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL;
    const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD;

    if (!SUPER_ADMIN_EMAIL || !SUPER_ADMIN_PASSWORD) {
      console.warn('⚠️  SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD not set in .env file');
      return;
    }

    // Check if super admin already exists
    const existingSuperAdmin = await Admin.findOne({ 
      email: SUPER_ADMIN_EMAIL,
      role: 'super_admin'
    });

    if (existingSuperAdmin) {
      // Update password if it's different (for password changes in env)
      const isPasswordValid = await existingSuperAdmin.comparePassword(SUPER_ADMIN_PASSWORD);
      if (!isPasswordValid) {
        existingSuperAdmin.password = SUPER_ADMIN_PASSWORD;
        await existingSuperAdmin.save();
        console.log('✅ Super admin password updated');
      }
      console.log('✅ Super admin already exists');
      return;
    }

    // Create super admin
    const superAdmin = new Admin({
      email: SUPER_ADMIN_EMAIL,
      password: SUPER_ADMIN_PASSWORD,
      role: 'super_admin',
      isActive: true,
      loginApproved: true // Super admin always approved
    });

    await superAdmin.save();
    console.log('✅ Super admin created successfully');
  } catch (error) {
    console.error('❌ Error initializing super admin:', error.message);
  }
};


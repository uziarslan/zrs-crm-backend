/**
 * Seed script for ZRS CRM
 * Creates initial admin account and sample data
 * 
 * Usage: node scripts/seed.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Admin = require('../models/Admin');
const Manager = require('../models/Manager');
const Investor = require('../models/Investor');
const logger = require('../utils/logger');

async function seed() {
    try {
        // Connect to MongoDB
        await mongoose.connect(process.env.MONGODB_URI);
        logger.info('Connected to MongoDB');

        // Clear existing data (optional - comment out for production)
        // await Admin.deleteMany({});
        // await Manager.deleteMany({});
        // await Investor.deleteMany({});
        // logger.info('Cleared existing data');

        // Create super admin
        const existingAdmin = await Admin.findOne({ email: 'syedmaaz@zrscarstrading.com' });

        if (!existingAdmin) {
            const admin = await Admin.create({
                name: 'Maaz Shah',
                email: 'syedmaaz@zrscarstrading.com',
                passwordHash: '1100Apple!', // Will be hashed by pre-save hook
                role: 'admin',
                isActive: true
            });
            logger.info(`✓ Admin created: ${admin.email}`);
            logger.info('  Default password: 1100Apple!');
            logger.info('  ⚠️  CHANGE THIS PASSWORD IMMEDIATELY IN PRODUCTION!');
        } else {
            logger.info('✓ Admin already exists: syedmaaz@zrscarstrading.com');
        }

        // Create additional admins for testing dual approval
        const admin2Email = 'admin2@zrscarstrading.com';
        const existingAdmin2 = await Admin.findOne({ email: admin2Email });

        if (!existingAdmin2) {
            await Admin.create({
                name: 'Admin Two',
                email: admin2Email,
                passwordHash: '1100Apple!',
                role: 'admin',
                isActive: true
            });
            logger.info(`✓ Second admin created: ${admin2Email}`);
        }

        // Create sample active manager for testing
        const managerEmail = 'manager@zrscarstrading.com';
        const existingManager = await Manager.findOne({ email: managerEmail });

        if (!existingManager) {
            await Manager.create({
                name: 'Test Manager',
                email: managerEmail,
                role: 'manager',
                status: 'active', // Active for immediate testing
                createdBy: (await Admin.findOne())._id
            });
            logger.info(`✓ Manager created: ${managerEmail} (status: active)`);
            logger.info('  Use OTP login from frontend');
        }

        // Create sample active investor for testing
        const investorEmail = 'chaudhryuzairarslan2000@gmail.com';
        const existingInvestor = await Investor.findOne({ email: investorEmail });

        if (!existingInvestor) {
            await Investor.create({
                name: 'Chaudhry Uzair Arslan',
                email: investorEmail,
                role: 'investor',
                status: 'active',
                creditLimit: 500000, // AED 500,000
                utilizedAmount: 0,
                createdBy: (await Admin.findOne())._id
            });
            logger.info(`✓ Investor created: ${investorEmail} (status: active, credit: AED 500,000)`);
        }

        logger.info('\n✅ Seeding completed successfully!');
        logger.info('\n📝 Login Credentials:');
        logger.info('   Admin: syedmaaz@zrscarstrading.com / 1100Apple!');
        logger.info('   Admin2: admin2@zrscarstrading.com / 1100Apple!');
        logger.info('   Manager: manager@zrscarstrading.com (use OTP login)');
        logger.info('   Investor: chaudhryuzairarslan2000@gmail.com (use OTP login)');
        logger.info('\n⚠️  Remember to change default passwords in production!');

        process.exit(0);
    } catch (error) {
        logger.error('Seeding failed:', error);
        process.exit(1);
    }
}

seed();


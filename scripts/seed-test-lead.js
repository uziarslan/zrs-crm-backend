/**
 * Seed test data with a lead ready for purchase (without deleting existing data)
 * This creates a lead with all requirements met for testing the purchase flow
 * 
 * Usage: node scripts/seed-test-lead.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Admin = require('../models/Admin');
const Manager = require('../models/Manager');
const Investor = require('../models/Investor');
const Lead = require('../models/Lead');
const PurchaseOrder = require('../models/PurchaseOrder');
const logger = require('../utils/logger');

async function seedTestLead() {
    try {
        // Connect to MongoDB
        await mongoose.connect(process.env.MONGODB_URI);
        logger.info('Connected to MongoDB');

        // ===== FIND OR CREATE ADMIN =====
        let admin = await Admin.findOne({ email: 'admin@zrscarstrading.com' });
        if (!admin) {
            admin = await Admin.create({
                name: 'Super Admin',
                email: 'admin@zrscarstrading.com',
                passwordHash: 'Admin@123',
                role: 'admin',
                isActive: true
            });
            logger.info(`✓ Admin created: ${admin.email} (password: Admin@123)`);
        } else {
            logger.info(`✓ Admin exists: ${admin.email}`);
        }

        // ===== FIND OR CREATE INVESTOR =====
        let investor = await Investor.findOne({ email: 'investor@test.com' });
        if (!investor) {
            investor = await Investor.create({
                name: 'Test Investor',
                email: 'investor@test.com',
                role: 'investor',
                status: 'active',
                creditLimit: 1000000, // AED 1,000,000
                utilizedAmount: 0,
                createdBy: admin._id
            });
            logger.info(`✓ Investor created: ${investor.email} (credit: AED 1,000,000)`);
        } else {
            logger.info(`✓ Investor exists: ${investor.email} (credit: AED ${investor.creditLimit.toLocaleString()})`);
        }

        // ===== GENERATE UNIQUE LEAD ID =====
        const lastLead = await Lead.findOne({}, {}, { sort: { 'createdAt': -1 } });
        let nextLeadId = 1;
        if (lastLead && lastLead.leadId) {
            const match = lastLead.leadId.match(/L(\d+)/);
            if (match) {
                nextLeadId = parseInt(match[1]) + 1;
            }
        }
        const leadId = `L${String(nextLeadId).padStart(4, '0')}`;

        // ===== CREATE TEST LEAD IN INSPECTION =====
        const lead = await Lead.create({
            leadId: leadId,
            type: 'purchase',
            status: 'inspection',
            source: 'website',
            priority: 'medium',
            contactInfo: {
                name: 'Test Owner',
                phone: '+971501234567',
                email: 'owner@test.com'
            },
            vehicleInfo: {
                make: 'Toyota',
                model: 'Camry',
                year: 2020,
                color: 'White',
                mileage: 50000,
                vin: `TESTVIN${Date.now()}`,
                askingPrice: 60000
            },
            priceAnalysis: {
                minSellingPrice: 65000,
                maxSellingPrice: 70000,
                purchasedFinalPrice: 58000,
                updatedAt: new Date(),
                updatedBy: admin._id,
                updatedByModel: 'Admin'
            },
            approval: {
                status: 'approved',
                approvals: [
                    { adminId: admin._id, groupName: 'Management', approvedAt: new Date() },
                    { adminId: admin._id, groupName: 'Operations', approvedAt: new Date() }
                ]
            },
            investorAllocations: [{
                investorId: investor._id,
                percentage: 100,
                amount: 58000
            }],
            attachments: [
                {
                    category: 'inspectionReport',
                    fileName: 'inspection.pdf',
                    fileType: 'application/pdf',
                    fileSize: 100000,
                    url: 'https://via.placeholder.com/150/0000FF/808080?Text=Inspection+Report',
                    publicId: `test-inspection-${Date.now()}`,
                    uploadedBy: admin._id,
                    uploadedByModel: 'Admin',
                    uploadedAt: new Date()
                },
                {
                    category: 'registrationCard',
                    fileName: 'registration.pdf',
                    fileType: 'application/pdf',
                    fileSize: 50000,
                    url: 'https://via.placeholder.com/150/FF0000/808080?Text=Registration',
                    publicId: `test-registration-${Date.now()}`,
                    uploadedBy: admin._id,
                    uploadedByModel: 'Admin',
                    uploadedAt: new Date()
                },
                {
                    category: 'carPictures',
                    fileName: 'car1.jpg',
                    fileType: 'image/jpeg',
                    fileSize: 200000,
                    url: 'https://images.unsplash.com/photo-1542362567-b07e54358753?w=400',
                    publicId: `test-car1-${Date.now()}`,
                    uploadedBy: admin._id,
                    uploadedByModel: 'Admin',
                    uploadedAt: new Date()
                },
                {
                    category: 'onlineHistoryCheck',
                    fileName: 'history.pdf',
                    fileType: 'application/pdf',
                    fileSize: 80000,
                    url: 'https://via.placeholder.com/150/00FF00/808080?Text=History',
                    publicId: `test-history-${Date.now()}`,
                    uploadedBy: admin._id,
                    uploadedByModel: 'Admin',
                    uploadedAt: new Date()
                }
            ],
            assignedTo: admin._id,
            createdBy: admin._id,
            createdByModel: 'Admin'
        });

        // ===== GENERATE UNIQUE PO ID =====
        const lastPO = await PurchaseOrder.findOne({}, {}, { sort: { 'createdAt': -1 } });
        let nextPOId = 1;
        if (lastPO && lastPO.poId) {
            const match = lastPO.poId.match(/PO(\d+)/);
            if (match) {
                nextPOId = parseInt(match[1]) + 1;
            }
        }
        const poId = `PO${String(nextPOId).padStart(4, '0')}`;

        // ===== CREATE PURCHASE ORDER WITH COMPLETED DOCUSIGN =====
        const purchaseOrder = await PurchaseOrder.create({
            poId: poId,
            investorId: investor._id,
            amount: 58000,
            investorAllocations: [{
                investorId: investor._id,
                amount: 58000,
                percentage: 100
            }],
            docuSignEnvelopeId: `TEST-ENVELOPE-${Date.now()}`,
            docuSignStatus: 'completed',
            docuSignSentAt: new Date(),
            docuSignSignedAt: new Date(),
            status: 'completed',
            notes: `Purchase Order for lead ${lead.leadId}`,
            createdBy: admin._id,
            createdByModel: 'Admin'
        });

        // Link purchase order to lead
        lead.purchaseOrder = purchaseOrder._id;
        await lead.save();

        logger.info(`✓ Test lead created: ${lead.leadId}`);
        logger.info(`✓ Purchase order created: ${purchaseOrder.poId} (DocuSign: completed)`);

        logger.info('\n✅ Test data created successfully!');
        logger.info('\n📝 Login Credentials:');
        logger.info('   Admin: admin@zrscarstrading.com / Admin@123');
        logger.info('   Investor: investor@test.com (use OTP login)');
        logger.info('\n📋 Test Lead Details:');
        logger.info(`   Lead ID: ${lead.leadId}`);
        logger.info(`   Vehicle: ${lead.vehicleInfo.make} ${lead.vehicleInfo.model} ${lead.vehicleInfo.year}`);
        logger.info(`   Asking Price: AED ${lead.vehicleInfo.askingPrice.toLocaleString()}`);
        logger.info(`   Purchase Price: AED ${lead.priceAnalysis.purchasedFinalPrice.toLocaleString()}`);
        logger.info(`   Status: ${lead.status}`);
        logger.info(`   Investor: ${investor.name} (${investor.email})`);
        logger.info(`   All documents: ✓ Present`);
        logger.info(`   Purchase Order: ✓ Completed (DocuSign signed)`);
        logger.info('\n🎯 Ready to test:');
        logger.info('   1. Log in as admin@zrscarstrading.com');
        logger.info('   2. Go to Inspection tab');
        logger.info('   3. You should see the lead with "Purchase" button enabled');
        logger.info('   4. Click Purchase to convert to inventory');
        logger.info('   5. Check Investor Dashboard - should show the car');
        logger.info('   6. Check Investor Inventory - should show the car');
        logger.info('   7. Check Admin Dashboard - utilization should be updated');

        process.exit(0);
    } catch (error) {
        logger.error('Seed test lead failed:', error);
        process.exit(1);
    }
}

seedTestLead();

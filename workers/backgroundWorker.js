/**
 * Background Worker for ZRS CRM
 * Handles scheduled tasks like:
 * - OTP cleanup
 * - Follow-up reminders
 * - Weekly reports
 * - Webhook retries
 * 
 * Uses BullMQ for job queue management
 */

require('dotenv').config();
const { Queue, Worker } = require('bullmq');
const IORedis = require('ioredis');
const logger = require('../utils/logger');
const connectDB = require('../config/database');

// Import models
const Manager = require('../models/Manager');
const Investor = require('../models/Investor');
const FollowUp = require('../models/FollowUp');
const { sendFollowUpReminder } = require('../utils/emailService');

// Redis connection
const connection = new IORedis({
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    maxRetriesPerRequest: null
});

// Create queues
const reminderQueue = new Queue('reminders', { connection });
const cleanupQueue = new Queue('cleanup', { connection });
const reportQueue = new Queue('reports', { connection });

// ============================================
// WORKERS
// ============================================

/**
 * Reminder Worker - Process follow-up reminders
 */
const reminderWorker = new Worker(
    'reminders',
    async (job) => {
        logger.info(`Processing reminder job: ${job.id}`);

        const { followUpId } = job.data;

        const followUp = await FollowUp.findById(followUpId)
            .populate('managerId')
            .populate('leadId');

        if (!followUp || followUp.status !== 'pending') {
            logger.warn(`Follow-up ${followUpId} not found or not pending`);
            return;
        }

        // Check if due date is approaching (within 24 hours)
        const dueDate = new Date(followUp.dueDate);
        const now = new Date();
        const hoursUntilDue = (dueDate - now) / (1000 * 60 * 60);

        if (hoursUntilDue <= 24 && hoursUntilDue > 0) {
            // Send reminder email
            await sendFollowUpReminder(followUp.managerId.email, {
                managerName: followUp.managerId.name,
                leadName: followUp.leadId?.contactInfo?.name || 'Lead',
                followUpType: followUp.type,
                dueDate: followUp.dueDate,
                priority: followUp.priority
            });

            followUp.reminderSent = true;
            followUp.reminderSentAt = new Date();
            await followUp.save();

            logger.info(`Reminder sent for follow-up ${followUpId}`);
        }
    },
    { connection }
);

/**
 * Cleanup Worker - Clean expired OTPs and tokens
 */
const cleanupWorker = new Worker(
    'cleanup',
    async (job) => {
        logger.info(`Processing cleanup job: ${job.id}`);

        const now = new Date();

        // Clean expired OTPs for managers
        const managersWithExpiredOTP = await Manager.find({
            'otpMeta.expiresAt': { $lt: now }
        });

        for (const manager of managersWithExpiredOTP) {
            manager.otpMeta.lastOtp = undefined;
            manager.otpMeta.expiresAt = undefined;
            manager.otpMeta.attempts = 0;
            await manager.save();
        }

        // Clean expired OTPs for investors
        const investorsWithExpiredOTP = await Investor.find({
            'otpMeta.expiresAt': { $lt: now }
        });

        for (const investor of investorsWithExpiredOTP) {
            investor.otpMeta.lastOtp = undefined;
            investor.otpMeta.expiresAt = undefined;
            investor.otpMeta.attempts = 0;
            await investor.save();
        }

        // Clean expired invite tokens
        const managersWithExpiredInvite = await Manager.find({
            inviteTokenExpiry: { $lt: now },
            status: 'invited'
        });

        for (const manager of managersWithExpiredInvite) {
            manager.status = 'inactive';
            await manager.save();
        }

        logger.info(`Cleanup completed: ${managersWithExpiredOTP.length + investorsWithExpiredOTP.length} OTPs, ${managersWithExpiredInvite.length} invites`);
    },
    { connection }
);

/**
 * Report Worker - Generate and send weekly reports
 */
const reportWorker = new Worker(
    'reports',
    async (job) => {
        logger.info(`Processing report job: ${job.id}`);

        // TODO: Implement weekly report generation
        // 1. Gather sales statistics
        // 2. Gather inventory status
        // 3. Gather pending approvals
        // 4. Generate PDF/Excel report
        // 5. Email to admins

        logger.info('Weekly report generated (placeholder)');
    },
    { connection }
);

// ============================================
// JOB SCHEDULERS
// ============================================

/**
 * Schedule follow-up reminders
 * Runs every hour
 */
async function scheduleFollowUpReminders() {
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    // Find follow-ups due within next 24 hours
    const upcomingFollowUps = await FollowUp.find({
        status: 'pending',
        dueDate: { $gte: now, $lte: tomorrow },
        reminderSent: { $ne: true }
    });

    for (const followUp of upcomingFollowUps) {
        await reminderQueue.add('follow-up-reminder', {
            followUpId: followUp._id
        });
    }

    logger.info(`Scheduled ${upcomingFollowUps.length} follow-up reminders`);
}

/**
 * Schedule cleanup job
 * Runs every 6 hours
 */
async function scheduleCleanup() {
    await cleanupQueue.add('otp-cleanup', {}, {
        repeat: {
            every: 6 * 60 * 60 * 1000 // 6 hours
        }
    });

    logger.info('Cleanup job scheduled');
}

/**
 * Schedule weekly reports
 * Runs every Monday at 9 AM
 */
async function scheduleWeeklyReports() {
    await reportQueue.add('weekly-report', {}, {
        repeat: {
            pattern: '0 9 * * 1' // Cron: Every Monday at 9 AM
        }
    });

    logger.info('Weekly report job scheduled');
}

// ============================================
// EVENT LISTENERS
// ============================================

reminderWorker.on('completed', (job) => {
    logger.info(`Reminder job ${job.id} completed`);
});

reminderWorker.on('failed', (job, err) => {
    logger.error(`Reminder job ${job.id} failed:`, err);
});

cleanupWorker.on('completed', (job) => {
    logger.info(`Cleanup job ${job.id} completed`);
});

reportWorker.on('completed', (job) => {
    logger.info(`Report job ${job.id} completed`);
});

// ============================================
// INITIALIZATION
// ============================================

async function startWorker() {
    try {
        // Connect to MongoDB
        await connectDB();

        // Schedule recurring jobs
        await scheduleCleanup();
        await scheduleWeeklyReports();

        // Schedule follow-up reminders every hour
        setInterval(scheduleFollowUpReminders, 60 * 60 * 1000); // 1 hour
        scheduleFollowUpReminders(); // Run immediately on start

        logger.info('🚀 Background worker started successfully');
        logger.info('Workers active: reminders, cleanup, reports');
    } catch (error) {
        logger.error('Failed to start background worker:', error);
        process.exit(1);
    }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, closing workers...');
    await reminderWorker.close();
    await cleanupWorker.close();
    await reportWorker.close();
    await connection.quit();
    process.exit(0);
});

// Start the worker
if (require.main === module) {
    startWorker();
}

module.exports = {
    reminderQueue,
    cleanupQueue,
    reportQueue,
    scheduleFollowUpReminders
};


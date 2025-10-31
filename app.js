require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const connectDB = require('./config/database');
const logger = require('./utils/logger');
const errorHandler = require('./middleware/errorHandler');

// Import routes
const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const purchaseRoutes = require('./routes/purchaseRoutes');
const salesRoutes = require('./routes/salesRoutes');
const investorRoutes = require('./routes/investorRoutes');
const csaRoutes = require('./routes/csaRoutes');
const exportRoutes = require('./routes/exportRoutes');
const webhookRoutes = require('./routes/webhookRoutes');
const integrationRoutes = require('./routes/integrationRoutes');

const app = express();

// Connect to MongoDB
connectDB();

// Security middleware
app.use(helmet());
app.use(cors({
    origin: process.env.DOMAIN_FRONTEND || 'http://localhost:3000',
    credentials: true
}));

// Raw body middleware for DocuSign webhooks (must be before other body parsers)
app.use('/api/webhooks/docusign', express.raw({ type: '*/*', limit: '10mb' }), (req, res, next) => {
    // Store raw body for DocuSign webhook processing
    if (req.body) {
        req.rawBody = req.body.toString();
        console.log('🔧 Raw body middleware - Content-Type:', req.headers['content-type']);
        console.log('🔧 Raw body middleware - Raw body length:', req.rawBody.length);
        console.log('🔧 Raw body middleware - Raw body preview:', req.rawBody.substring(0, 200));

        // Try to parse as JSON
        try {
            req.body = JSON.parse(req.rawBody);
            console.log('🔧 Parsed as JSON successfully');
        } catch (jsonError) {
            // If JSON parsing fails, keep as raw body
            console.log('🔧 JSON parsing failed, keeping as raw body');
            req.body = { rawBody: req.rawBody };
        }
    } else {
        req.rawBody = '';
        req.body = {};
        console.log('🔧 No body data received');
    }
    next();
});

// Body parser middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging middleware
if (process.env.NODE_ENV === 'development') {
    app.use(morgan('dev'));
} else {
    app.use(morgan('combined', { stream: { write: message => logger.info(message.trim()) } }));
}

// Health check
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV
    });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/purchases', purchaseRoutes);
app.use('/api/v1/sales', salesRoutes);
app.use('/api/v1/investors', investorRoutes);
app.use('/api/v1/csa', csaRoutes);
app.use('/api/v1/export', exportRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/integrations', integrationRoutes);

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: 'Route not found',
        path: req.originalUrl
    });
});

// Global error handler
app.use(errorHandler);

// Start server
const PORT = process.env.PORT || 4000;
const server = app.listen(PORT, () => {
    logger.info(`🚀 ZRS CRM Server running on port ${PORT} in ${process.env.NODE_ENV} mode`);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
    logger.error(`Unhandled Rejection: ${err.message}`);
    server.close(() => process.exit(1));
});

// Graceful shutdown
process.on('SIGTERM', () => {
    logger.info('SIGTERM signal received: closing HTTP server');
    server.close(() => {
        logger.info('HTTP server closed');
    });
});

module.exports = app;


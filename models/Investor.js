const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const investorSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Name is required'],
        trim: true
    },
    email: {
        type: String,
        required: [true, 'Email is required'],
        unique: true,
        lowercase: true,
        trim: true,
        match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email']
    },
    role: {
        type: String,
        default: 'investor',
        enum: ['investor']
    },
    status: {
        type: String,
        enum: ['invited', 'active', 'inactive'],
        default: 'invited'
    },
    creditLimit: {
        type: Number,
        required: [true, 'Credit limit is required'],
        default: 0
    },
    utilizedAmount: {
        type: Number,
        default: 0
    },
    investments: [{
        leadId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Lead'
        },
        amount: Number,
        percentage: Number,
        date: {
            type: Date,
            default: Date.now
        },
        status: {
            type: String,
            enum: ['active', 'settled', 'cancelled'],
            default: 'active'
        }
    }],
    otpMeta: {
        lastOtp: String,
        expiresAt: Date,
        attempts: {
            type: Number,
            default: 0
        }
    },
    inviteToken: String,
    inviteTokenExpiry: Date,
    readOnlyPortalAccess: {
        type: Boolean,
        default: true
    },
    lastLoginAt: {
        type: Date
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Admin'
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

// Virtual for remaining credit
investorSchema.virtual('remainingCredit').get(function () {
    return this.creditLimit - this.utilizedAmount;
});

// Update timestamp
investorSchema.pre('save', function (next) {
    this.updatedAt = Date.now();
    next();
});

// Method to compare OTP (hashed in production, plain in development)
investorSchema.methods.compareOTP = async function (candidateOTP) {
    if (!this.otpMeta.lastOtp) return false;

    // In development mode, store OTP as plain text for easy testing
    if (process.env.NODE_ENV === 'development') {
        return candidateOTP === this.otpMeta.lastOtp;
    }

    // In production, use bcrypt hashing
    return await bcrypt.compare(candidateOTP, this.otpMeta.lastOtp);
};

// Method to set OTP (hashed in production, plain in development)
investorSchema.methods.setOTP = async function (otp, expiryMinutes = 10) {
    // In development mode, store OTP as plain text for easy database viewing
    if (process.env.NODE_ENV === 'development') {
        this.otpMeta.lastOtp = otp;
    } else {
        // In production, hash the OTP for security
        const salt = await bcrypt.genSalt(10);
        this.otpMeta.lastOtp = await bcrypt.hash(otp, salt);
    }

    this.otpMeta.expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);
    this.otpMeta.attempts = 0;
};

// Check if OTP is expired
investorSchema.methods.isOTPExpired = function () {
    return !this.otpMeta.expiresAt || this.otpMeta.expiresAt < new Date();
};

// Remove sensitive data from JSON output
investorSchema.methods.toJSON = function () {
    const obj = this.toObject();
    delete obj.otpMeta;
    delete obj.inviteToken;
    delete obj.inviteTokenExpiry;
    obj.remainingCredit = this.remainingCredit;
    return obj;
};

module.exports = mongoose.model('Investor', investorSchema);


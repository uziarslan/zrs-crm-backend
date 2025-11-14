const Admin = require('../models/Admin');
const Manager = require('../models/Manager');
const Investor = require('../models/Investor');
const { generateToken, generateInviteToken } = require('../utils/jwtHelper');
const { generateOTP, generateInviteToken: generateRandomToken } = require('../utils/otpHelper');
const { sendOTPEmail, sendInviteEmail } = require('../utils/emailService');
const { sendMailtrapEmail } = require('../services/mailtrapService');
const logger = require('../utils/logger');
const { logAuth, logUserManagement } = require('../utils/auditLogger');

/**
 * @desc    Admin login with email and password
 * @route   POST /api/auth/admin/login
 * @access  Public
 */
exports.adminLogin = async (req, res, next) => {
    try {
        const { email, password } = req.body;

        // Find admin
        const admin = await Admin.findOne({ email });
        if (!admin) {
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }

        // Check password
        const isMatch = await admin.comparePassword(password);
        if (!isMatch) {
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }

        // Check if admin is active
        if (!admin.isActive) {
            return res.status(403).json({
                success: false,
                message: 'Account is inactive. Please contact system administrator.'
            });
        }

        // Update last login
        admin.lastLoginAt = new Date();
        await admin.save();

        // Generate token
        const token = generateToken(admin);

        // Log successful login
        await logAuth(req, 'admin_login', `Admin ${admin.email} logged in successfully`, admin);

        res.status(200).json({
            success: true,
            token,
            user: {
                id: admin._id,
                name: admin.name,
                email: admin.email,
                role: admin.role,
                designation: admin.designation || null
            }
        });
    } catch (error) {
        logger.error('Admin login error:', error);
        next(error);
    }
};

/**
 * @desc    Request OTP for Manager/Investor login
 * @route   POST /api/auth/request-otp
 * @access  Public
 */
exports.requestOTP = async (req, res, next) => {
    try {
        const { email } = req.body;

        // Find user (Manager or Investor)
        let user = await Manager.findOne({ email });
        let userType = 'manager';

        if (!user) {
            user = await Investor.findOne({ email });
            userType = 'investor';
        }

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'No account found with this email'
            });
        }

        // Check if user is active
        if (user.status !== 'active') {
            return res.status(403).json({
                success: false,
                message: 'Account is not active. Please check your invitation email or contact administrator.'
            });
        }

        // Generate OTP
        const otp = generateOTP();

        // Save OTP to user (hashed in production, plain in development)
        await user.setOTP(otp, 10); // 10 minutes expiry
        await user.save();

        // Send OTP via Mailtrap email
        if (process.env.LOGIN_VERIFICATION_CODE_ID) {
            try {
                const roleDisplayName = userType.charAt(0).toUpperCase() + userType.slice(1);
                await sendMailtrapEmail({
                    templateUuid: process.env.LOGIN_VERIFICATION_CODE_ID,
                    templateVariables: {
                        name: user.name,
                        role: roleDisplayName,
                        otp_code: otp,
                        year: new Date().getFullYear().toString()
                    },
                    recipients: [user.email]
                });
                logger.info(`OTP email sent to ${email} (${userType}) via Mailtrap`);
            } catch (emailError) {
                logger.error(`Failed to send OTP email via Mailtrap to ${email}:`, emailError);
                throw new Error(`Failed to send OTP email: ${emailError.message}`);
            }
        } else {
            throw new Error('LOGIN_VERIFICATION_CODE_ID not configured in environment variables. Please configure Mailtrap template ID.');
        }

        res.status(200).json({
            success: true,
            message: 'OTP sent to your email'
        });
    } catch (error) {
        logger.error('Request OTP error:', error);
        next(error);
    }
};

/**
 * @desc    Verify OTP and login Manager/Investor
 * @route   POST /api/auth/verify-otp
 * @access  Public
 */
exports.verifyOTP = async (req, res, next) => {
    try {
        const { email, otp } = req.body;

        // Find user (Manager or Investor)
        let user = await Manager.findOne({ email });
        let userType = 'manager';

        if (!user) {
            user = await Investor.findOne({ email });
            userType = 'investor';
        }

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'No account found with this email'
            });
        }

        // Check if OTP exists
        if (!user.otpMeta.lastOtp) {
            return res.status(400).json({
                success: false,
                message: 'No OTP found. Please request a new one.'
            });
        }

        // Check if OTP is expired
        if (user.isOTPExpired()) {
            return res.status(400).json({
                success: false,
                message: 'OTP has expired. Please request a new one.'
            });
        }

        // Check attempts
        if (user.otpMeta.attempts >= 5) {
            return res.status(429).json({
                success: false,
                message: 'Too many failed attempts. Please request a new OTP.'
            });
        }

        // Verify OTP
        const isValid = await user.compareOTP(otp);

        if (!isValid) {
            user.otpMeta.attempts += 1;
            await user.save();

            return res.status(401).json({
                success: false,
                message: `Invalid OTP. ${5 - user.otpMeta.attempts} attempts remaining.`
            });
        }

        // Clear OTP after successful verification
        user.otpMeta.lastOtp = undefined;
        user.otpMeta.expiresAt = undefined;
        user.otpMeta.attempts = 0;
        user.lastLoginAt = new Date();
        await user.save();

        // Generate token
        const token = generateToken(user);

        logger.info(`Successful OTP login for ${email} (${userType})`);

        // Log successful login
        await logAuth(req, `${userType}_login`, `${userType.charAt(0).toUpperCase() + userType.slice(1)} ${user.email} logged in via OTP`, user);

        res.status(200).json({
            success: true,
            token,
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role
            }
        });
    } catch (error) {
        logger.error('Verify OTP error:', error);
        next(error);
    }
};

/**
 * @desc    Get current logged-in user
 * @route   GET /api/auth/user
 * @access  Private
 */
exports.getCurrentUser = async (req, res, next) => {
    try {
        // Fetch fresh user data from database to get latest designation
        let freshUser = null;
        if (req.userRole === 'admin') {
            freshUser = await Admin.findById(req.user._id);
        } else if (req.userRole === 'manager') {
            freshUser = await Manager.findById(req.user._id);
        } else if (req.userRole === 'investor') {
            freshUser = await Investor.findById(req.user._id);
        }

        const userData = {
            id: req.user._id,
            name: req.user.name,
            email: req.user.email,
            role: req.user.role || req.userRole,
            status: req.user.status,
            lastLoginAt: req.user.lastLoginAt
        };

        // Include designation for admin users
        if (req.userRole === 'admin' && freshUser) {
            userData.designation = freshUser.designation || null;
        }

        res.status(200).json({
            success: true,
            user: userData
        });
    } catch (error) {
        logger.error('Get current user error:', error);
        next(error);
    }
};

/**
 * @desc    Admin invites Manager or Investor
 * @route   POST /api/auth/invite
 * @access  Private (Admin only)
 */
exports.inviteUser = async (req, res, next) => {
    try {
        const {
            email,
            role,
            name,
            creditLimit,
            decidedPercentageMin,
            decidedPercentageMax,
            decidedPercentage
        } = req.body;

        // Check if user already exists
        const existingManager = await Manager.findOne({ email });
        const existingInvestor = await Investor.findOne({ email });
        const existingAdmin = await Admin.findOne({ email });

        if (existingManager || existingInvestor || existingAdmin) {
            return res.status(400).json({
                success: false,
                message: 'User with this email already exists'
            });
        }

        const parsedCreditLimit =
            creditLimit === undefined || creditLimit === null ? 0 : Number(creditLimit);
        if (Number.isNaN(parsedCreditLimit) || parsedCreditLimit < 0) {
            return res.status(400).json({
                success: false,
                message: 'Credit limit must be a non-negative number'
            });
        }

        let parsedDecidedPercentageMin =
            decidedPercentageMin === undefined || decidedPercentageMin === null
                ? undefined
                : Number(decidedPercentageMin);
        let parsedDecidedPercentageMax =
            decidedPercentageMax === undefined || decidedPercentageMax === null
                ? undefined
                : Number(decidedPercentageMax);

        if (parsedDecidedPercentageMin === undefined && parsedDecidedPercentageMax === undefined && decidedPercentage !== undefined) {
            const fallback = Number(decidedPercentage);
            parsedDecidedPercentageMin = fallback;
            parsedDecidedPercentageMax = fallback;
        }

        if (parsedDecidedPercentageMin === undefined) parsedDecidedPercentageMin = 0;
        if (parsedDecidedPercentageMax === undefined) parsedDecidedPercentageMax = parsedDecidedPercentageMin;

        if (
            Number.isNaN(parsedDecidedPercentageMin) ||
            Number.isNaN(parsedDecidedPercentageMax) ||
            parsedDecidedPercentageMin < 0 ||
            parsedDecidedPercentageMin > 100 ||
            parsedDecidedPercentageMax < 0 ||
            parsedDecidedPercentageMax > 100
        ) {
            return res.status(400).json({
                success: false,
                message: 'Decided percentage must be between 0 and 100'
            });
        }

        if (parsedDecidedPercentageMin > parsedDecidedPercentageMax) {
            return res.status(400).json({
                success: false,
                message: 'Minimum decided percentage cannot be greater than maximum decided percentage'
            });
        }

        // Generate invite token
        const inviteToken = generateRandomToken();
        const inviteTokenExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

        let user;

        if (role === 'manager') {
            user = await Manager.create({
                name: name || email.split('@')[0],
                email,
                role: 'manager',
                status: 'invited',
                inviteToken,
                inviteTokenExpiry,
                createdBy: req.userId
            });
        } else if (role === 'investor') {
            user = await Investor.create({
                name: name || email.split('@')[0],
                email,
                role: 'investor',
                status: 'invited',
                creditLimit: parsedCreditLimit,
                decidedPercentageMin: parsedDecidedPercentageMin,
                decidedPercentageMax: parsedDecidedPercentageMax,
                inviteToken,
                inviteTokenExpiry,
                createdBy: req.userId
            });
        } else {
            return res.status(400).json({
                success: false,
                message: 'Invalid role. Must be manager or investor.'
            });
        }

        // Generate invite link (same as activation link)
        const inviteLink = `${process.env.DOMAIN_FRONTEND || process.env.DOMAIN_BACKEND || 'http://localhost:3000'}/invite/${inviteToken}`;

        // Send activation email via Mailtrap for all roles
        if (process.env.USER_ACCOUNT_ACTIVATION_ID) {
            try {
                const roleDisplayName = role.charAt(0).toUpperCase() + role.slice(1);
                await sendMailtrapEmail({
                    templateUuid: process.env.USER_ACCOUNT_ACTIVATION_ID,
                    templateVariables: {
                        name: user.name,
                        role: roleDisplayName,
                        activation_link: inviteLink,
                        year: new Date().getFullYear().toString()
                    },
                    recipients: [user.email]
                });
                logger.info(`Activation email sent to ${user.email} for ${role} account via Mailtrap`);
            } catch (emailError) {
                logger.error(`Failed to send Mailtrap activation email to ${user.email}:`, emailError);
                throw new Error(`Failed to send activation email via Mailtrap: ${emailError.message}`);
            }
        } else {
            throw new Error('USER_ACCOUNT_ACTIVATION_ID not configured in environment variables. Please configure Mailtrap template ID.');
        }

        logger.info(`Invite sent to ${email} as ${role} by admin ${req.userId}`);

        // Log invitation
        await logUserManagement(req, 'user_invited', `Invited ${email} as ${role}`, user, {
            role,
            creditLimit: role === 'investor' ? parsedCreditLimit : null,
            decidedPercentageMin: role === 'investor' ? parsedDecidedPercentageMin : null,
            decidedPercentageMax: role === 'investor' ? parsedDecidedPercentageMax : null
        });

        res.status(201).json({
            success: true,
            message: 'Invitation sent successfully',
            data: {
                inviteId: user._id,
                email: user.email,
                role: user.role,
                status: user.status
            }
        });
    } catch (error) {
        logger.error('Invite user error:', error);
        next(error);
    }
};

/**
 * @desc    Accept invitation and activate account (for Manager/Investor/Admin)
 * @route   POST /api/auth/accept-invite/:token
 * @access  Public
 */
exports.acceptInvite = async (req, res, next) => {
    try {
        const { token } = req.params;

        // Find user with this token - check Admin first, then Manager, then Investor
        let user = await Admin.findOne({
            activationToken: token,
            activationTokenExpiry: { $gt: Date.now() }
        });

        let userType = 'admin';

        if (!user) {
            user = await Manager.findOne({
                inviteToken: token,
                inviteTokenExpiry: { $gt: Date.now() }
            });
            userType = 'manager';
        }

        if (!user) {
            user = await Investor.findOne({
                inviteToken: token,
                inviteTokenExpiry: { $gt: Date.now() }
            });
            userType = 'investor';
        }

        if (!user) {
            return res.status(400).json({
                success: false,
                message: 'Invalid or expired invitation token'
            });
        }

        // Activate account
        if (userType === 'admin') {
            user.isActive = true;
            user.activationToken = undefined;
            user.activationTokenExpiry = undefined;
        } else {
            user.status = 'active';
            user.inviteToken = undefined;
            user.inviteTokenExpiry = undefined;
        }
        await user.save();

        logger.info(`${userType} ${user.email} accepted invitation and activated account`);

        res.status(200).json({
            success: true,
            message: 'Account activated successfully. You can now login.',
            data: {
                email: user.email,
                role: user.role
            }
        });
    } catch (error) {
        logger.error('Accept invite error:', error);
        next(error);
    }
};


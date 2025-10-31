const nodemailer = require('nodemailer');
const logger = require('./logger');

/**
 * Create email transporter
 */
const createTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.EMAIL_SMTP_HOST,
    port: process.env.EMAIL_SMTP_PORT || 587,
    secure: false, // true for 465, false for other ports
    auth: {
      user: process.env.EMAIL_SMTP_USER,
      pass: process.env.EMAIL_SMTP_PASS
    }
  });
};

/**
 * Send OTP email
 * @param {string} email - Recipient email
 * @param {string} otp - OTP code
 * @param {string} name - Recipient name
 */
exports.sendOTPEmail = async (email, otp, name = 'User') => {
  try {
    const emailSubject = 'Your Login OTP - ZRS CRM';
    const emailHTML = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            .otp-box { background: white; border: 2px dashed #667eea; padding: 20px; text-align: center; margin: 20px 0; border-radius: 5px; }
            .otp-code { font-size: 32px; font-weight: bold; color: #667eea; letter-spacing: 5px; }
            .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #777; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>ZRS Cars Trading CRM</h1>
            </div>
            <div class="content">
              <h2>Hello ${name},</h2>
              <p>You requested to login to ZRS CRM. Use the OTP code below to complete your login:</p>
              <div class="otp-box">
                <div class="otp-code">${otp}</div>
              </div>
              <p><strong>This code will expire in 10 minutes.</strong></p>
              <p>If you didn't request this code, please ignore this email.</p>
              <p>Best regards,<br>ZRS Cars Trading Team</p>
            </div>
            <div class="footer">
              <p>This is an automated email. Please do not reply.</p>
            </div>
          </div>
        </body>
        </html>
      `;

    // In development mode, log email to console instead of sending
    if (process.env.NODE_ENV === 'development') {
      console.log('\n' + '='.repeat(80));
      console.log('📧 EMAIL PREVIEW (Development Mode - Not Actually Sent)');
      console.log('='.repeat(80));
      console.log(`To: ${email}`);
      console.log(`Subject: ${emailSubject}`);
      console.log('─'.repeat(80));
      console.log(`\nHello ${name},\n`);
      console.log(`You requested to login to ZRS CRM. Use this OTP code:\n`);
      console.log(`   🔐 OTP CODE: ${otp}\n`);
      console.log(`This code will expire in 10 minutes.\n`);
      console.log(`If you didn't request this code, please ignore this email.\n`);
      console.log('─'.repeat(80));
      console.log('='.repeat(80) + '\n');

      logger.info(`OTP email logged to console for ${email} (development mode)`);
      return true;
    }

    // In production, actually send the email
    const transporter = createTransporter();
    const mailOptions = {
      from: `"ZRS Cars Trading CRM" <${process.env.EMAIL_SMTP_USER}>`,
      to: email,
      subject: emailSubject,
      html: emailHTML
    };

    await transporter.sendMail(mailOptions);
    logger.info(`OTP email sent to ${email}`);
    return true;
  } catch (error) {
    logger.error(`Failed to send OTP email to ${email}:`, error);
    throw new Error('Failed to send OTP email');
  }
};

/**
 * Send invite email
 * @param {string} email - Recipient email
 * @param {string} role - User role
 * @param {string} inviteLink - Invite link
 * @param {string} name - Recipient name
 */
exports.sendInviteEmail = async (email, role, inviteLink, name = 'User') => {
  try {
    const emailSubject = `You're Invited to ZRS CRM as ${role}`;
    const emailHTML = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            .button { display: inline-block; background: #667eea; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
            .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #777; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Welcome to ZRS CRM</h1>
            </div>
            <div class="content">
              <h2>Hello ${name},</h2>
              <p>You have been invited to join ZRS Cars Trading CRM as a <strong>${role}</strong>.</p>
              <p>Click the button below to activate your account:</p>
              <a href="${inviteLink}" class="button">Accept Invitation</a>
              <p><small>Or copy and paste this link: ${inviteLink}</small></p>
              <p>This invitation will expire in 7 days.</p>
              <p>Best regards,<br>ZRS Cars Trading Team</p>
            </div>
            <div class="footer">
              <p>This is an automated email. Please do not reply.</p>
            </div>
          </div>
        </body>
        </html>
      `;

    // Always send the email
    const transporter = createTransporter();
    const mailOptions = {
      from: `"ZRS Cars Trading CRM" <${process.env.EMAIL_SMTP_USER}>`,
      to: email,
      subject: emailSubject,
      html: emailHTML
    };

    await transporter.sendMail(mailOptions);
    logger.info(`Invite email sent to ${email}`);
    return true;
  } catch (error) {
    logger.error(`Failed to send invite email to ${email}:`, error);
    throw new Error('Failed to send invite email');
  }
};

/**
 * Send investor settlement email with profit breakdown
 * @param {string} email - Investor email
 * @param {Object} settlementData - Settlement details
 */
exports.sendInvestorSettlementEmail = async (email, settlementData) => {
  try {
    const {
      investorName,
      vehicleDetails,
      investmentAmount,
      investmentPercentage,
      profitAmount,
      profitPercentage,
      totalPayout,
      saleDate
    } = settlementData;

    const emailSubject = 'Investment Settlement Notification - ZRS CRM';
    const emailHTML = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            .detail-box { background: white; padding: 20px; margin: 15px 0; border-left: 4px solid #10b981; border-radius: 5px; }
            .highlight { font-size: 24px; font-weight: bold; color: #10b981; }
            .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #777; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Investment Settled</h1>
            </div>
            <div class="content">
              <h2>Dear ${investorName},</h2>
              <p>We're pleased to inform you that your investment has been settled successfully.</p>
              
              <div class="detail-box">
                <h3>Vehicle Details</h3>
                <p>${vehicleDetails}</p>
                <p><strong>Sale Date:</strong> ${new Date(saleDate).toLocaleDateString()}</p>
              </div>

              <div class="detail-box">
                <h3>Investment Breakdown</h3>
                <p><strong>Your Investment:</strong> AED ${investmentAmount.toLocaleString()} (${investmentPercentage}%)</p>
                <p><strong>Profit Amount:</strong> AED ${profitAmount.toLocaleString()}</p>
                <p><strong>Profit Percentage:</strong> ${profitPercentage.toFixed(2)}%</p>
                <p class="highlight">Total Payout: AED ${totalPayout.toLocaleString()}</p>
              </div>

              <p>Please login to your investor portal to view detailed statement of accounts.</p>
              <p>Best regards,<br>ZRS Cars Trading Team</p>
            </div>
            <div class="footer">
              <p>This is an automated email. Please do not reply.</p>
            </div>
          </div>
        </body>
        </html>
      `;

    // In development mode, log email to console
    if (process.env.NODE_ENV === 'development') {
      console.log('\n' + '='.repeat(80));
      console.log('📧 SETTLEMENT EMAIL PREVIEW (Development Mode - Not Actually Sent)');
      console.log('='.repeat(80));
      console.log(`To: ${email}`);
      console.log(`Subject: ${emailSubject}`);
      console.log('─'.repeat(80));
      console.log(`\nDear ${investorName},\n`);
      console.log(`Investment Settled Successfully!\n`);
      console.log(`Vehicle: ${vehicleDetails}`);
      console.log(`Sale Date: ${new Date(saleDate).toLocaleDateString()}\n`);
      console.log(`💰 BREAKDOWN:`);
      console.log(`   Your Investment: AED ${investmentAmount.toLocaleString()} (${investmentPercentage}%)`);
      console.log(`   Profit Amount: AED ${profitAmount.toLocaleString()}`);
      console.log(`   Profit Percentage: ${profitPercentage.toFixed(2)}%`);
      console.log(`   ✨ Total Payout: AED ${totalPayout.toLocaleString()}\n`);
      console.log('─'.repeat(80));
      console.log('='.repeat(80) + '\n');

      logger.info(`Settlement email logged to console for ${email} (development mode)`);
      return true;
    }

    // In production, actually send the email
    const transporter = createTransporter();
    const mailOptions = {
      from: `"ZRS Cars Trading CRM" <${process.env.EMAIL_SMTP_USER}>`,
      to: email,
      subject: emailSubject,
      html: emailHTML
    };

    await transporter.sendMail(mailOptions);
    logger.info(`Settlement email sent to ${email}`);
    return true;
  } catch (error) {
    logger.error(`Failed to send settlement email to ${email}:`, error);
    throw new Error('Failed to send settlement email');
  }
};

/**
 * Send follow-up reminder email
 * @param {string} email - Manager email
 * @param {Object} followUpData - Follow-up details
 */
exports.sendFollowUpReminder = async (email, followUpData) => {
  try {
    const transporter = createTransporter();

    const { managerName, leadName, followUpType, dueDate, priority } = followUpData;

    const mailOptions = {
      from: `"ZRS Cars Trading CRM" <${process.env.EMAIL_SMTP_USER}>`,
      to: email,
      subject: `Follow-up Reminder: ${leadName}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            .priority-high { color: #dc2626; font-weight: bold; }
            .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #777; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Follow-up Reminder</h1>
            </div>
            <div class="content">
              <h2>Hello ${managerName},</h2>
              <p>This is a reminder for your upcoming follow-up:</p>
              <p><strong>Lead:</strong> ${leadName}</p>
              <p><strong>Type:</strong> ${followUpType}</p>
              <p><strong>Due Date:</strong> ${new Date(dueDate).toLocaleString()}</p>
              <p class="${priority === 'high' || priority === 'urgent' ? 'priority-high' : ''}">
                <strong>Priority:</strong> ${priority.toUpperCase()}
              </p>
              <p>Please login to your dashboard to complete this follow-up.</p>
              <p>Best regards,<br>ZRS CRM System</p>
            </div>
            <div class="footer">
              <p>This is an automated email. Please do not reply.</p>
            </div>
          </div>
        </body>
        </html>
      `
    };

    await transporter.sendMail(mailOptions);
    logger.info(`Follow-up reminder sent to ${email}`);
    return true;
  } catch (error) {
    logger.error(`Failed to send follow-up reminder to ${email}:`, error);
    throw new Error('Failed to send follow-up reminder');
  }
};

/**
 * Send generic notification email
 * @param {string} email - Recipient email
 * @param {string} subject - Email subject
 * @param {string} message - Email message
 */
exports.sendNotificationEmail = async (email, subject, message) => {
  try {
    const transporter = createTransporter();

    const mailOptions = {
      from: `"ZRS Cars Trading CRM" <${process.env.EMAIL_SMTP_USER}>`,
      to: email,
      subject: subject,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #777; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>ZRS Cars Trading CRM</h1>
            </div>
            <div class="content">
              ${message}
              <p>Best regards,<br>ZRS Cars Trading Team</p>
            </div>
            <div class="footer">
              <p>This is an automated email. Please do not reply.</p>
            </div>
          </div>
        </body>
        </html>
      `
    };

    await transporter.sendMail(mailOptions);
    logger.info(`Notification email sent to ${email}`);
    return true;
  } catch (error) {
    logger.error(`Failed to send notification email to ${email}:`, error);
    throw new Error('Failed to send notification email');
  }
};


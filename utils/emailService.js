const nodemailer = require('nodemailer');

// Create transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Send OTP email
const sendOTPEmail = async (email, otp) => {
  try {
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'MoGallery - Email Verification OTP',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="margin: 0; font-size: 28px;">MoGallery</h1>
            <p style="margin: 10px 0 0 0; opacity: 0.9;">Email Verification</p>
          </div>
          
          <div style="background: #f8f9fa; padding: 30px; border-radius: 0 0 10px 10px;">
            <h2 style="color: #333; margin-bottom: 20px;">Verify Your Email Address</h2>
            
            <p style="color: #666; line-height: 1.6; margin-bottom: 25px;">
              Thank you for signing up with MoGallery! To complete your registration, 
              please enter the following verification code:
            </p>
            
            <div style="background: #fff; border: 2px solid #667eea; border-radius: 8px; padding: 20px; text-align: center; margin: 25px 0;">
              <h1 style="color: #667eea; font-size: 32px; margin: 0; letter-spacing: 5px; font-weight: bold;">${otp}</h1>
            </div>
            
            <p style="color: #666; line-height: 1.6; margin-bottom: 20px;">
              This code will expire in <strong>10 minutes</strong>. If you didn't request this verification, 
              please ignore this email.
            </p>
            
            <div style="text-align: center; margin-top: 30px;">
              <p style="color: #999; font-size: 14px;">
                Best regards,<br>
                The MoGallery Team
              </p>
            </div>
          </div>
        </div>
      `
    };

    const result = await transporter.sendMail(mailOptions);
    console.log('OTP email sent successfully:', result.messageId);
    return true;
  } catch (error) {
    console.error('Error sending OTP email:', error);
    return false;
  }
};

// Verify email configuration
const verifyEmailConfig = async () => {
  try {
    await transporter.verify();
    console.log('Email configuration is valid');
    return true;
  } catch (error) {
    console.error('Email configuration error:', error);
    return false;
  }
};

// Send folder sharing notification email
const sendFolderShareEmail = async (email, folderName, ownerEmail, permission, folderLink) => {
  try {
    const permissionText = permission === 'upload' ? 'upload files to' : 'view';
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: `MoGallery - Folder Shared: ${folderName}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="margin: 0; font-size: 28px;">MoGallery</h1>
            <p style="margin: 10px 0 0 0; opacity: 0.9;">Folder Shared</p>
          </div>
          
          <div style="background: #f8f9fa; padding: 30px; border-radius: 0 0 10px 10px;">
            <h2 style="color: #333; margin-bottom: 20px;">You've been granted access to a folder!</h2>
            
            <p style="color: #666; line-height: 1.6; margin-bottom: 25px;">
              <strong>${ownerEmail}</strong> has shared the folder <strong>"${folderName}"</strong> with you.
            </p>
            
            <div style="background: #fff; border: 2px solid #667eea; border-radius: 8px; padding: 20px; text-align: center; margin: 25px 0;">
              <h3 style="color: #667eea; margin: 0 0 10px 0;">Your Permission Level</h3>
              <p style="color: #333; font-size: 18px; margin: 0; font-weight: bold;">
                ${permission === 'upload' ? '📤 Upload & View' : '👁️ View Only'}
              </p>
            </div>
            
            <p style="color: #666; line-height: 1.6; margin-bottom: 25px;">
              You can now ${permissionText} this folder. Click the button below to access it:
            </p>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${folderLink}" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">
                📂 Open Folder
              </a>
            </div>
            
            <p style="color: #666; line-height: 1.6; margin-bottom: 20px; font-size: 14px;">
              If you don't have a MoGallery account yet, you'll need to sign up first to access the shared folder.
            </p>
            
            <div style="text-align: center; margin-top: 30px;">
              <p style="color: #999; font-size: 14px;">
                Best regards,<br>
                The MoGallery Team
              </p>
            </div>
          </div>
        </div>
      `
    };

    const result = await transporter.sendMail(mailOptions);
    console.log('Folder share email sent successfully:', result.messageId);
    return true;
  } catch (error) {
    console.error('Error sending folder share email:', error);
    return false;
  }
};

// Send media sharing notification email
const sendMediaShareEmail = async (email, mediaName, ownerEmail, viewOnce, mediaLink, message) => {
  try {
    const viewOnceText = viewOnce ? 'View-Once' : 'Permanent';
    const viewOnceDescription = viewOnce 
      ? 'This media can only be viewed once. After viewing, it will be automatically hidden.'
      : 'You can view this media multiple times.';
    
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: `MoGallery - Media Shared: ${mediaName}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="margin: 0; font-size: 28px;">MoGallery</h1>
            <p style="margin: 10px 0 0 0; opacity: 0.9;">Media Shared</p>
          </div>
          
          <div style="background: #f8f9fa; padding: 30px; border-radius: 0 0 10px 10px;">
            <h2 style="color: #333; margin-bottom: 20px;">You've been shared a media file!</h2>
            
            <p style="color: #666; line-height: 1.6; margin-bottom: 25px;">
              <strong>${ownerEmail}</strong> has shared <strong>"${mediaName}"</strong> with you.
            </p>
            
            ${message ? `
            <div style="background: #fff; border-left: 4px solid #667eea; padding: 15px; margin: 20px 0; border-radius: 4px;">
              <p style="color: #333; margin: 0; font-style: italic;">"${message}"</p>
            </div>
            ` : ''}
            
            <div style="background: #fff; border: 2px solid #667eea; border-radius: 8px; padding: 20px; text-align: center; margin: 25px 0;">
              <h3 style="color: #667eea; margin: 0 0 10px 0;">Access Type</h3>
              <p style="color: #333; font-size: 18px; margin: 0; font-weight: bold;">
                ${viewOnce ? '🔒 View-Once' : '👁️ Permanent Access'}
              </p>
              <p style="color: #666; font-size: 14px; margin: 10px 0 0 0;">
                ${viewOnceDescription}
              </p>
            </div>
            
            <p style="color: #666; line-height: 1.6; margin-bottom: 25px;">
              Click the button below to view the shared media:
            </p>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${mediaLink}" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">
                ${viewOnce ? '🔒 View Media (Once)' : '👁️ View Media'}
              </a>
            </div>
            
            <p style="color: #666; line-height: 1.6; margin-bottom: 20px; font-size: 14px;">
              If you don't have a MoGallery account yet, you'll need to sign up first to access the shared media.
            </p>
            
            <div style="text-align: center; margin-top: 30px;">
              <p style="color: #999; font-size: 14px;">
                Best regards,<br>
                The MoGallery Team
              </p>
            </div>
          </div>
        </div>
      `
    };

    const result = await transporter.sendMail(mailOptions);
    console.log('Media share email sent successfully:', result.messageId);
    return true;
  } catch (error) {
    console.error('Error sending media share email:', error);
    return false;
  }
};

module.exports = {
  sendOTPEmail,
  sendFolderShareEmail,
  sendMediaShareEmail,
  verifyEmailConfig
};

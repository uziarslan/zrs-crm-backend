const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_KEY,
  api_secret: process.env.CLOUDINARY_SECRET,
  secure: true,
  upload_prefix: 'https://api.cloudinary.com'
});

// Configure Cloudinary Storage with Image Compression and Resizing
const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => {
    const isPdf = file.mimetype === 'application/pdf';

    return {
      folder: "ZRS CRM",
      allowed_formats: ["jpeg", "png", "jpg", "pdf"],
      public_id: `${Date.now()}-${file.originalname.replace(/\.[^/.]+$/, "")}`,
      resource_type: isPdf ? 'raw' : 'image', // PDFs must be 'raw', images are 'image'
      transformation: isPdf ? undefined : [{ quality: "auto:low" }],
      chunk_size: 6000000 // 6MB chunks for large files
    };
  }
});

/**
 * Generate a backend proxy URL that forces PDFs to display inline
 * @param {string} url - Original Cloudinary URL
 * @param {string} fileType - MIME type of the file
 * @param {string} leadId - Lead document ID
 * @param {string} docId - Document ID within the lead
 * @returns {string} Modified URL for inline viewing
 */
const getInlineViewUrl = (url, fileType, leadId, docId) => {
  if (!url) return url;

  // For PDFs, use our backend proxy endpoint
  if (fileType === 'application/pdf' && leadId && docId) {
    const backendUrl = process.env.DOMAIN_BACKEND || 'http://localhost:4000';
    return `${backendUrl}/api/v1/purchases/leads/${leadId}/documents/${docId}/view`;
  }

  // For images, return original URL (direct from Cloudinary)
  return url;
};

module.exports = {
  cloudinary,
  storage,
  getInlineViewUrl
};

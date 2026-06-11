const path = require("path");
const fs = require("fs");
const config = require("../config");

const MAX_ARCHIVE_FILE_BYTES = config.maxFileBytes;
const ALLOWED_UPLOAD_MIME_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "message/rfc822",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const ALLOWED_UPLOAD_EXTENSIONS = new Set([".txt", ".md", ".text", ".eml", ".pdf", ".docx"]);
const MACH_O_SIGNATURES = new Set([0xfeedface, 0xcefaedfe, 0xfeedfacf, 0xcffaedfe]);

function hasExecutableMagic(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return false;
  if (buffer[0] === 0x4d && buffer[1] === 0x5a) return true;
  if (buffer[0] === 0x7f && buffer[1] === 0x45 && buffer[2] === 0x4c && buffer[3] === 0x46) return true;
  return MACH_O_SIGNATURES.has(buffer.readUInt32BE(0));
}

function looksLikeZip(buffer) {
  return Buffer.isBuffer(buffer)
    && buffer.length >= 4
    && buffer[0] === 0x50
    && buffer[1] === 0x4b
    && [0x03, 0x05, 0x07].includes(buffer[2])
    && [0x04, 0x06, 0x08].includes(buffer[3]);
}

function looksLikePdf(buffer) {
  return Buffer.isBuffer(buffer)
    && buffer.length >= 5
    && buffer.subarray(0, 5).toString("ascii") === "%PDF-";
}

function looksLikeText(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return false;
  if (buffer.includes(0x00)) return false;
  let suspiciousBytes = 0;
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  for (const byte of sample) {
    const printable = byte === 0x09 || byte === 0x0a || byte === 0x0d || (byte >= 0x20 && byte <= 0x7e) || byte >= 0x80;
    if (!printable) suspiciousBytes += 1;
  }
  return suspiciousBytes <= Math.max(4, Math.floor(sample.length * 0.02));
}

function validateUploadSignature(buffer, extension) {
  if (hasExecutableMagic(buffer)) {
    const error = new Error("Uploaded file signature does not match an allowed document type");
    error.statusCode = 400;
    throw error;
  }
  if (extension === ".docx" && !looksLikeZip(buffer)) {
    const error = new Error("DOCX upload failed signature validation");
    error.statusCode = 400;
    throw error;
  }
  if (extension === ".pdf" && !looksLikePdf(buffer)) {
    const error = new Error("PDF upload failed signature validation");
    error.statusCode = 400;
    throw error;
  }
  if ([".txt", ".md", ".text", ".eml"].includes(extension) && !looksLikeText(buffer)) {
    const error = new Error("Text upload failed signature validation");
    error.statusCode = 400;
    throw error;
  }
}

function validateUploadedPayload(payload = {}, allowedFileTypes = ["attachment"]) {
  const fileType = payload.fileType || "attachment";
  if (!allowedFileTypes.includes(fileType)) {
    const error = new Error(`Unsupported file type: ${fileType}`);
    error.statusCode = 400;
    throw error;
  }
  const originalName = String(payload.originalName || payload.name || "unnamed");
  const extension = path.extname(originalName).toLowerCase();
  if (!ALLOWED_UPLOAD_EXTENSIONS.has(extension)) {
    const error = new Error(`Unsupported file extension: ${extension || "(none)"}`);
    error.statusCode = 400;
    throw error;
  }
  const mimeType = String(payload.mimeType || "application/octet-stream").toLowerCase();
  if (!ALLOWED_UPLOAD_MIME_TYPES.has(mimeType)) {
    const error = new Error(`Unsupported mime type: ${mimeType}`);
    error.statusCode = 400;
    throw error;
  }
  const buffer = Buffer.from(payload.contentBase64 || "", "base64");
  if (!buffer.length) {
    const error = new Error("Uploaded file was empty");
    error.statusCode = 400;
    throw error;
  }
  if (buffer.length > MAX_ARCHIVE_FILE_BYTES) {
    const error = new Error(`Uploaded file exceeds ${MAX_ARCHIVE_FILE_BYTES} bytes`);
    error.statusCode = 413;
    throw error;
  }
  validateUploadSignature(buffer, extension);
  return { buffer, mimeType, originalName, fileType };
}

module.exports = {
  hasExecutableMagic,
  looksLikeZip,
  looksLikePdf,
  looksLikeText,
  validateUploadSignature,
  validateUploadedPayload,
  ALLOWED_UPLOAD_MIME_TYPES,
  ALLOWED_UPLOAD_EXTENSIONS,
  MACH_O_SIGNATURES,
};

import fs from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { IMAGE_MIME_TYPES, MAX_INLINE_FILE_BYTES } from './constants.js';

export async function extractTextFromImage({ filePath, config, debug, HumanError }) {
  if (!config.mistralApiKey) {
    throw new HumanError('Mistral API key required for OCR.');
  }

  const ext = path.extname(filePath).toLowerCase();
  const mimeType = IMAGE_MIME_TYPES[ext] || 'image/png';
  const buffer = await fs.readFile(filePath);

  if (buffer.length > MAX_INLINE_FILE_BYTES) {
    throw new HumanError('Image too large.', {
      tip: `Limit is 20MB. This image is ${Math.round(buffer.length / (1024 * 1024))}MB.`
    });
  }

  const pdfBuffer = await imageToPdfBuffer(buffer, mimeType);
  const dataUrl = `data:application/pdf;base64,${pdfBuffer.toString('base64')}`;

  const headers = {
    Authorization: `Bearer ${config.mistralApiKey}`,
    'Content-Type': 'application/json'
  };

  if (config.mistralOrgId) {
    headers['Mistral-Organization'] = config.mistralOrgId;
  }

  if (debug) debug('Calling Mistral OCR, bytes:', buffer.length);

  const response = await fetch('https://api.mistral.ai/v1/ocr', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: config.ocrModel || 'mistral-ocr-latest',
      document: { type: 'document_url', document_url: dataUrl }
    })
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new HumanError('Mistral OCR failed.', {
      technical: `${response.status} ${response.statusText}: ${raw.slice(0, 200)}`
    });
  }

  const data = JSON.parse(raw);
  const text = extractMistralOcrText(data);

  if (!text) {
    throw new HumanError('Could not read text from image.', {
      tip: 'Image may be too blurry or contain no text.'
    });
  }

  return text.trim();
}

async function imageToPdfBuffer(imageBuffer, mimeType) {
  const pdfDoc = await PDFDocument.create();
  let embedded;

  if (mimeType === 'image/png' || mimeType === 'image/webp' || mimeType === 'image/gif') {
    embedded = await pdfDoc.embedPng(imageBuffer);
  } else {
    embedded = await pdfDoc.embedJpg(imageBuffer);
  }

  const page = pdfDoc.addPage([embedded.width, embedded.height]);
  page.drawImage(embedded, { x: 0, y: 0, width: embedded.width, height: embedded.height });
  return Buffer.from(await pdfDoc.save());
}

function extractMistralOcrText(data) {
  const parts = [];
  const pages = data?.result?.pages || data?.pages;

  if (Array.isArray(pages)) {
    for (const page of pages) {
      const text = page?.text || page?.output_text || page?.content || page?.markdown;
      if (text) parts.push(String(text));
    }
  }

  if (data?.output_text) parts.push(String(data.output_text));
  if (data?.text) parts.push(String(data.text));
  if (data?.result?.text) parts.push(String(data.result.text));

  return parts.map((v) => v.trim()).filter(Boolean).join('\n\n');
}


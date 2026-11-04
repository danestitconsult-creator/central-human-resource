// Evidence of visit: photos are shrunk in the browser and stored as text inside Firestore, so no paid
// Firebase Storage plan is needed. Firestore documents are limited to 1 MB, hence the size limits below.
export const EV_LIMITS = { files: 25, maxChars: 880000, pdfBytes: 600 * 1024 };
export const EV_CATEGORIES = [
  "Photo of the visit", "Attendance register", "Movement / permission book",
  "Signed findings or report", "Staff on site", "Other"
];

export const EV_CATEGORIES_EDTECH = [
  "Photo of the visit", "Equipment in store", "Serial numbers / asset labels",
  "Faulty or damaged equipment", "Allocation / issue register", "Signed findings or report", "Other"
];

const readDataUrl = file => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error || new Error("Could not read the file."));
  r.readAsDataURL(file);
});
const loadImage = src => new Promise((resolve, reject) => {
  const im = new Image();
  im.onload = () => resolve(im);
  im.onerror = () => reject(new Error("That image format can't be read. Use a JPEG or PNG photo."));
  im.src = src;
});

// Shrinks until it fits: longest side 1400px at first, then smaller and lower quality if needed.
async function compressImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    let max = 1400, quality = 0.75;
    for (let i = 0; i < 6; i++) {
      const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale)), h = Math.max(1, Math.round(img.naturalHeight * scale));
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      const data = c.toDataURL("image/jpeg", quality);
      if (data.length <= EV_LIMITS.maxChars) return { data, width: w, height: h };
      max = Math.round(max * 0.8); quality = Math.max(0.5, quality - 0.07);
    }
    throw new Error("That photo is too large to store, even after shrinking.");
  } finally { URL.revokeObjectURL(url); }
}

// Returns { kind, mime, data, name, size } ready to save, or throws an Error with a message fit to show the person.
export async function prepareEvidenceFile(file) {
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (isPdf) {
    if (file.size > EV_LIMITS.pdfBytes) throw new Error(`"${file.name}" is too large (PDFs up to ${Math.round(EV_LIMITS.pdfBytes / 1024)} KB). Photograph the pages instead.`);
    return { kind: "pdf", mime: "application/pdf", data: await readDataUrl(file), name: file.name, size: file.size };
  }
  if (file.type.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) {
    const { data, width, height } = await compressImage(file);
    return { kind: "image", mime: "image/jpeg", data, name: file.name, size: Math.round(data.length * 0.75), width, height };
  }
  throw new Error(`"${file.name}" is not a photo or a PDF.`);
}

export function dataUrlToBlob(dataUrl) {
  const [head, body] = dataUrl.split(",");
  const mime = (head.match(/:(.*?);/) || [])[1] || "application/octet-stream";
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export const fmtSize = n => (n < 1024 ? n + " B" : n < 1048576 ? Math.round(n / 1024) + " KB" : (n / 1048576).toFixed(1) + " MB");

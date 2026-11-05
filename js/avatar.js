// Profile photo: centre-cropped to a square and shrunk in the browser, then stored as text on the person's own
// profile document (no paid Firebase Storage plan needed). About 15 to 40 KB, far below Firestore's 1 MB limit.
export const AVATAR = { size: 256, maxChars: 120000 };

const loadImage = src => new Promise((resolve, reject) => {
  const im = new Image();
  im.onload = () => resolve(im);
  im.onerror = () => reject(new Error("That image format can't be read. Use a JPEG or PNG photo."));
  im.src = src;
});

export async function prepareAvatar(file) {
  if (!file || !(file.type.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name || ""))) throw new Error("Choose a photo (JPEG or PNG).");
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const sx = (img.naturalWidth - side) / 2, sy = (img.naturalHeight - side) / 2;
    let size = AVATAR.size, quality = 0.85;
    for (let i = 0; i < 5; i++) {
      const c = document.createElement("canvas");
      c.width = c.height = size;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, size, size);
      ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
      const data = c.toDataURL("image/jpeg", quality);
      if (data.length <= AVATAR.maxChars) return data;
      size = Math.round(size * 0.8); quality = Math.max(0.6, quality - 0.08);
    }
    throw new Error("That photo is too large to store.");
  } finally { URL.revokeObjectURL(url); }
}

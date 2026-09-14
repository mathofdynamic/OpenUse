import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import { deflateSync, inflateSync } from "node:zlib";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = resolve(repositoryRoot, "app-logo", "logo.png");
const outputPath = resolve(repositoryRoot, "apps", "desktop", ".build", "windows", "OpenUse.ico");
const sourcePng = await readFile(sourcePath);
const source = decodePng(sourcePng);
if (source.width !== source.height || source.width === 0) throw new Error(`The Windows icon source must be square: ${source.width}x${source.height}.`);
const png = encodePng(resizeRgba(source, 256, 256));
const width = 256;
const height = 256;

const directory = Buffer.alloc(22);
directory.writeUInt16LE(0, 0);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(1, 4);
directory.writeUInt8(width >= 256 ? 0 : width, 6);
directory.writeUInt8(height >= 256 ? 0 : height, 7);
directory.writeUInt8(0, 8);
directory.writeUInt8(0, 9);
directory.writeUInt16LE(1, 10);
directory.writeUInt16LE(32, 12);
directory.writeUInt32LE(png.length, 14);
directory.writeUInt32LE(directory.length, 18);

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, Buffer.concat([directory, png]));
console.log(`Windows icon ........ ${outputPath}`);
console.log(`Source .............. ${sourcePath} (${source.width}x${source.height})`);

function decodePng(value) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!value.subarray(0, signature.length).equals(signature)) throw new Error(`The Windows icon source is not a PNG: ${sourcePath}`);
  let offset = signature.length;
  let width;
  let height;
  let colorType;
  const imageData = [];
  while (offset + 12 <= value.length) {
    const length = value.readUInt32BE(offset);
    const type = value.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > value.length) throw new Error("The Windows icon source contains a truncated PNG chunk.");
    const data = value.subarray(dataStart, dataEnd);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const bitDepth = data[8];
      colorType = data[9];
      const interlaceMethod = data[12];
      if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6) || interlaceMethod !== 0) throw new Error("The Windows icon source must be an 8-bit, non-interlaced RGB/RGBA PNG.");
    } else if (type === "IDAT") {
      imageData.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset = dataEnd + 4;
  }
  if (!width || !height || !colorType || imageData.length === 0) throw new Error("The Windows icon source has no readable pixel data.");
  const channels = colorType === 6 ? 4 : 3;
  const rowBytes = width * channels;
  const decoded = inflateSync(Buffer.concat(imageData));
  const rgba = new Uint8Array(width * height * 4);
  let decodedOffset = 0;
  let previous = new Uint8Array(rowBytes);
  for (let y = 0; y < height; y += 1) {
    const filter = decoded[decodedOffset++];
    const row = new Uint8Array(decoded.subarray(decodedOffset, decodedOffset + rowBytes));
    decodedOffset += rowBytes;
    for (let x = 0; x < rowBytes; x += 1) {
      const left = x >= channels ? row[x - channels] : 0;
      const above = previous[x] ?? 0;
      const upperLeft = x >= channels ? previous[x - channels] ?? 0 : 0;
      if (filter === 1) row[x] = (row[x] + left) & 0xff;
      else if (filter === 2) row[x] = (row[x] + above) & 0xff;
      else if (filter === 3) row[x] = (row[x] + Math.floor((left + above) / 2)) & 0xff;
      else if (filter === 4) row[x] = (row[x] + paeth(left, above, upperLeft)) & 0xff;
      else if (filter !== 0) throw new Error(`Unsupported PNG row filter: ${filter}.`);
    }
    for (let x = 0; x < width; x += 1) {
      const input = x * channels;
      const output = (y * width + x) * 4;
      rgba[output] = row[input];
      rgba[output + 1] = row[input + 1];
      rgba[output + 2] = row[input + 2];
      rgba[output + 3] = channels === 4 ? row[input + 3] : 255;
    }
    previous = row;
  }
  return { width, height, rgba };
}

function resizeRgba(source, targetWidth, targetHeight) {
  const result = new Uint8Array(targetWidth * targetHeight * 4);
  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = (y + 0.5) * source.height / targetHeight - 0.5;
    const y0 = Math.max(0, Math.floor(sourceY));
    const y1 = Math.min(source.height - 1, y0 + 1);
    const yWeight = Math.max(0, Math.min(1, sourceY - y0));
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = (x + 0.5) * source.width / targetWidth - 0.5;
      const x0 = Math.max(0, Math.floor(sourceX));
      const x1 = Math.min(source.width - 1, x0 + 1);
      const xWeight = Math.max(0, Math.min(1, sourceX - x0));
      const output = (y * targetWidth + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        const topLeft = source.rgba[(y0 * source.width + x0) * 4 + channel];
        const topRight = source.rgba[(y0 * source.width + x1) * 4 + channel];
        const bottomLeft = source.rgba[(y1 * source.width + x0) * 4 + channel];
        const bottomRight = source.rgba[(y1 * source.width + x1) * 4 + channel];
        const top = topLeft + (topRight - topLeft) * xWeight;
        const bottom = bottomLeft + (bottomRight - bottomLeft) * xWeight;
        result[output + channel] = Math.round(top + (bottom - top) * yWeight);
      }
    }
  }
  return { width: targetWidth, height: targetHeight, rgba: result };
}

function encodePng(image) {
  const rows = Buffer.alloc((image.width * 4 + 1) * image.height);
  for (let y = 0; y < image.height; y += 1) rows.set(image.rgba.subarray(y * image.width * 4, (y + 1) * image.width * 4), y * (image.width * 4 + 1) + 1);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header[8] = 8;
  header[9] = 6;
  const compressed = deflateSync(rows, { level: 9 });
  return Buffer.concat([signature, pngChunk("IHDR", header), pngChunk("IDAT", compressed), pngChunk("IEND", Buffer.alloc(0))]);
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBuffer.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return chunk;
}

function crc32(value) {
  let crc = 0xffffffff;
  for (const byte of value) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function paeth(left, above, upperLeft) {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  return leftDistance <= aboveDistance && leftDistance <= upperLeftDistance ? left : aboveDistance <= upperLeftDistance ? above : upperLeft;
}

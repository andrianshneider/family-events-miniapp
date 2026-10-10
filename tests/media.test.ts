import {it,expect} from 'vitest';
import sharp from 'sharp';
import {sanitizeImage} from '@/server/storage/media';
it('rejects SVG/HTML, sanitizes a real image',async()=>{await expect(sanitizeImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).rejects.toThrow();await expect(sanitizeImage(Buffer.from('<html>unsafe</html>'))).rejects.toThrow();const png=await sharp({create:{width:4,height:4,channels:3,background:'#ffffff'}}).png().toBuffer();const out=await sanitizeImage(png);expect(out.mimeType).toBe('image/webp');expect(out.width).toBe(4);expect((await sharp(out.bytes).metadata()).exif).toBeUndefined();});

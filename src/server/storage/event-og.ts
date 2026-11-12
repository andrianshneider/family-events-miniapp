import "server-only";
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { publicEvent } from "../services/public-events";
import { eventWhen } from "@/lib/invitation";
import { eventCover } from "./media";
const xml = (value: string) =>
  value.replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
function lines(value: string) {
  const result: string[] = [];
  let line = "";
  for (const word of value.split(/\s+/)) {
    if (line && [...(line + " " + word)].length > 24) {
      result.push(line);
      line = "";
    }
    for (const chunk of word.match(/.{1,24}/gu) ?? []) {
      if (line && [...(line + " " + chunk)].length > 24) {
        result.push(line);
        line = "";
      }
      line += (line ? " " : "") + chunk;
    }
  }
  if (line) result.push(line);
  return result.slice(0, 4);
}
export async function eventOg(publicId: string) {
  const event = await publicEvent(publicId);
  let cover: Buffer | undefined;
  if (event.coverUrl) {
    // Only an asset already authorized by the active Event proxy, never an external URL.
    const blob = await eventCover(publicId);
    cover = await sharp(Buffer.from(await blob.arrayBuffer()), {
      limitInputPixels: 20000000,
    })
      .resize(1200, 630, { fit: "cover" })
      .png()
      .toBuffer();
  }
  const title = lines(event.title)
    .map(
      (line, i) =>
        `<text x="64" y="${200 + i * 64}" font-size="${Math.min(50, Math.floor(632 / ([...line].length * 0.95)))}" font-weight="700">${xml(line)}</text>`,
    )
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="${cover ? 760 : 1200}" height="630" fill="#fffdfb"/><g font-family="Arial, sans-serif" fill="#292433"><text x="128" y="86" font-size="28" fill="#7952c7" font-weight="700">Meetmallow</text>${title}<text x="64" y="530" font-size="27">${xml(eventWhen(event))}</text><text x="64" y="578" font-size="22" fill="#716879">Время события · ${xml(event.timezone)}</text></g></svg>`;
  const background = cover
    ? sharp(cover)
    : sharp({
        create: {
          width: 1200,
          height: 630,
          channels: 4,
          background: "#fffdfb",
        },
      });
  const mark = await readFile(
    join(process.cwd(), "public/icons/meetmallow-512.png"),
  );
  const headerMark = await sharp(mark).resize(48, 48).png().toBuffer();
  const fallbackMark = cover
    ? null
    : await sharp(mark).resize(230, 230).png().toBuffer();
  return background
    .composite([
      { input: Buffer.from(svg) },
      { input: headerMark, left: 64, top: 50 },
      ...(fallbackMark ? [{ input: fallbackMark, left: 866, top: 166 }] : []),
    ])
    .png()
    .toBuffer();
}

import "server-only";
import sharp from "sharp";
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
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="${cover ? 760 : 1200}" height="630" fill="#fffdfb"/><g font-family="Arial, sans-serif" fill="#292433"><text x="64" y="90" font-size="28" fill="#7952c7" font-weight="700">Family Events</text>${title}<text x="64" y="530" font-size="27">${xml(eventWhen(event))}</text><text x="64" y="578" font-size="22" fill="#716879">Время события · ${xml(event.timezone)}</text></g>${cover ? "" : '<rect x="866" y="166" width="230" height="230" rx="48" fill="#f5efff"/><path d="M980 335 C920 292 915 245 950 237 C969 233 980 246 980 251 C980 246 995 231 1013 237 C1050 248 1040 290 980 335Z" fill="none" stroke="#7952c7" stroke-width="5"/>'}</svg>`;
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
  return background
    .composite([{ input: Buffer.from(svg) }])
    .png()
    .toBuffer();
}

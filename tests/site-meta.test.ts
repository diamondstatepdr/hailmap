import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SHARE_IMAGE, SITE_DESCRIPTION, SITE_TITLE, SITE_URL } from "@/lib/site-meta";

describe("share metadata", () => {
  it("describes Swathline for a link preview", () => {
    expect(SITE_TITLE).toMatch(/Swathline/);
    expect(SITE_TITLE.length).toBeLessThan(70);
    expect(SITE_DESCRIPTION).toMatch(/hail/i);
    expect(SITE_DESCRIPTION).toMatch(/PDR|paintless/i);
    expect(SITE_DESCRIPTION.length).toBeGreaterThan(50);
    expect(SITE_DESCRIPTION.length).toBeLessThan(200);
    expect(SITE_URL).toBe("https://swathline.app");
    expect(SHARE_IMAGE).toBe("/og.png");

    const layout = readFileSync(path.join(process.cwd(), "src/app/layout.tsx"), "utf8");
    expect(layout).toContain("openGraph");
    expect(layout).toContain("summary_large_image");
    expect(layout).toContain("SITE_TITLE");
    expect(layout).toContain("SITE_DESCRIPTION");
    expect(layout).toContain("SHARE_IMAGE");

    const image = path.join(process.cwd(), "public/og.png");
    expect(existsSync(image)).toBe(true);
    const bytes = readFileSync(image);
    expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(bytes.readUInt32BE(16)).toBe(1200);
    expect(bytes.readUInt32BE(20)).toBe(630);
  });
});

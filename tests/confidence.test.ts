import { describe, expect, it } from "vitest";
import { classifyOfficialLsr, confidenceForImport } from "@/lib/confidence";

describe("classifyOfficialLsr", () => {
  it("keeps public, mPING, and social-media LSRs as spotter", () => {
    expect(
      classifyOfficialLsr("Public", "Report from mPING: Quarter (1.00 in.)."),
    ).toBe("spotter");
    expect(
      classifyOfficialLsr("Public", "Social media report of nickel sized hail around 7AM MT."),
    ).toBe("spotter");
    expect(
      classifyOfficialLsr(null, "Report from mPING: Quarter (1.00 in.). (SLC)"),
    ).toBe("spotter");
    expect(classifyOfficialLsr("Public", "Via Facebook. (OUN)")).toBe("spotter");
  });

  it("does not treat a radar time estimate as NWS or a public source as community", () => {
    expect(
      classifyOfficialLsr("Public", "Trained spotter reported. Time estimated from radar."),
    ).toBe("spotter");
    expect(classifyOfficialLsr("Public", "Time estimated from radar.")).toBe("spotter");
    expect(
      classifyOfficialLsr(
        "Broadcast Media",
        "Quarter sized hail via social media report from media partners. Time estimated via radar.",
      ),
    ).toBe("spotter");
  });

  it("ranks office, instrument, law enforcement, and emergency manager reports as NWS", () => {
    expect(classifyOfficialLsr("NWS Employee", null)).toBe("nws");
    expect(classifyOfficialLsr("Official NWS Obs", null)).toBe("nws");
    expect(classifyOfficialLsr("Emergency Mngr", null)).toBe("nws");
    expect(classifyOfficialLsr("ASOS", null)).toBe("nws");
    expect(
      classifyOfficialLsr(
        "Public",
        "Public and Law Enforcement reported, with a picture found on social media from the public.",
      ),
    ).toBe("nws");
  });

  it("keeps a trained spotter above an mPING remark", () => {
    expect(classifyOfficialLsr("Trained Spotter", "Report from mPING: Quarter (1.00 in.).")).toBe(
      "spotter",
    );
    expect(classifyOfficialLsr("Cocorahs", "Maximum hail size of 1.00 inch.")).toBe("spotter");
  });

  it("does not let imports or webhooks claim official confidence", () => {
    expect(confidenceForImport("nws")).toBe("community");
    expect(confidenceForImport("mesh")).toBe("community");
    expect(confidenceForImport("spotter")).toBe("spotter");
    expect(confidenceForImport("community")).toBe("community");
    expect(confidenceForImport(undefined)).toBe("community");
  });
});

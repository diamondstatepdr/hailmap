import { describe, expect, it } from "vitest";
import { parseHailSizeInches, parseSpcSizeToken } from "@/lib/size";

describe("parseHailSizeInches", () => {
  it("parses numeric inches and fractions", () => {
    expect(parseHailSizeInches(1.75)).toBe(1.75);
    expect(parseHailSizeInches("1.75")).toBe(1.75);
    expect(parseHailSizeInches("1.75 in")).toBe(1.75);
    expect(parseHailSizeInches('2"')).toBe(2);
    expect(parseHailSizeInches("1 3/4")).toBe(1.75);
    expect(parseHailSizeInches("3/4")).toBe(0.75);
    expect(parseHailSizeInches("1,25")).toBe(1.25);
  });

  it("parses common spotter size words", () => {
    expect(parseHailSizeInches("pea")).toBe(0.25);
    expect(parseHailSizeInches("marble")).toBe(0.5);
    expect(parseHailSizeInches("dime")).toBe(0.75);
    expect(parseHailSizeInches("nickel")).toBe(0.88);
    expect(parseHailSizeInches("quarter")).toBe(1);
    expect(parseHailSizeInches("half-dollar")).toBe(1.25);
    expect(parseHailSizeInches("ping-pong ball")).toBe(1.5);
    expect(parseHailSizeInches("golf ball")).toBe(1.75);
    expect(parseHailSizeInches("hen egg")).toBe(2);
    expect(parseHailSizeInches("tennis ball")).toBe(2.5);
    expect(parseHailSizeInches("baseball")).toBe(2.75);
    expect(parseHailSizeInches("grapefruit")).toBe(4);
    expect(parseHailSizeInches("softball")).toBe(4.5);
  });

  it("rejects empty, zero, negative, and implausible values", () => {
    expect(parseHailSizeInches("")).toBeNull();
    expect(parseHailSizeInches(null)).toBeNull();
    expect(parseHailSizeInches(0)).toBeNull();
    expect(parseHailSizeInches(-1)).toBeNull();
    expect(parseHailSizeInches("100")).toBeNull();
    expect(parseHailSizeInches("no hail")).toBeNull();
  });
});

describe("parseSpcSizeToken", () => {
  it("treats whole numbers as hundredths of an inch", () => {
    expect(parseSpcSizeToken("175")).toBe(1.75);
    expect(parseSpcSizeToken("100")).toBe(1);
    expect(parseSpcSizeToken("88")).toBe(0.88);
    expect(parseSpcSizeToken("1.75")).toBe(1.75);
  });
});

import { existsSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PaywallDialog from "@/components/billing/PaywallDialog";
import PricingOffer from "@/components/billing/PricingOffer";
import { PITCH_FEATURES, TRIAL_BUTTON, TRIAL_LABEL } from "@/lib/pitch";

const tiers = [
  { id: "solo", name: "Solo", blurb: "For one tech.", audience: "individual" as const, featured: true, amountLabel: "$15/mo" },
  { id: "crew", name: "Crew", blurb: "For a crew.", audience: "team" as const, featured: false, amountLabel: "$119/mo" },
  { id: "storm", name: "Storm Team", blurb: "For a larger crew.", audience: "team" as const, featured: false, amountLabel: "$249/mo" },
];

describe("pricing pitch", () => {
  it("names only tools the app actually has, and offers a 7-day free trial", () => {
    expect(PITCH_FEATURES.map((feature) => feature.title)).toEqual([
      "Live hail swaths",
      "Storm history",
      "Address lookup",
      "Door-knock routes",
      "Dealership hit list",
      "Hail proof PDFs",
      "Canvass tracker",
      "Storm-to-cash",
      "Lead export",
    ]);
    for (const feature of PITCH_FEATURES) expect(existsSync(feature.source)).toBe(true);

    const html = renderToStaticMarkup(
      createElement(PricingOffer, {
        enabled: true,
        trialEligible: true,
        owner: false,
        subscribedName: null,
        busy: null,
        tiers,
        onCheckout: () => undefined,
        onPortal: () => undefined,
      }),
    );
    expect(html).toContain(TRIAL_LABEL);
    expect(html).toContain(TRIAL_BUTTON);
    expect(html).toContain("Start 7-day free trial on Solo");
    expect(html).toContain("$15/mo");
    expect(html).toContain("$119/mo");
    expect(html).toContain("$249/mo");
    for (const feature of PITCH_FEATURES) expect(html).toContain(feature.title);
    expect(html).not.toContain("roof records");
    expect(html).not.toContain("insurance approval");

    const used = renderToStaticMarkup(
      createElement(PricingOffer, {
        enabled: true,
        trialEligible: false,
        owner: false,
        subscribedName: null,
        busy: null,
        tiers,
        onCheckout: () => undefined,
        onPortal: () => undefined,
      }),
    );
    expect(used).not.toContain(TRIAL_BUTTON);
    expect(used).toContain("Subscribe to Solo");
    expect(used).toContain("already used its free trial");
  });

  it("tells a locked tech the plans include a 7-day free trial", () => {
    const html = renderToStaticMarkup(createElement(PaywallDialog, { onClose: () => undefined, onTeamPasscode: () => undefined }));
    expect(html).toContain(TRIAL_LABEL);
  });
});

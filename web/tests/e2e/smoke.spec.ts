import { expect, test } from "@playwright/test";
import { findClaimViolations } from "../../src/i18n/claimsGuard";
import en from "../../src/i18n/en.json" with { type: "json" };

test("the page loads, shows its name and tagline, and has no errors", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto("./");

  await expect(page).toHaveTitle(`${en["site.name"]}: ${en["site.tagline"]}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(en["site.name"]);
  await expect(page.getByText(en["site.tagline"])).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  await page.screenshot({
    path: `test-results/screens/landing-${testInfo.project.name}.png`,
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("the rendered page makes no forecast or warning claim", async ({ page }) => {
  await page.goto("./");
  const bodyText = (await page.locator("body").textContent()) ?? "";
  const description = await page.locator('meta[name="description"]').getAttribute("content");
  expect(findClaimViolations("rendered.body", bodyText)).toEqual([]);
  expect(findClaimViolations("rendered.description", description ?? "")).toEqual([]);
});

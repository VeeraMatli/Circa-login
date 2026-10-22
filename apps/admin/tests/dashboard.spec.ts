import { test, expect } from "@playwright/test";
test("loads real metrics and navigates each scoped dashboard", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "A thoughtful overview." }),
  ).toBeVisible();
  await expect(
    page.getByText("Registered accounts", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "Members", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Members", exact: true, level: 1 }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Trust & safety", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Trust & safety",
      exact: true,
      level: 1,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Platform health", exact: true })
    .click();
  await expect(page.getByText("available", { exact: true })).toBeVisible();
  await page.screenshot({
    path: "/tmp/anvaya-admin-health.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test("admin gateway rejects cross-origin mutations", async ({ request }) => {
  const response = await request.patch("/api/admin/flags/ai_sparks", {
    headers: { Origin: "https://attacker.invalid" },
    data: { enabled: false },
  });
  expect(response.status()).toBe(403);
});
test("small screens retain accessible navigation without overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Toggle navigation" }).click();
  await page.getByRole("button", { name: "Photo review", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Photo review", exact: true, level: 1 }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "/tmp/anvaya-admin-mobile.png",
    fullPage: true,
  });
});

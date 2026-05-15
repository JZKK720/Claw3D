import { expect, test } from "@playwright/test";
import { stubStudioRoute } from "./helpers/studioRoute";

test.beforeEach(async ({ page }) => {
  await stubStudioRoute(page, {
    version: 1,
    gateway: {
      url: "ws://localhost:18792",
      tokenConfigured: false,
      adapterType: "demo",
      profiles: {
        demo: {
          url: "ws://localhost:18792",
          tokenConfigured: false,
        },
      },
      lastKnownGood: {
        url: "ws://localhost:18792",
        tokenConfigured: false,
        adapterType: "demo",
      },
    },
    focused: {},
    avatars: {},
    taskBoard: {},
  });
});

test("office settings panel reflects current gateway state", async ({ page }) => {
  await page.goto("/");

  await page.getByTitle("Voice reply settings").click();
  await expect(page.getByRole("button", { name: "Disconnect gateway" })).toBeVisible();
  await expect(
    page.getByText("Switch the active backend and update its saved endpoint details."),
  ).toBeVisible();
});

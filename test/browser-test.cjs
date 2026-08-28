const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { createRequire } = require("node:module");
const fs = require("node:fs");

const marinaraRepo = process.env.MARINARA_REPO
  ? path.resolve(process.env.MARINARA_REPO)
  : path.resolve(__dirname, "../../Marinara-Engine-ko");
const repoRequire = createRequire(path.join(marinaraRepo, "package.json"));
const { chromium } = repoRequire("@playwright/test");
const catalogRows = fs
  .readFileSync(path.resolve(__dirname, "../data/catalog-reviewed.tsv"), "utf8")
  .trim()
  .split("\n")
  .slice(1)
  .map((line) => {
    const fields = line.split("\t");
    return {
      id: fields[0],
      englishName: fields[2],
      koreanName: fields[3],
      englishDescription: fields[4],
      koreanDescription: fields[5],
    };
  });

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: "/usr/sbin/chromium" });
  const page = await browser.newPage();
  const cleanupKey = "__agentsKoCleanup";
  await page.addInitScript((key) => {
    window.marinara = {
      onCleanup(callback) {
        window[key] = callback;
      },
      log: { info() {}, warn() {} },
    };
  }, cleanupKey);
  await page.goto(pathToFileURL(path.join(__dirname, "fixture.html")).href);
  await page.addScriptTag({ path: path.resolve(__dirname, "../extension.js") });
  await page.waitForTimeout(50);

  await page.evaluate((rows) => {
    const catalog = document.querySelector('[data-component="AgentCatalogView"]');
    const panel = document.querySelector('[data-panel-key="agents"]');
    for (const row of rows) {
      for (const [root, suffix] of [
        [catalog, "catalog"],
        [panel, "panel"],
      ]) {
        const card = document.createElement("article");
        card.dataset.testPackage = `${row.id}-${suffix}`;
        const name = document.createElement("strong");
        name.textContent = row.englishName;
        const description = document.createElement("p");
        description.textContent = row.englishDescription;
        card.append(name, description);
        root.appendChild(card);
      }
    }
  }, catalogRows);
  await page.waitForFunction(
    (rows) =>
      rows.every((row) =>
        ["catalog", "panel"].every((suffix) => {
          const card = document.querySelector(`[data-test-package="${row.id}-${suffix}"]`);
          return (
            card?.querySelector("strong")?.textContent === row.koreanName &&
            card?.querySelector("p")?.textContent === row.koreanDescription
          );
        }),
      ),
    catalogRows,
  );
  assert.equal(catalogRows.length, 37, "must cover the observed official catalog");

  assert.equal(await page.textContent("#installed"), "설치된 에이전트");
  assert.equal(await page.textContent("#writer"), "글쓰기 에이전트");
  assert.equal(await page.textContent("#kind"), "에이전트");
  assert.equal(
    await page.getAttribute('[data-component="AgentCatalogView"]', "aria-label"),
    "지원하는 채팅 모드로 에이전트 필터링",
  );
  assert.equal(await page.textContent("#outside"), "Installed Agents", "must not translate outside Agents roots");
  assert.equal(await page.textContent("#card strong"), "인벤토리 트래커");
  assert.match(await page.textContent("#card p"), /^화폐, 장착 장비/);
  assert.equal(await page.textContent("#panel-title"), "에이전트");
  assert.equal(await page.getAttribute('[data-component="RightPanel"]', "aria-label"), "에이전트");
  assert.equal(await page.textContent("#installed-agent-card strong"), "인벤토리 트래커");
  assert.match(await page.textContent("#installed-agent-card p"), /^화폐, 장착 장비/);

  await page.evaluate(() => {
    const node = document.createElement("h3");
    node.id = "dynamic";
    node.textContent = "Tracker Agents";
    document.querySelector('[data-component="AgentCatalogView"]').appendChild(node);
  });
  await page.waitForFunction(() => document.querySelector("#dynamic")?.textContent === "추적 에이전트");
  assert.equal(await page.textContent("#dynamic"), "추적 에이전트", "must translate SPA rerenders");

  await page.evaluate(() => {
    document.documentElement.lang = "en";
    document.querySelector("#installed").setAttribute("data-test-tick", "1");
  });
  await page.waitForFunction(() => document.querySelector("#installed")?.textContent === "Installed Agents");
  assert.equal(await page.textContent("#installed"), "Installed Agents", "must revert when locale leaves Korean");

  await page.evaluate(() => {
    document.documentElement.lang = "ko";
    document.querySelector("#installed").setAttribute("data-test-tick", "2");
  });
  await page.waitForFunction(() => document.querySelector("#installed")?.textContent === "설치된 에이전트");
  assert.equal(await page.textContent("#installed"), "설치된 에이전트", "must reapply for Korean locale");

  await page.evaluate((key) => window[key](), cleanupKey);
  assert.equal(await page.textContent("#installed"), "Installed Agents", "cleanup must restore original text");
  assert.equal(await page.textContent("#card strong"), "Inventory Tracker");

  await browser.close();
  console.log("PASS agents-ko-overlay browser fixture");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

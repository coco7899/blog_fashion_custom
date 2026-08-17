const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const projectRoot = path.join(__dirname, '..');
const statePath = path.join(projectRoot, '..', 'blog_fashion_data', 'session', 'naver-state.json');
const outputDir = path.join(projectRoot, 'tmp-naver-inspect');
const targetTitle = process.argv.slice(2).join(' ').trim();

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ storageState: statePath });
    const page = await context.newPage();
    await page.goto('https://blog.naver.com/qnghkf950?Redirect=Write&', {
      waitUntil: 'load',
      timeout: 60000,
    });
    await page.waitForTimeout(2500);
    const frame = page.frames().find((item) => item.name() === 'mainFrame');
    if (!frame) throw new Error('네이버 글쓰기 편집기 프레임을 찾지 못했습니다.');

    await frame.locator('.se-popup-button-cancel').first().click().catch(() => {});
    const saveButton = frame.locator('button[class*="save_count_btn"]').first();
    await saveButton.click({ timeout: 10000 });
    await page.waitForTimeout(1500);

    if (targetTitle) {
      const target = frame.getByText(targetTitle, { exact: true }).first();
      await target.click({ timeout: 10000 });
      await page.waitForTimeout(2000);
    }

    const data = {
      pageUrl: page.url(),
      frameUrl: frame.url(),
      frameText: await frame.locator('body').innerText().catch(() => ''),
      pageText: await page.locator('body').innerText().catch(() => ''),
      buttons: await frame.locator('button').evaluateAll((items) =>
        items.map((item) => ({
          text: item.innerText || '',
          ariaLabel: item.getAttribute('aria-label') || '',
          className: item.className || '',
        }))
      ),
    };
    const suffix = targetTitle ? '-selected' : '';
    fs.writeFileSync(path.join(outputDir, `saved-drafts${suffix}.json`), JSON.stringify(data, null, 2), 'utf8');
    await page.screenshot({ path: path.join(outputDir, `saved-drafts${suffix}.png`), fullPage: true });
    console.log('완료:', outputDir);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

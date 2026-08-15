// 티스토리 새 에디터 자동화: 제목/HTML 본문/이미지/태그 입력 → 임시저장 또는 발행
const fs = require('fs');
const path = require('path');
const auth = require('./tistoryAuth');
const browserHelper = require('./browser');

const SEL = {
  title: '#post-title-inp',
  editorIframe: '#editor-tistory_ifr, iframe[title*="에디터"]',
  editorBody: '#tinymce, body[contenteditable="true"]',
  tag: '#tagText',
  complete: '#publish-layer-btn',
  publish: '#publish-btn',
  public: '#open20, label[for="open20"]',
  private: '#open0, label[for="open0"]',
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeUrl(value) {
  const url = String(value || '').trim();
  return /^https?:\/\//i.test(url) ? escapeHtml(url) : '';
}

function issuedAffiliateUrl(value) {
  const url = String(value || '').trim();
  return /^https:\/\/naver\.me\/[A-Za-z0-9]+$/i.test(url) ? escapeHtml(url) : '';
}

function productPrice(value) {
  const amount = Number(String(value || '').replace(/[^0-9]/g, ''));
  return Number.isFinite(amount) && amount > 0 ? `${amount.toLocaleString('ko-KR')}원` : '';
}

function affiliateCardHtml(product, index) {
  const url = issuedAffiliateUrl(product && product.link);
  if (!url) return '';
  const name = escapeHtml(String(product.name || '상품 상세 정보').trim());
  const image = safeUrl(product.image);
  const price = productPrice(product.price);
  const description = price ? `${price} · 상품 상세 정보 보기` : '상품 상세 정보 보기';
  const imageStyle = image
    ? `background-image:url('${image}');background-size:cover;background-position:center`
    : 'background:linear-gradient(135deg,#fff7ed,#fed7aa)';
  return [
    `<figure id="og-affiliate-${index}" contenteditable="false" data-ke-type="opengraph" data-ke-align="alignCenter" data-og-type="article" data-og-title="${name}" data-og-description="${escapeHtml(description)}" data-og-host="naver.me" data-og-source-url="${url}" data-og-url="${url}" data-og-image="${image}">`,
    `<a href="${url}" target="_blank" rel="nofollow sponsored noopener" data-source-url="${url}" style="display:flex;overflow:hidden;border:1px solid #e5e7eb;border-radius:12px;text-decoration:none;color:#222;background:#fff">`,
    `<div class="og-image" style="flex:0 0 160px;min-height:140px;${imageStyle}">${image ? `<img src="${image}" alt="${name}" loading="eager" referrerpolicy="no-referrer" style="display:block;width:100%;height:100%;min-height:140px;object-fit:cover">` : ''}</div>`,
    '<div class="og-text" style="display:flex;min-width:0;flex:1;flex-direction:column;justify-content:center;padding:18px 20px">',
    `<p class="og-title" data-ke-size="size16" style="margin:0 0 8px;font-weight:700;line-height:1.45">${name}</p>`,
    `<p class="og-desc" data-ke-size="size14" style="margin:0 0 10px;color:#555">${escapeHtml(description)}</p>`,
    '<p class="og-host" data-ke-size="size14" style="margin:0;color:#888">naver.me</p>',
    '</div></a></figure>',
  ].join('');
}

function textWithBreaks(value) {
  return escapeHtml(value).replace(/\r?\n/g, '<br>');
}

function imagePlaceholderHtml(block, judgment) {
  const slot = Number(block.slot || judgment?.slot || 0);
  const description = String(judgment?.desc || block.desc || block.caption || '글 내용에 맞는 이미지').trim();
  return `<div data-ke-type="moreLess" data-text-more="이미지 ${slot} 추천 장면 보기" data-text-less="이미지 ${slot} 추천 장면 닫기"><p><b>이미지 ${slot} 추천 장면</b><br>${textWithBreaks(description)}</p></div>`;
}

function numberedHeading(value, index) {
  const text = String(value || '').trim();
  if (/^(?:\d+[.)]|Step\s+\d+)/i.test(text)) return text;
  return `${index}. ${text}`;
}

function articleTocHtml(headings) {
  if (headings.length < 2) return '';
  const items = headings
    .map((heading, index) => {
      const label = numberedHeading(heading.text, index + 1);
      return `<li><a href="#health-section-${index + 1}">${textWithBreaks(label)}</a></li>`;
    })
    .join('');
  return `<nav data-blog-toc="true" aria-label="글 목차" style="margin:24px 0;padding:20px 22px;border:1px solid #e5e7eb;border-radius:12px;background:#f8fafc"><p style="margin:0 0 10px"><b>목차</b></p><ol style="margin:0;padding-left:22px">${items}</ol></nav>`;
}

function buildArticleHtml(article, judgments = [], options = {}, imageHtmlBySlot = new Map()) {
  const bySlot = new Map(judgments.map((item) => [Number(item.slot), item]));
  const parts = [];
  const blocks = Array.isArray(article.blocks) ? article.blocks : [];
  const products = (options.products || []).filter((product) => issuedAffiliateUrl(product && product.link)).slice(0, 5);

  if (products.length) {
    parts.push('<p data-ke-size="size16"><b>이 포스팅은 네이버 쇼핑 커넥트 활동의 일환으로, 판매 발생 시 수수료를 제공받습니다.</b></p>');
  }

  if (options.insertCover && imageHtmlBySlot.has(0)) {
    parts.push(imageHtmlBySlot.get(0));
  }

  const headings = blocks.filter((block) => block && block.type === 'heading' && String(block.text || '').trim());
  const toc = articleTocHtml(headings);
  if (toc) parts.push(toc);

  let headingIndex = 0;
  for (const block of blocks) {
    if (!block || !block.type) continue;
    if (block.type === 'heading') {
      headingIndex += 1;
      parts.push(`<h2 id="health-section-${headingIndex}" data-ke-size="size26">${textWithBreaks(numberedHeading(block.text, headingIndex))}</h2>`);
    } else if (block.type === 'paragraph') {
      parts.push(`<p data-ke-size="size16">${textWithBreaks(block.text)}</p>`);
    } else if (block.type === 'quote') {
      parts.push(`<blockquote data-ke-style="style3"><p>${textWithBreaks(block.text)}</p></blockquote>`);
    } else if (block.type === 'divider') {
      parts.push('<hr data-ke-style="style1">');
    } else if (block.type === 'image') {
      const slot = Number(block.slot);
      parts.push(imageHtmlBySlot.get(slot) || imagePlaceholderHtml(block, bySlot.get(slot)));
    }
  }

  if (products.length) {
    parts.push('<p data-ke-size="size16" style="margin-top:36px"><b>👉 내 생활에 정말 필요한 선택일까요? 실제 구성과 현재 가격을 지금 확인해 보세요.</b></p>');
    products.forEach((product, index) => parts.push(affiliateCardHtml(product, index + 1)));
  }
  return parts.join('\n');
}

async function dismissNativeDialog(page) {
  page.on('dialog', async (dialog) => {
    const message = dialog.message();
    try {
      if (/저장된 글|이어.*쓰|복구/i.test(message)) await dialog.dismiss();
      else await dialog.accept();
    } catch {}
  });
}

async function getEditor(page) {
  await page.waitForSelector(SEL.editorIframe, { timeout: 30000 });
  const iframe = page.locator(SEL.editorIframe).first();
  const handle = await iframe.elementHandle();
  const frame = handle && (await handle.contentFrame());
  if (!frame) throw new Error('티스토리 본문 에디터 iframe을 열지 못했습니다.');
  const body = frame.locator(SEL.editorBody).first();
  await body.waitFor({ state: 'visible', timeout: 20000 });
  return { frame, body };
}

async function setEditorHtml(page, html) {
  const setByTinyMce = await page
    .evaluate((content) => {
      const instance = window.tinymce && (window.tinymce.get('editor-tistory') || window.tinymce.activeEditor);
      if (!instance) return false;
      instance.setContent(content);
      instance.fire('input');
      instance.fire('change');
      instance.save();
      return true;
    }, html)
    .catch(() => false);
  if (setByTinyMce) return;

  const { body } = await getEditor(page);
  await body.evaluate((element, content) => {
    element.innerHTML = content;
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: null }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, html);
  await body.click();
  await page.keyboard.press('End');
  await page.keyboard.insertText(' ');
  await page.keyboard.press('Backspace');
}

async function editorImageCount(page) {
  const { body } = await getEditor(page);
  return body.locator('img').count();
}

async function clickFirstVisible(page, selectors, timeout = 1500) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible().catch(() => false)) {
      try {
        await locator.click({ timeout });
        return true;
      } catch {}
    }
  }
  return false;
}

async function chooseImageFile(page, filePath) {
  const directInputs = page.locator('input[type="file"][accept*="image"], input[type="file"][multiple]');
  if ((await directInputs.count()) > 0) {
    await directInputs.last().setInputFiles(filePath);
    return;
  }

  const openerClicked = await clickFirstVisible(page, [
    '#mceu_0-open',
    'button[aria-label*="첨부"]',
    'button:has-text("첨부")',
  ]);
  if (openerClicked) await sleep(300);

  const chooserPromise = page.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null);
  const photoClicked = await clickFirstVisible(page, [
    'button[aria-label*="사진"]',
    'button:has-text("사진")',
    '[role="menuitem"]:has-text("사진")',
    'a:has-text("사진")',
  ], 2500);
  if (!photoClicked && !openerClicked) throw new Error('티스토리 사진 첨부 버튼을 찾지 못했습니다.');

  const chooser = await chooserPromise;
  if (chooser) {
    await chooser.setFiles(filePath);
    return;
  }
  const input = page.locator('input[type="file"]').last();
  if (!(await input.count())) throw new Error('티스토리 이미지 파일 선택창이 열리지 않았습니다.');
  await input.setInputFiles(filePath);
}

async function uploadImage(page, filePath, altText = '') {
  const { body } = await getEditor(page);
  const before = await editorImageCount(page);
  const uploadMarker = `codex-before-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await body.locator('img').evaluateAll((images, marker) => {
    for (const image of images) image.setAttribute('data-codex-upload-marker', marker);
  }, uploadMarker);
  await body.click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await chooseImageFile(page, filePath);

  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    const count = await editorImageCount(page);
    if (count > before) {
      const freshImages = body.locator(`img:not([data-codex-upload-marker="${uploadMarker}"])`);
      if (!(await freshImages.count())) {
        await sleep(250);
        continue;
      }
      const latest = freshImages.last();
      const uploadDeadline = Date.now() + 30000;
      while (Date.now() < uploadDeadline) {
        const src = await latest.getAttribute('src').catch(() => '');
        if (/^https?:\/\//i.test(src || '')) break;
        await sleep(500);
      }
      const uploadedSrc = await latest.getAttribute('src').catch(() => '');
      if (!/^https?:\/\//i.test(uploadedSrc || '')) {
        throw new Error(`티스토리 이미지 서버 업로드를 확인하지 못했습니다: ${path.basename(filePath)}`);
      }
      await sleep(500);
      return latest.evaluate((image, text) => {
        image.removeAttribute('data-codex-upload-marker');
        image.setAttribute('alt', text || '본문 내용을 설명하는 이미지');
        const figure = image.closest('figure');
        if (figure) return figure.outerHTML;
        return `<p>${image.outerHTML}</p>`;
      }, String(altText || '').trim());
    }
    await sleep(500);
  }
  throw new Error(`이미지 업로드가 완료되지 않았습니다: ${path.basename(filePath)}`);
}

async function uploadArticleImages(page, judgments, options) {
  const imageHtmlBySlot = new Map();
  const uploadedSources = new Set();
  const allowedSlots = new Set(
    (options.insertCover ? judgments : judgments.filter((item) => Number(item.slot) !== 0))
      .filter((item) => item && item.file)
      .map((item) => Number(item.slot))
  );
  const items = judgments.filter((item) => allowedSlots.has(Number(item.slot)) && item.file);
  if (!items.length) return imageHtmlBySlot;

  await setEditorHtml(page, '<p>이미지를 준비하고 있습니다.</p>');
  for (const item of items) {
    const filePath = path.join(options.imagesDir, 'raw', item.file);
    if (!fs.existsSync(filePath)) {
      if (options.strictImages) throw new Error(`이미지 파일을 찾지 못했습니다: ${item.file}`);
      continue;
    }
    options.onStep(`이미지 ${item.slot === 0 ? '대표' : item.slot} 업로드 중`);
    try {
      const altText = item.caption || item.desc || (item.slot === 0 ? '글 대표 이미지' : `본문 이미지 ${item.slot}`);
      const html = await uploadImage(page, filePath, altText);
      const uploadedSrc = (html.match(/<img\b[^>]*\bsrc="([^"]+)"/i) || [])[1] || '';
      if (!uploadedSrc) throw new Error(`업로드된 이미지 주소를 확인하지 못했습니다: ${item.file}`);
      if (uploadedSources.has(uploadedSrc)) {
        throw new Error(`티스토리가 같은 이미지 주소를 반복 반환했습니다: ${item.file}`);
      }
      uploadedSources.add(uploadedSrc);
      imageHtmlBySlot.set(Number(item.slot), html);
    } catch (error) {
      console.warn(`[tistory-publisher] 이미지 ${item.slot} 업로드 실패: ${error.message}`);
      if (options.strictImages) throw error;
    }
  }
  return imageHtmlBySlot;
}

async function setRepresentativeCover(page) {
  const { frame, body } = await getEditor(page);
  const coverImage = body.locator('img').first();
  if (!(await coverImage.count())) {
    throw new Error('대표로 지정할 첫 번째 이미지를 찾지 못했습니다.');
  }

  const coverSrc = String((await coverImage.getAttribute('src')) || '').trim();
  if (!/^https?:\/\//i.test(coverSrc)) {
    throw new Error('대표이미지의 업로드 주소를 확인하지 못했습니다.');
  }
  await coverImage.scrollIntoViewIfNeeded();
  await coverImage.click({ force: true });
  await sleep(500);
  const callbackApplied = await page.evaluate((src) => {
    const editor = window.tinymce && (window.tinymce.get('editor-tistory') || window.tinymce.activeEditor);
    const callback = editor?.settings?.kImage?.representative_image_callback;
    if (!editor || typeof callback !== 'function') return false;
    callback({ src });
    editor.execCommand('updateRepresentImage', false, src);
    return true;
  }, coverSrc).catch(() => false);
  if (callbackApplied) {
    await sleep(300);
    return coverSrc;
  }

  const representativeToggle = frame.locator('.mce-represent-image-btn').first();
  await representativeToggle.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  if (!(await representativeToggle.isVisible().catch(() => false))) {
    throw new Error('티스토리 대표이미지 토글을 찾지 못했습니다.');
  }
  const className = String((await representativeToggle.getAttribute('class')) || '');
  if (!/(?:^|\s)active(?:\s|$)/.test(className)) {
    await representativeToggle.click({ force: true });
    await sleep(300);
  }
  const selectedClassName = String((await representativeToggle.getAttribute('class')) || '');
  if (!/(?:^|\s)active(?:\s|$)/.test(selectedClassName)) {
    throw new Error('티스토리 대표이미지 토글이 선택 상태로 바뀌지 않았습니다.');
  }
  return coverSrc;
}

function repeatedlyDecode(value) {
  let decoded = String(value || '');
  for (let index = 0; index < 3; index += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded;
}

async function verifyRepresentativeCover(page, coverSrc) {
  if (!coverSrc) return false;
  const thumbnail = page.locator('.thumb_g:visible').first();
  if (!(await thumbnail.count())) {
    throw new Error('티스토리 발행창에서 대표이미지 미리보기를 찾지 못했습니다.');
  }
  const background = await thumbnail.evaluate((element) => getComputedStyle(element).backgroundImage);
  const coverPath = new URL(coverSrc).pathname;
  if (!repeatedlyDecode(background).includes(coverPath)) {
    throw new Error('티스토리 발행창의 대표이미지가 오렌지 대표이미지와 일치하지 않습니다.');
  }
  return true;
}

async function downloadAffiliateImage(imageUrl, imagesDir, index) {
  const url = String(imageUrl || '').trim();
  if (!/^https?:\/\//i.test(url)) return '';
  const response = await fetch(url, {
    headers: {
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
      Referer: 'https://brandconnect.naver.com/',
    },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`상품 이미지 다운로드 실패 (${response.status})`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < 1024 || buffer.length > 10 * 1024 * 1024) {
    throw new Error('상품 이미지 파일 크기가 올바르지 않습니다.');
  }
  const type = String(response.headers.get('content-type') || '').toLowerCase();
  const extension = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
  const rawDir = path.join(imagesDir, 'raw');
  fs.mkdirSync(rawDir, { recursive: true });
  const filePath = path.join(rawDir, `affiliate-thumbnail-${index}.${extension}`);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

async function uploadAffiliateThumbnails(page, products, options) {
  const linked = [];
  for (let index = 0; index < products.length; index += 1) {
    const product = { ...products[index] };
    if (product.image && options.imagesDir) {
      try {
        options.onStep(`제휴상품 썸네일 ${index + 1} 업로드 중`);
        const filePath = await downloadAffiliateImage(product.image, options.imagesDir, index + 1);
        if (filePath) {
          const uploadedHtml = await uploadImage(page, filePath, `${product.name || '제휴상품'} 상품 이미지`);
          const serializedSrc = (uploadedHtml.match(/<img\b[^>]*\bsrc="([^"]+)"/i) || [])[1] || '';
          // outerHTML에서 추출한 주소의 &amp;를 그대로 다시 escape하면 CDN 서명 URL이 깨진다.
          const uploadedSrc = serializedSrc.replace(/&amp;/gi, '&').replace(/&#0*38;/gi, '&');
          if (/^https?:\/\//i.test(uploadedSrc)) product.image = uploadedSrc;
        }
      } catch (error) {
        console.warn(`[tistory-publisher] 제휴상품 썸네일 업로드 실패: ${error.message}`);
      }
    }
    linked.push(product);
  }
  return linked;
}

async function findPostIdByTitle(page, blogUrl, title) {
  await page.goto(`${blogUrl}/manage/posts/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1200);
  const titleLinks = page.locator('a[href]').filter({ hasText: title });
  for (let index = 0; index < Math.min(await titleLinks.count(), 20); index += 1) {
    const href = await titleLinks.nth(index).getAttribute('href');
    const id = postIdFromUrl(href);
    if (id) return id;
  }

  const rows = page.locator('tr, li, article').filter({ hasText: title });
  for (let index = 0; index < Math.min(await rows.count(), 20); index += 1) {
    const hrefs = await rows.nth(index).locator('a[href]').evaluateAll((links) => links.map((link) => link.href));
    for (const href of hrefs) {
      const id = postIdFromUrl(href);
      if (id) return id;
    }
  }
  return null;
}

function postIdFromUrl(url) {
  const value = String(url || '');
  const match = value.match(/\/manage\/newpost\/(\d+)|\/manage\/post\/(\d+)|\/m\/(\d+)(?:[/?#]|$)|\/(\d+)(?:[/?#]|$)/);
  return match ? match[1] || match[2] || match[3] || match[4] : null;
}

async function resolveEditorUrl(page, profile, options, title) {
  const explicitId = postIdFromUrl(options.editExistingDraftUrl);
  if (explicitId) {
    return `${profile.blogUrl}/manage/newpost/${explicitId}?type=post&returnURL=%2Fmanage%2Fposts%2F`;
  }
  if (options.editExistingDraftTitle) {
    const id = await findPostIdByTitle(page, profile.blogUrl, options.editExistingDraftTitle || title);
    if (!id) throw new Error('이미지를 넣을 기존 티스토리 비공개 글을 찾지 못했습니다.');
    return `${profile.blogUrl}/manage/newpost/${id}?type=post&returnURL=%2Fmanage%2Fposts%2F`;
  }
  return `${profile.blogUrl}/manage/newpost/?type=post&returnURL=%2Fmanage%2Fposts%2F`;
}

async function fillTags(page, tags) {
  const input = page.locator(SEL.tag).first();
  if (!(await input.isVisible().catch(() => false))) return;
  await input.fill('');
  for (const tag of (tags || []).slice(0, 10)) {
    const clean = String(tag || '').replace(/^#+/, '').trim();
    if (!clean) continue;
    await input.fill(clean);
    await page.keyboard.press('Enter');
    await sleep(100);
  }
}

async function saveTemporaryDraft(page) {
  const candidates = [
    page.getByRole('button', { name: /^임시저장(?:\s*\d+)?$/ }),
    page.locator('button').filter({ hasText: '임시저장' }),
    page.locator('[role="button"]').filter({ hasText: '임시저장' }),
  ];
  let button = null;
  for (const candidate of candidates) {
    const first = candidate.first();
    if (await first.isVisible().catch(() => false)) {
      button = first;
      break;
    }
  }
  if (!button) throw new Error('티스토리 임시저장 버튼을 찾지 못했습니다.');

  const beforeText = String(await button.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
  await button.click({ timeout: 10000 });

  const successTexts = [
    /작성 중인 글이 저장되었습니다/,
    /임시저장(?:이|을)? 완료/,
    /임시 저장 완료/,
  ];
  let confirmed = false;
  for (let attempt = 0; attempt < 20 && !confirmed; attempt += 1) {
    for (const pattern of successTexts) {
      if (await page.getByText(pattern).first().isVisible().catch(() => false)) {
        confirmed = true;
        break;
      }
    }
    if (!confirmed) {
      const afterText = String(await button.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
      if (afterText && beforeText && afterText !== beforeText) confirmed = true;
    }
    if (!confirmed) await sleep(250);
  }
  if (!confirmed) throw new Error('티스토리 임시저장 완료 상태를 확인하지 못했습니다.');
}

async function savePost(page, mode, visibility, representativeCoverSrc = '') {
  if (mode === 'draft') {
    await saveTemporaryDraft(page);
    return;
  }
  await page.locator(SEL.complete).click({ timeout: 10000 });
  await sleep(800);
  if (representativeCoverSrc) await verifyRepresentativeCover(page, representativeCoverSrc);
  const shouldPublishPublicly = mode === 'publish' && visibility !== 'private';
  const inputSelector = shouldPublishPublicly ? '#open20' : '#open0';
  const input = page.locator(inputSelector);
  if (await input.count()) {
    await input.check({ force: true }).catch(() => input.click({ force: true }));
  } else {
    const label = shouldPublishPublicly ? '공개' : '비공개';
    await page.getByText(label, { exact: true }).last().click({ timeout: 3000 });
  }
  await sleep(400);
  await page.locator(SEL.publish).click({ timeout: 10000 });
  await page.waitForTimeout(2500);
}

/**
 * @returns {{savedAsDraft:boolean, postUrl:string, updatedExistingDraft:boolean, insertedImageCount:number}}
 */
async function publish(article, judgments = [], opts = {}) {
  const options = {
    mode: 'draft',
    visibility: 'public',
    onStep: () => {},
    sources: [],
    products: [],
    insertCover: false,
    strictImages: false,
    ...opts,
  };
  const status = await auth.verify(true);
  if (!status.loggedIn || !status.blogName) {
    throw new Error('티스토리 로그인이 필요합니다. 대시보드에서 카카오 로그인 후 다시 시도하세요.');
  }

  const profile = { blogName: status.blogName, blogUrl: status.blogUrl || `https://${status.blogName}.tistory.com` };
  let browser;
  let context;
  let page;
  try {
    browser = await browserHelper.launch({ headless: false, args: ['--window-size=1440,960'] });
    context = await browser.newContext({
      storageState: auth.STATE_PATH,
      viewport: { width: 1400, height: 900 },
    });
    page = await context.newPage();
    await dismissNativeDialog(page);

    const editorUrl = await resolveEditorUrl(page, profile, options, article.title);
    options.onStep(options.editExistingDraftTitle ? '기존 티스토리 글을 여는 중' : '티스토리 글쓰기 화면을 여는 중');
    await page.goto(editorUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector(SEL.title, { timeout: 30000 });
    await getEditor(page);

    options.onStep('제목 입력 중');
    await page.locator(SEL.title).fill(String(article.title || '').trim());

    const imageHtmlBySlot = await uploadArticleImages(page, judgments, options);
    if (options.strictImages) {
      const expected = Number.isInteger(options.expectedImageCount)
        ? options.expectedImageCount
        : judgments.filter((item) => item && item.file).length;
      if (imageHtmlBySlot.size !== expected) {
        throw new Error(`티스토리 이미지 업로드 수가 맞지 않습니다. 기대 ${expected}장, 확인 ${imageHtmlBySlot.size}장`);
      }
    }

    options.products = await uploadAffiliateThumbnails(page, options.products, options);

    options.onStep('본문과 서식 입력 중');
    const html = buildArticleHtml(article, judgments, options, imageHtmlBySlot);
    await setEditorHtml(page, html);
    let representativeCoverSrc = '';
    if (options.insertCover && imageHtmlBySlot.has(0)) {
      options.onStep('오렌지 대표이미지를 티스토리 대표로 지정 중');
      representativeCoverSrc = await setRepresentativeCover(page);
    }
    await fillTags(page, article.tags || []);

    const saveLabel = options.mode === 'draft'
      ? '임시저장'
      : options.visibility === 'private'
        ? '비공개 발행'
        : '공개 발행';
    options.onStep(`${saveLabel} 중`);
    await savePost(page, options.mode, options.visibility, representativeCoverSrc);
    const representativeImageSet = Boolean(representativeCoverSrc);

    const savedAsDraft = options.mode === 'draft';
    let postUrl;
    if (savedAsDraft) {
      // 티스토리 임시저장은 게시물 번호를 만들지 않고 임시저장 보관함에 들어간다.
      postUrl = `${profile.blogUrl}/manage/newpost/?type=post&returnURL=%2Fmanage%2Fposts%2F`;
    } else {
      let postId = postIdFromUrl(page.url()) || postIdFromUrl(editorUrl);
      if (!postId) postId = await findPostIdByTitle(page, profile.blogUrl, article.title);
      if (!postId) throw new Error('티스토리 발행은 요청했지만 저장된 글 번호를 확인하지 못했습니다.');
      postUrl = options.visibility === 'private'
        ? `${profile.blogUrl}/manage/newpost/${postId}?type=post&returnURL=%2Fmanage%2Fposts%2F`
        : `${profile.blogUrl}/${postId}`;
    }
    return {
      savedAsDraft,
      postUrl,
      updatedExistingDraft: Boolean(options.editExistingDraftTitle || options.editExistingDraftUrl),
      insertedImageCount: imageHtmlBySlot.size,
      representativeImageSet,
    };
  } catch (error) {
    if (page && options.errorShotPath) {
      await page.screenshot({ path: options.errorShotPath, fullPage: false }).catch(() => {});
    }
    throw error;
  } finally {
    if (context) await auth.persistState(context).catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

module.exports = {
  publish,
  _internals: {
    buildArticleHtml,
    escapeHtml,
    postIdFromUrl,
    articleTocHtml,
    numberedHeading,
    issuedAffiliateUrl,
    affiliateCardHtml,
    downloadAffiliateImage,
  },
};

const express = require('express');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;

// Puppeteer 동적 로드
let puppeteer = null;
try {
  puppeteer = require('puppeteer');
  console.log('✅ Puppeteer 로드됨 - 크롤링 기능 사용 가능');
} catch (e) {
  console.log('⚠️  Puppeteer 미설치 - 크롤링 기능 비활성화');
}

// 미들웨어
app.use(cors());
app.use(express.json());

// ============ 접속 코드 인증 ============
const ACCESS_CODE = process.env.ACCESS_CODE || 'admin1234';

// 인증 확인 API
app.post('/api/auth/verify', (req, res) => {
  const { code } = req.body;
  if (code === ACCESS_CODE) {
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, error: '접속 코드가 올바르지 않습니다.' });
  }
});

// 인증 상태 확인 API
app.get('/api/auth/check', (req, res) => {
  const authHeader = req.headers['x-access-code'];
  if (authHeader === ACCESS_CODE) {
    res.json({ authenticated: true });
  } else {
    res.status(401).json({ authenticated: false });
  }
});

app.use(express.static('public'));

// ============ MongoDB 설정 ============

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/cosmetics-db';

mongoose.connect(MONGODB_URI)
  .then(() => console.log('✅ MongoDB 연결 성공'))
  .catch(err => console.error('❌ MongoDB 연결 실패:', err));

// 제품 스키마
const productSchema = new mongoose.Schema({
  brand: { type: String, required: true },
  name: { type: String, required: true },
  category: String,
  ingredients: [String],
  oliveyoungUrl: String,
  imageUrl: String,
  goodsNo: String
}, { timestamps: true });

const Product = mongoose.model('Product', productSchema);

// ============ 올리브영 크롤러 ============

class OliveyoungCrawler {
  constructor() {
    this.browser = null;
  }

  async init() {
    if (!puppeteer) {
      throw new Error('Puppeteer가 설치되어 있지 않습니다.');
    }
    
    this.browser = await puppeteer.launch({
      headless: 'new',
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920,1080'
      ]
    });
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  // 올리브영 검색
  async searchProducts(query) {
    const page = await this.browser.newPage();
    
    try {
      await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      
      const searchUrl = `https://www.oliveyoung.co.kr/store/search/getSearchMain.do?query=${encodeURIComponent(query)}`;
      await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      
      await page.waitForSelector('.prd_info', { timeout: 10000 }).catch(() => null);
      
      const products = await page.evaluate(() => {
        const items = document.querySelectorAll('.prd_info');
        return Array.from(items).slice(0, 20).map(item => {
          const linkEl = item.querySelector('a');
          const brandEl = item.querySelector('.tx_brand');
          const nameEl = item.querySelector('.tx_name');
          const priceEl = item.querySelector('.tx_cur em');
          const imgEl = item.closest('.prd_unit')?.querySelector('.thumb img');
          
          const href = linkEl?.href || '';
          const goodsNoMatch = href.match(/goodsNo=([A-Z0-9]+)/);
          
          return {
            goodsNo: goodsNoMatch ? goodsNoMatch[1] : '',
            url: href,
            brand: brandEl?.textContent?.trim() || '',
            name: nameEl?.textContent?.trim() || '',
            price: priceEl?.textContent?.trim() || '',
            imageUrl: imgEl?.src || ''
          };
        }).filter(p => p.goodsNo);
      });
      
      return products;
    } finally {
      await page.close();
    }
  }

  // 제품 상세 + 전성분 크롤링
  async getProductDetail(goodsNo) {
    const page = await this.browser.newPage();
    
    try {
      await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      await page.setViewport({ width: 1920, height: 1080 });
      
      const productUrl = `https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=${goodsNo}`;
      console.log(`[크롤링] 페이지 접속 중: ${goodsNo}`);
      
      await page.goto(productUrl, { waitUntil: 'networkidle0', timeout: 60000 });
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // 제품 정보 추출
      const productInfo = await page.evaluate(() => {
        let brand = '';
        const brandSelectors = ['.prd_brand a', '.prd_brand', '[class*="brand"] a', '[class*="brand"]'];
        for (const sel of brandSelectors) {
          const el = document.querySelector(sel);
          if (el) {
            const text = el.textContent?.trim().split('\n')[0].trim();
            if (text && text.length > 0 && text.length < 50 && !text.includes('공유')) {
              brand = text;
              break;
            }
          }
        }
        
        let name = '';
        const nameSelectors = ['p.prd_name', '.prd_name', '[class*="prd_name"]', '[class*="goods_name"]'];
        for (const sel of nameSelectors) {
          const el = document.querySelector(sel);
          if (el) {
            const text = el.textContent?.trim().split('\n')[0].trim();
            if (text && text.length > 5 && text.length < 200) {
              name = text;
              break;
            }
          }
        }
        
        let imageUrl = '';
        const imgSelectors = ['.prd_detail_img img', '#mainImg', '.thumb_img img'];
        for (const sel of imgSelectors) {
          const el = document.querySelector(sel);
          if (el && el.src && el.src.includes('oliveyoung')) {
            imageUrl = el.src;
            break;
          }
        }
        
        return { brand, name, imageUrl };
      });
      
      console.log(`[크롤링] 제품 정보: ${productInfo.brand || '(브랜드없음)'} - ${productInfo.name || '(이름없음)'}`);
      
      if (!productInfo.name) {
        const title = await page.title();
        if (title && title.includes('|')) {
          productInfo.name = title.split('|')[0].trim();
        }
      }

      // 스크롤
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await new Promise(resolve => setTimeout(resolve, 2000));
      await page.evaluate(() => window.scrollTo(0, 2000));
      await new Promise(resolve => setTimeout(resolve, 1000));

      // 아코디언 클릭
      const tabClicked = await page.evaluate(() => {
        const accordionBtns = document.querySelectorAll('button[type="button"]');
        for (const btn of accordionBtns) {
          const text = btn.textContent?.trim() || '';
          if (text.includes('상품정보') || text.includes('제공고시')) {
            const isExpanded = btn.getAttribute('aria-expanded') === 'true';
            if (!isExpanded) btn.click();
            return `accordion btn: "${text.substring(0, 30)}" (expanded: ${isExpanded})`;
          }
        }
        
        const expandBtns = document.querySelectorAll('[aria-expanded]');
        for (const btn of expandBtns) {
          const text = btn.textContent?.trim() || '';
          if (text.includes('상품정보') || text.includes('제공고시')) {
            const isExpanded = btn.getAttribute('aria-expanded') === 'true';
            if (!isExpanded) btn.click();
            return `aria-expanded btn: "${text.substring(0, 30)}"`;
          }
        }
        
        return 'no accordion found';
      });
      
      console.log(`[크롤링] 아코디언 클릭 결과: ${tabClicked}`);
      
      try {
        await page.waitForSelector('th[scope="row"]', { timeout: 10000 });
        console.log(`[크롤링] 테이블 로딩 완료`);
      } catch (e) {
        console.log(`[크롤링] 테이블 대기 타임아웃`);
      }
      
      await new Promise(resolve => setTimeout(resolve, 2000));

      // 전성분 추출
      const ingredientData = await page.evaluate(() => {
        const allThs = document.querySelectorAll('th[scope="row"]');
        for (const th of allThs) {
          const thText = th.textContent?.trim() || '';
          if (thText.includes('화장품법') || thText.includes('모든 성분')) {
            const tr = th.closest('tr');
            if (tr) {
              const td = tr.querySelector('td');
              if (td) {
                const text = td.textContent?.trim();
                if (text && text.length > 20) {
                  return { method: 'th-scope-row', text, length: text.length };
                }
              }
            }
          }
        }
        
        const allThsNoScope = document.querySelectorAll('th');
        for (const th of allThsNoScope) {
          const thText = th.textContent?.trim() || '';
          if (thText.includes('화장품법') || thText.includes('모든 성분') || thText === '전성분') {
            const tr = th.closest('tr');
            if (tr) {
              const td = tr.querySelector('td');
              if (td) {
                const text = td.textContent?.trim();
                if (text && text.length > 20) {
                  return { method: 'th-td-pair', text, length: text.length };
                }
              }
            }
          }
        }
        
        const allTds = document.querySelectorAll('td');
        for (const td of allTds) {
          const text = td.textContent?.trim();
          if (text && text.length > 100) {
            const hasIngredients = text.includes('정제수') || text.includes('글리세린');
            const commaCount = (text.match(/,/g) || []).length;
            if (hasIngredients && commaCount > 5) {
              return { method: 'td-pattern', text, length: text.length };
            }
          }
        }
        
        return null;
      });

      console.log(`[크롤링] 전성분 추출 결과:`, ingredientData ? `${ingredientData.method} (${ingredientData.length}자)` : '없음');

      let ingredients = [];
      if (ingredientData && ingredientData.text) {
        let processedText = ingredientData.text
          .replace(/(\d),(\d)/g, '$1NUMCOMMA$2')
          .replace(/\n/g, ' ')
          .replace(/\s{2,}/g, ' ');
        
        ingredients = processedText
          .split(/[,，]/)
          .map(i => i.trim())
          .map(i => i.replace(/NUMCOMMA/g, ','))
          .filter(i => i.length > 1 && i.length < 80)
          .filter(i => !i.match(/^[0-9.\s,]+$/))
          .filter(i => !i.includes('화장품법'))
          .filter(i => !i.includes('기재해야'))
          .filter(i => !i.includes('해당없음'));
      }
      
      console.log(`[크롤링] 파싱된 성분 수: ${ingredients.length}`);

      return {
        goodsNo,
        url: productUrl,
        ...productInfo,
        ingredients
      };
    } catch (err) {
      console.error(`[크롤링] 오류 (${goodsNo}):`, err.message);
      throw err;
    } finally {
      await page.close();
    }
  }
}

let crawler = null;

// ============ 크롤링 API ============

app.get('/api/crawler/status', (req, res) => {
  res.json({
    available: !!puppeteer,
    message: puppeteer ? '크롤링 기능 사용 가능' : 'Puppeteer 미설치'
  });
});

app.get('/api/crawler/search', async (req, res) => {
  const { query } = req.query;
  if (!query) return res.status(400).json({ error: '검색어를 입력하세요.' });
  if (!puppeteer) return res.status(503).json({ error: 'Puppeteer가 설치되어 있지 않습니다.' });

  try {
    if (!crawler) {
      crawler = new OliveyoungCrawler();
      await crawler.init();
    }
    
    const page = await crawler.browser.newPage();
    
    try {
      await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      
      const searchUrl = `https://www.oliveyoung.co.kr/store/search/getSearchMain.do?query=${encodeURIComponent(query)}`;
      await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      
      await page.waitForSelector('.prd_info', { timeout: 10000 }).catch(() => null);
      
      const products = await page.evaluate(() => {
        const items = document.querySelectorAll('.prd_info');
        return Array.from(items).slice(0, 20).map(item => {
          const linkEl = item.querySelector('a');
          const brandEl = item.querySelector('.tx_brand');
          const nameEl = item.querySelector('.tx_name');
          const priceEl = item.querySelector('.tx_cur em');
          const imgEl = item.closest('.prd_unit')?.querySelector('.thumb img');
          
          const href = linkEl?.href || '';
          const goodsNoMatch = href.match(/goodsNo=([A-Z0-9]+)/);
          
          return {
            goodsNo: goodsNoMatch ? goodsNoMatch[1] : '',
            url: href,
            brand: brandEl?.textContent?.trim() || '',
            name: nameEl?.textContent?.trim() || '',
            price: priceEl?.textContent?.trim() || '',
            imageUrl: imgEl?.src || ''
          };
        }).filter(p => p.goodsNo);
      });
      
      console.log(`[검색] "${query}" - ${products.length}개 결과`);
      res.json(products);
    } finally {
      await page.close();
    }
  } catch (err) {
    console.error('검색 오류:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/crawler/product/:goodsNo', async (req, res) => {
  const { goodsNo } = req.params;
  if (!puppeteer) return res.status(503).json({ error: 'Puppeteer가 설치되어 있지 않습니다.' });

  try {
    if (!crawler) {
      crawler = new OliveyoungCrawler();
      await crawler.init();
    }
    const product = await crawler.getProductDetail(goodsNo);
    res.json(product);
  } catch (err) {
    console.error('크롤링 오류:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/crawler/save', async (req, res) => {
  const { goodsNo, category } = req.body;
  if (!puppeteer) return res.status(503).json({ error: 'Puppeteer가 설치되어 있지 않습니다.' });

  try {
    if (!crawler) {
      crawler = new OliveyoungCrawler();
      await crawler.init();
    }
    
    const crawledProduct = await crawler.getProductDetail(goodsNo);
    
    const productData = {
      brand: crawledProduct.brand,
      name: crawledProduct.name,
      category: category || '',
      ingredients: crawledProduct.ingredients,
      oliveyoungUrl: crawledProduct.url,
      imageUrl: crawledProduct.imageUrl,
      goodsNo: goodsNo
    };
    
    const savedProduct = await Product.findOneAndUpdate(
      { goodsNo },
      productData,
      { upsert: true, new: true }
    );
    
    res.json(savedProduct);
  } catch (err) {
    console.error('크롤링/저장 오류:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/crawler/batch', async (req, res) => {
  const { goodsNos, category } = req.body;
  if (!Array.isArray(goodsNos) || goodsNos.length === 0) {
    return res.status(400).json({ error: '크롤링할 제품 목록이 필요합니다.' });
  }
  if (!puppeteer) return res.status(503).json({ error: 'Puppeteer가 설치되어 있지 않습니다.' });

  const results = { success: [], failed: [] };

  try {
    if (!crawler) {
      crawler = new OliveyoungCrawler();
      await crawler.init();
    }
    
    for (const goodsNo of goodsNos) {
      try {
        const crawledProduct = await crawler.getProductDetail(goodsNo);
        
        const productData = {
          brand: crawledProduct.brand,
          name: crawledProduct.name,
          category: category || '',
          ingredients: crawledProduct.ingredients,
          oliveyoungUrl: crawledProduct.url,
          imageUrl: crawledProduct.imageUrl,
          goodsNo: goodsNo
        };
        
        await Product.findOneAndUpdate(
          { goodsNo },
          productData,
          { upsert: true, new: true }
        );
        
        results.success.push({ goodsNo, name: crawledProduct.name, ingredientCount: crawledProduct.ingredients.length });
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (err) {
        results.failed.push({ goodsNo, error: err.message });
      }
    }
    
    res.json(results);
  } catch (err) {
    console.error('일괄 크롤링 오류:', err);
    res.status(500).json({ error: err.message, results });
  }
});

// ============ 제품 API ============

app.get('/api/products', async (req, res) => {
  try {
    const { brand, search, category } = req.query;
    let query = {};
    
    if (brand) query.brand = new RegExp(brand, 'i');
    if (category) query.category = category;
    if (search) {
      query.$or = [
        { name: new RegExp(search, 'i') },
        { brand: new RegExp(search, 'i') },
        { ingredients: new RegExp(search, 'i') }
      ];
    }
    
    const products = await Product.find(query).sort({ createdAt: -1 });
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/brands', async (req, res) => {
  try {
    const brands = await Product.distinct('brand');
    res.json(brands.sort());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/categories', async (req, res) => {
  try {
    const categories = await Product.distinct('category');
    res.json(categories.filter(Boolean).sort());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/products/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (product) res.json(product);
    else res.status(404).json({ error: '제품을 찾을 수 없습니다.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/products', async (req, res) => {
  try {
    const { brand, name, category, ingredients, oliveyoungUrl, imageUrl } = req.body;
    if (!brand || !name) return res.status(400).json({ error: '브랜드와 제품명은 필수입니다.' });

    const product = new Product({
      brand, name,
      category: category || '',
      ingredients: ingredients || [],
      oliveyoungUrl: oliveyoungUrl || '',
      imageUrl: imageUrl || ''
    });
    
    await product.save();
    res.status(201).json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/products/:id', async (req, res) => {
  try {
    const product = await Product.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );
    if (product) res.json(product);
    else res.status(404).json({ error: '제품을 찾을 수 없습니다.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/products/:id', async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (product) res.json({ message: '삭제되었습니다.' });
    else res.status(404).json({ error: '제품을 찾을 수 없습니다.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CSV 내보내기
app.get('/api/export/csv', async (req, res) => {
  try {
    const products = await Product.find().sort({ createdAt: -1 });
    
    const headers = ['브랜드', '제품명', '카테고리', '전성분', '올리브영URL', '등록일'];
    const rows = products.map(p => [
      p.brand, p.name, p.category || '',
      (p.ingredients || []).join(', '),
      p.oliveyoungUrl || '', p.createdAt
    ]);

    const BOM = '\uFEFF';
    const csvContent = BOM + [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=cosmetics_ingredients.csv');
    res.send(csvContent);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 성분 통계
app.get('/api/stats/ingredients', async (req, res) => {
  try {
    const products = await Product.find();
    const ingredientCount = {};
    
    products.forEach(product => {
      (product.ingredients || []).forEach(ingredient => {
        const normalized = ingredient.trim().toLowerCase();
        if (normalized) ingredientCount[normalized] = (ingredientCount[normalized] || 0) + 1;
      });
    });

    const sorted = Object.entries(ingredientCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50)
      .map(([name, count]) => ({ name, count }));

    res.json(sorted);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 서버 종료 시 정리
process.on('SIGINT', async () => {
  if (crawler) await crawler.close();
  await mongoose.connection.close();
  process.exit();
});

// 서버 시작
app.listen(PORT, () => {
  console.log(`🧴 화장품 전성분 DB 서버가 포트 ${PORT}에서 실행중입니다.`);
});

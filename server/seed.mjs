// Demo catalogue for trying Saligue: two shops (one is INDECIANA) and an item for every part of the body.
// The pictures are drawn here (transparent background), so they can be worn in the Fitting Room right away.
//   node server/seed.mjs            add the demo items (again: replaces the previous demo items)
//   node server/seed.mjs --remove   remove the demo shops and their items
import { randomUUID } from 'node:crypto';
import { Mp3Encoder } from '@breezystack/lamejs';
import { db, json, now, transaction } from './db.mjs';
import { storeImage } from './media.mjs';

const DEMO_DOMAIN = '@demo.saligue.app';

// ---------------------------------------------------------------------------
// Pictures
// ---------------------------------------------------------------------------

// Soft side shading so flat colours look like fabric.
const SHADE = `<linearGradient id="shade" x1="0" x2="1"><stop offset="0" stop-color="#000" stop-opacity=".22"/><stop offset=".45" stop-color="#fff" stop-opacity=".12"/><stop offset="1" stop-color="#000" stop-opacity=".22"/></linearGradient>`;

function svg(width, height, body, defs = '') {
  // Drawn at twice the size so it stays sharp on the body.
  const markup = `<svg xmlns="http://www.w3.org/2000/svg" width="${width * 2}" height="${height * 2}" viewBox="0 0 ${width} ${height}"><defs>${SHADE}${defs}</defs>${body}</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(markup).toString('base64')}`;
}

const shaded = (d, fill, extra = '') => `<path d="${d}" fill="${fill}" ${extra}/><path d="${d}" fill="url(#shade)"/>`;
const pattern = (id, size, background, shapes) =>
  `<pattern id="${id}" width="${size}" height="${size}" patternUnits="userSpaceOnUse"><rect width="${size}" height="${size}" fill="${background}"/>${shapes}</pattern>`;

const TEE = 'M140,20 Q200,62 260,20 L340,45 L400,130 L345,165 L322,140 L322,430 L78,430 L78,140 L55,165 L0,130 L60,45 Z';
const LONG = 'M140,20 Q200,62 260,20 L340,45 Q378,180 396,400 L350,408 L322,170 L322,430 L78,430 L78,170 L50,408 L4,400 Q22,180 60,45 Z';

function tee(color, { stripes, collar } = {}) {
  const defs = stripes ? pattern('st', 36, color, `<rect y="0" width="36" height="14" fill="${stripes}"/>`) : '';
  const fill = stripes ? 'url(#st)' : color;
  const extra = collar
    ? `<path d="M140,20 L200,70 L260,20 L250,8 L200,40 L150,8 Z" fill="${collar}"/><circle cx="200" cy="95" r="5" fill="#fff"/><circle cx="200" cy="125" r="5" fill="#fff"/>`
    : `<path d="M140,20 Q200,62 260,20" fill="none" stroke="#000" stroke-opacity=".15" stroke-width="6"/>`;
  return svg(400, 440, shaded(TEE, fill) + extra, defs);
}

function blouse(color) {
  return svg(400, 440, shaded(LONG, color) + `<path d="M200,60 L200,430" stroke="#000" stroke-opacity=".12" stroke-width="3"/>${[110, 170, 230, 290].map((y) => `<circle cx="200" cy="${y}" r="5" fill="#fff" fill-opacity=".8"/>`).join('')}`);
}

function jacket(color, { lapel = color, zip } = {}) {
  const opening = zip
    ? `<path d="M200,40 L200,430" stroke="#c0c0c0" stroke-width="6"/>`
    : `<path d="M140,20 L200,190 L260,20 L290,40 L215,240 L200,430 L185,240 L110,40 Z" fill="${lapel}"/><path d="M140,20 L200,190 L260,20" fill="none" stroke="#000" stroke-opacity=".3" stroke-width="4"/>${[280, 340].map((y) => `<circle cx="215" cy="${y}" r="7" fill="#222"/>`).join('')}`;
  const pockets = `<path d="M100,330 L160,330" stroke="#000" stroke-opacity=".3" stroke-width="5"/><path d="M240,330 L300,330" stroke="#000" stroke-opacity=".3" stroke-width="5"/>`;
  return svg(400, 440, shaded(LONG, color) + opening + pockets);
}

function dress(fill, defs = '', { sleeves } = {}) {
  const d = sleeves
    ? 'M140,20 Q200,62 260,20 L330,45 L370,120 L325,140 L305,110 L295,230 Q330,420 345,590 L55,590 Q70,420 105,230 L95,110 L75,140 L30,120 L70,45 Z'
    : 'M130,20 L165,20 Q200,64 235,20 L270,20 L292,230 Q330,420 345,590 L55,590 Q70,420 108,230 Z';
  return svg(400, 600, shaded(d, fill) + `<path d="M108,230 Q200,250 292,230" fill="none" stroke="#000" stroke-opacity=".2" stroke-width="6"/>`, defs);
}

function trousers(color, { jeans } = {}) {
  const d = 'M40,0 L260,0 L282,630 L172,630 L150,190 L128,630 L18,630 Z';
  const seams = jeans
    ? `<path d="M40,40 L260,40" stroke="#e8b04a" stroke-width="3" stroke-dasharray="8 6"/><path d="M60,40 Q70,110 120,120" fill="none" stroke="#e8b04a" stroke-width="3" stroke-dasharray="8 6"/><path d="M240,40 Q230,110 180,120" fill="none" stroke="#e8b04a" stroke-width="3" stroke-dasharray="8 6"/>`
    : `<path d="M90,45 L80,630 M210,45 L220,630" stroke="#000" stroke-opacity=".18" stroke-width="3"/>`;
  return svg(300, 640, shaded(d, color) + `<rect x="40" y="0" width="220" height="38" fill="#000" fill-opacity=".15"/>` + seams);
}

function skirt(color) {
  const d = 'M80,0 L280,0 L350,290 L10,290 Z';
  const pleats = [60, 120, 180, 240, 300].map((x) => `<path d="M${180 + (x - 180) * 0.55},34 L${x},290" stroke="#000" stroke-opacity=".15" stroke-width="3"/>`).join('');
  return svg(360, 300, shaded(d, color) + `<rect x="80" y="0" width="200" height="34" fill="#000" fill-opacity=".15"/>` + pleats);
}

// Shoes are drawn from the side with the heel on the left (taller end), as sellers usually photograph them.
function sneaker(color, sole = '#ffffff', accent = '#e21376') {
  return svg(400, 180,
    shaded('M20,150 L22,62 Q30,28 85,30 L140,48 Q205,92 300,102 Q378,112 390,142 L390,150 Z', color) +
    `<path d="M14,146 L394,146 Q396,172 370,172 L30,172 Q12,172 14,146 Z" fill="${sole}" stroke="#ccc" stroke-width="2"/>` +
    `<path d="M120,120 Q220,70 330,128" fill="none" stroke="${accent}" stroke-width="12" stroke-linecap="round"/>` +
    [150, 180, 210, 240].map((x, i) => `<path d="M${x},${62 + i * 9} L${x + 22},${74 + i * 9}" stroke="#fff" stroke-width="5" stroke-linecap="round"/>`).join(''));
}
function boot(color) {
  return svg(400, 190,
    shaded('M30,170 L34,12 L140,12 L146,100 Q260,108 360,130 Q392,140 392,170 Z', color) +
    `<path d="M24,166 L396,166 L396,188 L24,188 Z" fill="#222"/><path d="M60,12 L60,96" stroke="#000" stroke-opacity=".25" stroke-width="4"/>`);
}
function loafer(color) {
  return svg(400, 140,
    shaded('M20,118 L24,52 Q120,34 250,58 Q370,72 386,118 Z', color) +
    `<path d="M16,114 L392,114 L392,134 L16,134 Z" fill="#3b2412"/><path d="M190,60 Q240,48 300,70" fill="none" stroke="#d4a017" stroke-width="7"/>`);
}

function cap(color) {
  return svg(300, 190,
    shaded('M30,140 Q30,12 150,12 Q270,12 270,140 Z', color) +
    `<path d="M6,138 Q150,196 294,138 Q150,162 6,138 Z" fill="${color}"/><path d="M6,138 Q150,196 294,138" fill="none" stroke="#000" stroke-opacity=".3" stroke-width="4"/><circle cx="150" cy="16" r="9" fill="${color}" stroke="#000" stroke-opacity=".25"/>`);
}
function strawHat() {
  return svg(420, 170,
    `<ellipse cx="210" cy="130" rx="205" ry="36" fill="#e3c27a"/><ellipse cx="210" cy="130" rx="205" ry="36" fill="url(#shade)"/>` +
    shaded('M120,132 Q118,20 210,18 Q302,20 300,132 Z', '#d9b464') +
    `<path d="M121,108 Q210,124 299,108 L300,128 Q210,144 120,128 Z" fill="#111"/>`);
}

function glasses(frame, lens, round) {
  const lensShape = (x) => (round ? `<circle cx="${x}" cy="62" r="54"/>` : `<rect x="${x - 70}" y="14" width="140" height="96" rx="30"/>`);
  return svg(400, 130,
    `<g fill="${lens}" stroke="${frame}" stroke-width="10">${lensShape(100)}${lensShape(300)}</g>` +
    `<path d="M${round ? 154 : 170},50 Q200,32 ${round ? 246 : 230},50" fill="none" stroke="${frame}" stroke-width="9"/>` +
    `<path d="M${round ? 46 : 30},48 L4,40 M${round ? 354 : 370},48 L396,40" stroke="${frame}" stroke-width="9" stroke-linecap="round"/>`);
}

function handbag(color, hardware = '#d4a017') {
  return svg(300, 330,
    `<path d="M80,120 Q80,10 150,10 Q220,10 220,120" fill="none" stroke="${color}" stroke-width="16"/>` +
    shaded('M30,120 L270,120 L295,320 L5,320 Z', color) +
    `<path d="M30,120 L270,120 L262,170 Q150,200 38,170 Z" fill="#000" fill-opacity=".15"/><rect x="135" y="172" width="30" height="22" rx="4" fill="${hardware}"/>`);
}
function tote(color) {
  return svg(300, 360,
    `<path d="M70,130 L90,10 L130,10 L120,130 M180,130 L170,10 L210,10 L230,130" fill="none" stroke="${color}" stroke-width="14"/>` +
    shaded('M20,130 L280,130 L280,350 L20,350 Z', color) + `<text x="150" y="260" font-family="Georgia" font-size="34" fill="#fff" text-anchor="middle">SALIGUE</text>`);
}
function watch() {
  return svg(130, 320,
    `<rect x="40" y="0" width="50" height="320" rx="14" fill="#5a3a22"/><rect x="40" y="0" width="50" height="320" rx="14" fill="url(#shade)"/>` +
    `<circle cx="65" cy="160" r="56" fill="#d4a017"/><circle cx="65" cy="160" r="46" fill="#fffaf0"/><path d="M65,160 L65,126 M65,160 L90,170" stroke="#222" stroke-width="5" stroke-linecap="round"/>`);
}
function belt(color) {
  return svg(460, 70,
    `<rect x="0" y="12" width="460" height="46" rx="8" fill="${color}"/><rect x="0" y="12" width="460" height="46" fill="url(#shade)"/>` +
    `<rect x="20" y="4" width="60" height="62" rx="6" fill="none" stroke="#c9a227" stroke-width="9"/>` +
    [180, 230, 280].map((x) => `<circle cx="${x}" cy="35" r="5" fill="#000" fill-opacity=".4"/>`).join(''));
}

const kitenge = pattern('kit', 60, '#f28c28', `<circle cx="15" cy="15" r="11" fill="#1b7f4d"/><circle cx="45" cy="45" r="11" fill="#1b7f4d"/><circle cx="45" cy="15" r="5" fill="#ffd23f"/><circle cx="15" cy="45" r="5" fill="#ffd23f"/>`);

// ---------------------------------------------------------------------------
// Shops and items
// ---------------------------------------------------------------------------

const SHOPS = [
  {
    key: 'kigali',
    name: 'Kigali Style House',
    official: false,
    shop: { name: 'Kigali Style House', phone: '+250 788 000 111', whatsapp: '+250 788 000 111', country: 'Rwanda', city: 'Kigali', district: 'Nyarugenge', street: 'KN 4 Ave', landmark: 'Kigali City Tower', hours: 'Mon–Sat 8:00–20:00' },
    items: [
      { name: 'Classic White Tee', price: 12, category: 'top', color: 'White', size: 'M', brand: 'Basics', image: tee('#f7f7f7') },
      { name: 'Black Crew T-shirt', price: 12, category: 'top', color: 'Black', size: 'L', brand: 'Basics', image: tee('#1d1d1f') },
      { name: 'Navy Striped Polo', price: 18, category: 'top', color: 'Navy', size: 'M', brand: 'Marine', image: tee('#1f2f5c', { stripes: '#f2f2f2', collar: '#1f2f5c' }) },
      { name: 'Denim Jacket', price: 45, category: 'outerwear', color: 'Blue', size: 'M', brand: "Levi's", image: jacket('#4a6fa5', { lapel: '#3d5d8c' }) },
      { name: 'Black Bomber Jacket', price: 52, category: 'outerwear', color: 'Black', size: 'L', brand: 'Urban', image: jacket('#202022', { zip: true }) },
      { name: 'Slim Blue Jeans', price: 30, category: 'bottom', color: 'Blue', size: '32', brand: "Levi's", image: trousers('#3b5b8f', { jeans: true }) },
      { name: 'Black Tailored Trousers', price: 34, category: 'bottom', color: 'Black', size: '32', brand: 'Urban', image: trousers('#222226') },
      { name: 'Beige Chinos', price: 28, category: 'bottom', color: 'Beige', size: '34', brand: 'Basics', image: trousers('#cdb38b') },
      { name: 'Kitenge Summer Dress', price: 40, category: 'dress', color: 'Orange', size: 'M', brand: 'Made in Rwanda', image: dress('url(#kit)', kitenge, { sleeves: true }) },
      { name: 'White Sneakers', price: 38, category: 'shoes', color: 'White', size: '42', brand: 'Stride', image: sneaker('#f4f4f4', '#ffffff', '#e21376') },
      { name: 'Black Leather Boots', price: 65, category: 'shoes', color: 'Black', size: '43', brand: 'Trail', image: boot('#1e1e1e') },
      { name: 'Brown Loafers', price: 48, category: 'shoes', color: 'Brown', size: '42', brand: 'Gentleman', image: loafer('#7a4a24') },
      { name: 'Black Baseball Cap', price: 10, category: 'hat', color: 'Black', brand: 'Urban', image: cap('#1d1d1f') },
      { name: 'Straw Sun Hat', price: 16, category: 'hat', color: 'Beige', brand: 'Beach', image: strawHat() },
      { name: 'Black Sunglasses', price: 15, category: 'eyewear', color: 'Black', brand: 'Shade', image: glasses('#111', '#2b2b33', false) },
      { name: 'Round Gold Glasses', price: 22, category: 'eyewear', color: 'Gold', brand: 'Vision', image: glasses('#c9a227', '#bcd7e8', true) },
      { name: 'Brown Leather Belt', price: 14, category: 'accessory', color: 'Brown', brand: 'Gentleman', image: belt('#6b4226') },
    ],
  },
  {
    key: 'indeciana',
    name: 'INDECIANA',
    official: true,
    shop: { name: 'INDECIANA', phone: '+250 788 000 222', whatsapp: '+250 788 000 222', country: 'Rwanda', city: 'Kigali', district: 'Gasabo', street: 'KG 7 Ave', landmark: 'Kigali Heights', hours: 'Every day 9:00–21:00' },
    items: [
      { name: 'INDECIANA Signature Blouse', price: 55, category: 'top', color: 'Pink', size: 'S', brand: 'INDECIANA', image: blouse('#e21376') },
      { name: 'INDECIANA Trench Coat', price: 120, category: 'outerwear', color: 'Beige', size: 'M', brand: 'INDECIANA', image: jacket('#c8ad84', { lapel: '#b89c72' }) },
      { name: 'INDECIANA Red Evening Dress', price: 95, category: 'dress', color: 'Red', size: 'M', brand: 'INDECIANA', image: dress('#e30613') },
      { name: 'INDECIANA Navy Midi Dress', price: 85, category: 'dress', color: 'Navy', size: 'L', brand: 'INDECIANA', image: dress('#1f2f5c', '', { sleeves: true }) },
      { name: 'INDECIANA Pleated Skirt', price: 48, category: 'bottom', color: 'Pink', size: 'S', brand: 'INDECIANA', image: skirt('#f3a6c8') },
      { name: 'INDECIANA Pink Sneakers', price: 70, category: 'shoes', color: 'Pink', size: '39', brand: 'INDECIANA', image: sneaker('#f7c6dc', '#ffffff', '#e21376') },
      { name: 'INDECIANA Leather Handbag', price: 110, category: 'bag', color: 'Brown', brand: 'INDECIANA', image: handbag('#8b5a2b') },
      { name: 'INDECIANA Black Tote', price: 75, category: 'bag', color: 'Black', brand: 'INDECIANA', image: tote('#1d1d1f') },
      { name: 'INDECIANA Gold Watch', price: 140, category: 'accessory', color: 'Gold', brand: 'INDECIANA', image: watch() },
    ],
  },
];

// ---------------------------------------------------------------------------
// Sounds: short jingles made here, so the feed plays something like TikTok does.
// ---------------------------------------------------------------------------

const RATE = 22050;
const NOTE = (n) => 440 * 2 ** ((n - 69) / 12);

// A little looping tune: melody notes (MIDI numbers, null = rest) over a soft beat.
function jingle(melody, bpm) {
  const beat = 60 / bpm / 2;
  const samples = new Float32Array(Math.ceil(melody.length * beat * RATE));
  melody.forEach((note, i) => {
    const start = Math.floor(i * beat * RATE);
    const length = Math.floor(beat * RATE);
    for (let j = 0; j < length && start + j < samples.length; j++) {
      const t = j / RATE;
      const envelope = Math.min(1, j / 200) * Math.exp(-3 * t / beat);
      let v = note === null ? 0 : 0.3 * Math.sin(2 * Math.PI * NOTE(note) * t) + 0.1 * Math.sin(4 * Math.PI * NOTE(note) * t);
      // Kick on every other step.
      if (i % 2 === 0) v += 0.35 * Math.sin(2 * Math.PI * 60 * t * Math.exp(-t * 20)) * Math.exp(-t * 18);
      samples[start + j] += v * envelope;
    }
  });
  const pcm = Int16Array.from(samples, (v) => Math.max(-1, Math.min(1, v)) * 0x7fff);
  const encoder = new Mp3Encoder(1, RATE, 48);
  const parts = [];
  for (let i = 0; i < pcm.length; i += 1152) parts.push(Buffer.from(encoder.encodeBuffer(pcm.subarray(i, i + 1152))));
  parts.push(Buffer.from(encoder.flush()));
  return { data: `data:audio/mpeg;base64,${Buffer.concat(parts).toString('base64')}`, duration: samples.length / RATE };
}

const SOUNDS = {
  'Kitenge Summer Dress': ['Kigali Sunshine', jingle([72, 76, 79, 76, 74, 77, 81, 77, 72, 76, 79, 84, 83, 79, 76, null], 116)],
  'White Sneakers': ['Street Steps', jingle([60, null, 63, 65, 67, null, 65, 63, 60, null, 58, 60, 63, null, 60, null], 100)],
  'INDECIANA Red Evening Dress': ['INDECIANA Night', jingle([69, 72, 76, 72, 74, 77, 81, 77, 76, 72, 69, 72, 71, 74, 76, null], 92)],
  'Denim Jacket': ['Weekend Denim', jingle([64, 67, 71, 67, 69, 72, 69, 67, 64, 62, 64, 67, 64, null, 62, null], 108)],
};

// The exact type of each demo item (see src/lib/fashion-types.json).
const DEMO_TYPES = {
  'Classic White Tee': 'T-shirt', 'Black Crew T-shirt': 'T-shirt', 'Navy Striped Polo': 'Polo', 'Denim Jacket': 'Denim jacket',
  'Black Bomber Jacket': 'Bomber', 'Slim Blue Jeans': 'Jeans', 'Black Tailored Trousers': 'Trousers', 'Beige Chinos': 'Chinos',
  'Kitenge Summer Dress': 'Kitenge dress', 'White Sneakers': 'Sneakers', 'Black Leather Boots': 'Boots', 'Brown Loafers': 'Loafers',
  'Black Baseball Cap': 'Cap', 'Straw Sun Hat': 'Hat', 'Black Sunglasses': 'Sunglasses', 'Round Gold Glasses': 'Glasses',
  'Brown Leather Belt': 'Belt', 'INDECIANA Signature Blouse': 'Blouse', 'INDECIANA Trench Coat': 'Coat',
  'INDECIANA Red Evening Dress': 'Evening dress', 'INDECIANA Navy Midi Dress': 'Midi dress', 'INDECIANA Pleated Skirt': 'Skirt',
  'INDECIANA Pink Sneakers': 'Sneakers', 'INDECIANA Leather Handbag': 'Handbag', 'INDECIANA Black Tote': 'Tote', 'INDECIANA Gold Watch': 'Watch',
};

function remove() {
  const sellers = db.prepare(`select id from users where email like ?`).all(`%${DEMO_DOMAIN}`);
  transaction(() => {
    for (const { id } of sellers) {
      db.prepare('delete from products where seller_id = ?').run(id);
      db.prepare('delete from users where id = ?').run(id);
    }
  });
  return sellers.length;
}

if (process.argv.includes('--remove')) {
  console.log(`Removed ${remove()} demo shops and their items.`);
} else {
  remove();
  let count = 0;
  transaction(() => {
    for (const shop of SHOPS) {
      const sellerId = randomUUID();
      const email = `${shop.key}${DEMO_DOMAIN}`;
      // Demo sellers have no password: nobody can sign in to them.
      db.prepare('insert into users (id, email, display_name, role, official, shop, created_at) values (?, ?, ?, ?, ?, ?, ?)')
        .run(sellerId, email, shop.name, 'seller', shop.official ? 1 : 0, json(shop.shop), now());
      shop.items.forEach((item, i) => {
        // Spread over the last few days so the feed has new and older items.
        const created = new Date(Date.now() - (i * 7 + count) * 3_600_000).toISOString();
        const id = randomUUID();
        const sound = SOUNDS[item.name];
        db.prepare(`insert into products (id, name, price, image, cutout, category, type, seller, seller_id, seller_email, status,
            description, size, color, brand, condition, contact, shop, official, like_count, sound, created_at)
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, 'New', ?, ?, ?, ?, ?, ?)`).run(
          id, item.name, item.price, storeImage(item.image), storeImage(item.image), item.category, DEMO_TYPES[item.name], shop.name, sellerId, email,
          `${item.name} by ${item.brand}. Demo item for trying Saligue.`, item.size ?? null, item.color, item.brand,
          shop.shop.whatsapp, json(shop.shop), shop.official ? 1 : 0, Math.floor(Math.random() * 40),
          sound ? json({ name: sound[0], duration: sound[1].duration }) : null, created
        );
        if (sound) {
          db.prepare('insert into product_audio (product_id, data, name, duration) values (?, ?, ?, ?)').run(id, sound[1].data, sound[0], sound[1].duration);
        }
        count++;
      });
    }
  });
  console.log(`Added ${count} demo items from ${SHOPS.length} shops. Remove them with: node server/seed.mjs --remove`);
}

const fs = require('fs');
const f = 'E:/github/sss/prototype/js/cfg.js';
let s = fs.readFileSync(f, 'utf8');

const start = s.indexOf('    LEVELS: [');
const end = s.indexOf('    ],', start);
if (start < 0 || end < 0) { console.log('MISS LEVELS block'); process.exit(1); }

const NEW = `    LEVELS: [
      { n: 1,  city: '温州',     lon: 120.70, lat: 28.00, km: 10.7,  dens: 90,  elite: 0.020, bosses: [0.55], tag: '教学', biome: 'temperate', lm: { s: 0.62, type: 'tower', side: 1, off: 95 } },
      { n: 2,  city: '芜湖',     lon: 118.43, lat: 31.33, km: 12.7,  dens: 100, elite: 0.024, bosses: [0.55], tag: '第一座铁桥', mods: ['bridge'], biome: 'temperate', lm: { s: 0.64, type: 'twin', side: 1, off: 100 } },
      { n: 3,  city: '合肥',     lon: 117.23, lat: 31.82, km: 14.7,  dens: 110, elite: 0.028, bosses: [0.55], tag: '双波夹击', biome: 'temperate', lm: { s: 0.60, type: 'tower', side: -1, off: 100 } },
      { n: 4,  city: '徐州',     lon: 117.18, lat: 34.26, km: 16.7,  dens: 120, elite: 0.032, bosses: [0.55], tag: '编组场', biome: 'loess', lm: { s: 0.70, type: 'cluster', side: 1, off: 105 } },
      { n: 5,  city: '洛阳',     lon: 112.45, lat: 34.62, km: 18.7,  dens: 130, elite: 0.036, bosses: [0.55], tag: '首次撬轨', biome: 'loess', lm: { s: 0.66, type: 'twin', side: -1, off: 110 } },
      { n: 6,  city: '南昌',     lon: 115.89, lat: 28.68, km: 20.7,  dens: 140, elite: 0.040, bosses: [0.55], tag: '夜间段', mods: ['night'], biome: 'temperate', lm: { s: 0.64, type: 'cluster', side: 1, off: 100 } },
      { n: 7,  city: '长沙',     lon: 112.94, lat: 28.23, km: 22.7,  dens: 150, elite: 0.044, bosses: [0.40, 0.78], tag: '隧道群', mods: ['tunnel'], biome: 'mountain', lm: { s: 0.58, type: 'twin', side: 1, off: 120 } },
      { n: 8,  city: '贵阳',     lon: 106.63, lat: 26.65, km: 24.7,  dens: 160, elite: 0.048, bosses: [0.40, 0.78], tag: '高桥', biome: 'mountain', lm: { s: 0.62, type: 'cluster', side: -1, off: 110 } },
      { n: 9,  city: '重庆',     lon: 106.55, lat: 29.56, km: 26.7,  dens: 170, elite: 0.052, bosses: [0.40, 0.78], tag: '连续弯道', mods: ['canyon'], biome: 'mountain', lm: { s: 0.72, type: 'cluster', side: 1, off: 130 } },
      { n: 10, city: '昆明',     lon: 102.83, lat: 24.88, km: 28.7,  dens: 180, elite: 0.056, bosses: [0.40, 0.78], tag: '雨战', mods: ['rain'], biome: 'mountain', lm: { s: 0.66, type: 'tower', side: 1, off: 95 } },
      { n: 11, city: '兰州',     lon: 103.83, lat: 36.06, km: 30.7,  dens: 190, elite: 0.060, bosses: [0.40, 0.78], tag: '长直道', mods: ['straight'], biome: 'loess', lm: { s: 0.68, type: 'twin', side: -1, off: 105 } },
      { n: 12, city: '乌鲁木齐', lon: 87.62,  lat: 43.83, km: 32.7,  dens: 200, elite: 0.064, bosses: [0.40, 0.78], tag: '终章', biome: 'desert', lm: { s: 0.70, type: 'dome', side: 1, off: 120 } }
    ],`;

s = s.slice(0, start) + NEW + s.slice(end + 6);
fs.writeFileSync(f, s);
console.log('LEVELS updated with lon/lat and reorder');

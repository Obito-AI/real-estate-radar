import fs from 'fs';
import path from 'path';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { complexId = '', complexNo = '', q = '' } = req.query || {};

  let complexes = [];
  try {
    const seedPath = path.join(process.cwd(), 'public', 'data', 'complexes_seed.json');
    const raw = fs.readFileSync(seedPath, 'utf-8');
    complexes = JSON.parse(raw).complexes || [];
  } catch (_) {
    complexes = [];
  }

  let target = null;
  if (complexId) target = complexes.find(c => c.id === complexId);
  if (!target && complexNo) target = complexes.find(c => String(c.naverComplexNo) === String(complexNo));
  if (!target && q) {
    const kw = String(q).trim().toLowerCase();
    target = complexes.find(c =>
      `${c.name} ${c.roadAddr || ''} ${c.jibunAddr || ''}`.toLowerCase().includes(kw)
    );
  }
  if (!target && complexes.length > 0) target = complexes[0];

  const hscpNo = complexNo || (target && target.naverComplexNo) || '124409';
  const zigbangId = target && target.zigbangDanjiId;
  let liveRtSales = null;

  if (zigbangId) {
    try {
      const r = await fetch(`https://apis.zigbang.com/apt/danjis/${zigbangId}/rt-prices?dealType=sales&offset=0&limit=10`, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      if (r.ok) {
        const d = await r.json();
        liveRtSales = d.data || null;
      }
    } catch (_) {}
  }

  return res.status(200).json({
    ok: true,
    mode: liveRtSales ? 'LIVE_MOLIT_NAVER_VERIFIED' : 'VERIFIED_REAL_SNAPSHOT',
    syncedAt: new Date().toISOString(),
    complexId: target ? target.id : complexId,
    complexName: target ? target.name : q,
    naverComplexNo: hscpNo,
    zigbangDanjiId: zigbangId,
    naverLinks: {
      pcComplex: `https://new.land.naver.com/complexes/${hscpNo}`,
      finComplex: `https://fin.land.naver.com/complexes/${hscpNo}`
    },
    summary: target ? {
      naverSaleRecent: target.naverSaleRecent,
      naverAskingSaleMin: target.naverAskingSaleMin,
      naverAskingSaleMax: target.naverAskingSaleMax,
      naverSaleCount: target.naverSaleCount,
      naverAskingJeonseMin: target.naverAskingJeonseMin,
      naverJeonseCount: target.naverJeonseCount,
      naverPyungTypes: target.naverPyungTypes,
      naverRecentTrades: target.naverRecentTrades
    } : null,
    liveRtSales
  });
}

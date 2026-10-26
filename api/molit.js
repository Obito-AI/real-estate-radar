/**
 * Vercel Serverless Function: /api/molit
 * Zero-Supabase Architecture Layer 1:
 * Proxies Ministry of Land, Infrastructure and Transport (국토교통부 실거래가 공개시스템) API
 * with 24-hour Vercel Edge Caching (s-maxage=86400, stale-while-revalidate=43200) and CORS elimination.
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const {
    lawdCd = '28260',      // 기본값: 인천 서구 (28260)
    dealYmd = '202610',    // 기본값: 2026년 10월
    type = 'trade',        // 'trade' (매매) | 'rent' (전월세)
    serviceKey = ''
  } = req.query || {};

  const apiKey = (serviceKey || process.env.MOLIT_API_KEY || '').trim();

  // Edge Cache 24시간 설정 (동일 시군구·계약년월 두 번째 조회 시 0.05초 응답)
  res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=43200');

  if (!apiKey || apiKey === 'DEMO') {
    return res.status(200).json({
      ok: true,
      mode: 'DEMO_CACHE',
      lawdCd,
      dealYmd,
      type,
      cachedAt: new Date().toISOString(),
      message: '공공데이터포털 인증키 미입력 상태이므로 내장 시드 스냅샷 데이터를 반환합니다. 발급받은 키를 입력하면 실시간 국토부 API를 호출합니다.',
      items: [
        { aptNm: '루원시티 SK리더스뷰 1차', umdNm: '가정동', excluUseAr: '84.99', dealAmount: '73,500', deposit: '42,000', floor: '18', buildYear: '2022', dealYear: dealYmd.slice(0, 4), dealMonth: dealYmd.slice(4, 6), dealDay: '19', dealingGbn: '중개거래' },
        { aptNm: '포레나 루원시티', umdNm: '가정동', excluUseAr: '84.95', dealAmount: '59,000', deposit: '39,500', floor: '14', buildYear: '2022', dealYear: dealYmd.slice(0, 4), dealMonth: dealYmd.slice(4, 6), dealDay: '15', dealingGbn: '중개거래' },
        { aptNm: '검단 금호어울림 센트럴', umdNm: '원당동', excluUseAr: '84.98', dealAmount: '77,500', deposit: '41,000', floor: '21', buildYear: '2021', dealYear: dealYmd.slice(0, 4), dealMonth: dealYmd.slice(4, 6), dealDay: '12', dealingGbn: '중개거래' },
        { aptNm: '청라 한양수자인 레이크블루', umdNm: '청라동', excluUseAr: '84.96', dealAmount: '80,600', deposit: '43,000', floor: '25', buildYear: '2019', dealYear: dealYmd.slice(0, 4), dealMonth: dealYmd.slice(4, 6), dealDay: '08', dealingGbn: '중개거래' }
      ]
    });
  }

  try {
    const endpoint = type === 'rent'
      ? 'https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent'
      : 'https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev';

    const encodedKey = apiKey.includes('%') ? apiKey : encodeURIComponent(apiKey);
    const url = `${endpoint}?serviceKey=${encodedKey}&LAWD_CD=${encodeURIComponent(lawdCd)}&DEAL_YMD=${encodeURIComponent(dealYmd)}&pageNo=1&numOfRows=200&_type=json`;

    const response = await fetch(url, { headers: { Accept: 'application/json, application/xml, text/xml' } });
    const rawText = await response.text();

    // JSON 응답 파싱 시도
    if (rawText.trim().startsWith('{')) {
      const json = JSON.parse(rawText);
      const rawItems = json?.response?.body?.items?.item || [];
      const items = Array.isArray(rawItems) ? rawItems : [rawItems];
      return res.status(200).json({
        ok: true,
        mode: 'LIVE_MOLIT_JSON',
        lawdCd,
        dealYmd,
        type,
        count: items.length,
        items
      });
    }

    // XML 응답 파싱 (공공데이터포털 기본 XML 폴백)
    const itemMatches = [...rawText.matchAll(/<item>([\s\S]*?)<\/item>/g)];
    const extractTag = (block, tag) => {
      const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
      return m ? m[1].trim() : '';
    };

    const items = itemMatches.map(m => {
      const b = m[1];
      return {
        aptNm: extractTag(b, 'aptNm') || extractTag(b, '아파트'),
        umdNm: extractTag(b, 'umdNm') || extractTag(b, '법정동'),
        excluUseAr: extractTag(b, 'excluUseAr') || extractTag(b, '전용면적'),
        dealAmount: extractTag(b, 'dealAmount') || extractTag(b, '거래금액'),
        deposit: extractTag(b, 'deposit') || extractTag(b, '보증금액'),
        monthlyRent: extractTag(b, 'monthlyRent') || extractTag(b, '월세금액'),
        floor: extractTag(b, 'floor') || extractTag(b, '층'),
        buildYear: extractTag(b, 'buildYear') || extractTag(b, '건축년도'),
        dealYear: extractTag(b, 'dealYear') || extractTag(b, '년'),
        dealMonth: extractTag(b, 'dealMonth') || extractTag(b, '월'),
        dealDay: extractTag(b, 'dealDay') || extractTag(b, '일'),
        dealingGbn: extractTag(b, 'dealingGbn') || extractTag(b, '거래유형'),
        cdealType: extractTag(b, 'cdealType') || extractTag(b, '해제여부')
      };
    });

    return res.status(200).json({
      ok: true,
      mode: 'LIVE_MOLIT_XML',
      lawdCd,
      dealYmd,
      type,
      count: items.length,
      items
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message || '국토교통부 실거래가 API 호출 중 오류가 발생했습니다.'
    });
  }
}

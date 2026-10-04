// 인터넷 주소(도메인) → 언론사 이름
// 네이버 검색 API 결과에는 언론사 이름이 없어서 기사 원문 주소로 언론사를 알아냅니다.
// 목록에 없는 곳은 도메인 이름을 그대로 보여줍니다. 필요하면 여기에 추가하세요.

const OUTLETS = {
  'v.daum.net': '다음뉴스',
  'daum.net': '다음뉴스',
  'chosun.com': '조선일보',
  'joongang.co.kr': '중앙일보',
  'donga.com': '동아일보',
  'hani.co.kr': '한겨레',
  'khan.co.kr': '경향신문',
  'hankookilbo.com': '한국일보',
  'kmib.co.kr': '국민일보',
  'seoul.co.kr': '서울신문',
  'segye.com': '세계일보',
  'munhwa.com': '문화일보',
  'yna.co.kr': '연합뉴스',
  'yonhapnewstv.co.kr': '연합뉴스TV',
  'newsis.com': '뉴시스',
  'news1.kr': '뉴스1',
  'hankyung.com': '한국경제',
  'mk.co.kr': '매일경제',
  'sedaily.com': '서울경제',
  'edaily.co.kr': '이데일리',
  'mt.co.kr': '머니투데이',
  'fnnews.com': '파이낸셜뉴스',
  'asiae.co.kr': '아시아경제',
  'heraldcorp.com': '헤럴드경제',
  'biz.chosun.com': '조선비즈',
  'etnews.com': '전자신문',
  'zdnet.co.kr': '지디넷코리아',
  'ddaily.co.kr': '디지털데일리',
  'bloter.net': '블로터',
  'inews24.com': '아이뉴스24',
  'dt.co.kr': '디지털타임스',
  'ajunews.com': '아주경제',
  'newspim.com': '뉴스핌',
  'thebell.co.kr': '더벨',
  'bizwatch.co.kr': '비즈니스워치',
  'insnews.co.kr': '한국보험신문',
  'insweek.co.kr': '보험저널',
  'kbanker.co.kr': '대한금융신문',
  'fntimes.com': '한국금융신문',
  'motorgraph.com': '모터그래프',
  'autodaily.co.kr': '오토데일리',
  'autotimes.co.kr': '오토타임즈',
  'kbs.co.kr': 'KBS',
  'imbc.com': 'MBC',
  'sbs.co.kr': 'SBS',
  'ytn.co.kr': 'YTN',
  'jtbc.co.kr': 'JTBC',
  'mbn.co.kr': 'MBN',
  'reuters.com': 'Reuters',
  'bloomberg.com': 'Bloomberg',
  'cnbc.com': 'CNBC',
  'techcrunch.com': 'TechCrunch',
  'theverge.com': 'The Verge',
  'wsj.com': 'The Wall Street Journal',
  'ft.com': 'Financial Times',
  'nytimes.com': 'The New York Times',
};

export function outletFromUrl(url) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\.|^m\.|^news\.|^biz\./, '');
  } catch {
    return '';
  }
  try {
    const full = new URL(url).hostname.toLowerCase().replace(/^www\.|^m\./, '');
    if (OUTLETS[full]) return OUTLETS[full];
  } catch {
    /* noop */
  }
  const parts = host.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    const d = parts.slice(i).join('.');
    if (OUTLETS[d]) return OUTLETS[d];
  }
  return host;
}
